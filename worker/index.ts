import { authenticateRequest } from './auth'
import {
  DEFAULT_USER_QUOTA,
  PDF_MIME_TYPE,
  UPLOAD_URL_TTL_SECONDS,
} from './constants'
import { ApiError } from './errors'
import {
  beginDocumentDeletion,
  beginReservationRelease,
  completeUpload,
  deleteFailedUploadRecord,
  deleteDocumentAndReleaseUsage,
  ensureUser,
  getDocumentForUser,
  getUserStorageUsage,
  listExpiredUploads,
  listExpiredFailedUploads,
  listReadyDocuments,
  reconcileUserStorage,
  releaseReservation,
  reserveUpload,
  validateUploadMetadata,
} from './quotaService'
import {
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
} from './r2Signing'
import type { DocumentRow, Env, UserIdentity } from './types'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: JSON_HEADERS })
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ApiError('INVALID_REQUEST', '請求內容不是有效的 JSON。')
  }
}

function publicDocument(document: DocumentRow) {
  return {
    id: document.id,
    name: document.original_name,
    mimeType: document.mime_type,
    sizeBytes: document.size_bytes,
    status: document.status,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
  }
}

async function quarantineObjectAndRelease(
  env: Env,
  document: DocumentRow,
): Promise<boolean> {
  try {
    await env.PDF_BUCKET.delete(document.object_key)
    await env.PDF_BUCKET.put(document.object_key, new Uint8Array(), {
      httpMetadata: {
        contentType: 'application/x-pocket-pdf-upload-tombstone',
      },
    })
  } catch {
    throw new ApiError(
      'R2_DELETE_FAILED',
      '雲端檔案清理失敗，系統會保留額度並稍後重試。',
    )
  }
  return releaseReservation(env.DB, document.user_id, document.id)
}

async function hasPdfSignature(
  bucket: R2Bucket,
  objectKey: string,
): Promise<boolean> {
  const prefix = await bucket.get(objectKey, {
    range: { offset: 0, length: 5 },
  })
  if (!prefix) {
    return false
  }
  const bytes = new Uint8Array(await prefix.arrayBuffer())
  return new TextDecoder().decode(bytes).startsWith('%PDF-')
}

async function handleUploadComplete(
  env: Env,
  identity: UserIdentity,
  documentId: string,
): Promise<Response> {
  const document = await getDocumentForUser(
    env.DB,
    identity.id,
    documentId,
  )
  if (!document) {
    throw new ApiError('DOCUMENT_NOT_FOUND', '找不到這份文件。')
  }
  if (document.status === 'ready') {
    return json({
      document: publicDocument(document),
      usage: await getUserStorageUsage(env.DB, identity.id),
    })
  }
  if (!['pending', 'uploading'].includes(document.status)) {
    throw new ApiError(
      'INVALID_UPLOAD_STATE',
      '這份文件目前無法完成上傳。',
    )
  }

  if (
    document.upload_expires_at &&
    document.upload_expires_at <= new Date().toISOString()
  ) {
    const claimed = await beginReservationRelease(
      env.DB,
      identity.id,
      document.id,
      new Date(),
      true,
    )
    if (claimed) {
      await quarantineObjectAndRelease(env, claimed)
    } else {
      const raced = await getDocumentForUser(
        env.DB,
        identity.id,
        document.id,
      )
      if (raced?.status === 'ready') {
        return json({
          document: publicDocument(raced),
          usage: await getUserStorageUsage(env.DB, identity.id),
        })
      }
    }
    throw new ApiError(
      'INVALID_UPLOAD_STATE',
      '這次上傳已過期，請重新選擇 PDF。',
    )
  }

  const object = await env.PDF_BUCKET.head(document.object_key)
  if (!object) {
    throw new ApiError('UPLOAD_NOT_FOUND', '找不到已上傳的 PDF。')
  }

  const actualSizeBytes = object.size
  const validContentType = object.httpMetadata?.contentType === PDF_MIME_TYPE
  const validSignature =
    actualSizeBytes > 0 &&
    (await hasPdfSignature(env.PDF_BUCKET, document.object_key))

  if (
    !Number.isSafeInteger(actualSizeBytes) ||
    actualSizeBytes <= 0 ||
    !validContentType ||
    !validSignature
  ) {
    await quarantineObjectAndRelease(env, document)
    throw new ApiError(
      validContentType && validSignature
        ? 'INVALID_FILE_SIZE'
        : 'INVALID_FILE_TYPE',
      validContentType && validSignature
        ? 'PDF 檔案大小不正確。'
        : '上傳內容不是有效的 PDF。',
    )
  }

  if (actualSizeBytes > DEFAULT_USER_QUOTA.maxFileBytes) {
    await quarantineObjectAndRelease(env, document)
    throw new ApiError('FILE_TOO_LARGE', '單一PDF目前最多100MB。', {
      limitBytes: DEFAULT_USER_QUOTA.maxFileBytes,
      requestedBytes: actualSizeBytes,
    })
  }

  let completed: DocumentRow
  try {
    completed = await completeUpload(
      env.DB,
      identity.id,
      documentId,
      actualSizeBytes,
    )
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === 'STORAGE_QUOTA_EXCEEDED'
    ) {
      await quarantineObjectAndRelease(env, document)
    }
    throw error
  }

  return json({
    document: publicDocument(completed),
    usage: await getUserStorageUsage(env.DB, identity.id),
  })
}

export async function handleAuthenticatedRequest(
  request: Request,
  env: Env,
  identity: UserIdentity,
): Promise<Response> {
  await ensureUser(env.DB, identity)
  const url = new URL(request.url)
  const { pathname } = url

  if (request.method === 'GET' && pathname === '/api/storage/usage') {
    return json(await getUserStorageUsage(env.DB, identity.id))
  }

  if (request.method === 'GET' && pathname === '/api/documents') {
    const documents = await listReadyDocuments(env.DB, identity.id)
    return json({ documents: documents.map(publicDocument) })
  }

  if (
    request.method === 'POST' &&
    pathname === '/api/documents/upload-intent'
  ) {
    const input = validateUploadMetadata(await readJson(request))
    const document = await reserveUpload(env.DB, identity.id, input)

    let uploadUrl: string
    try {
      uploadUrl = await createPresignedUploadUrl(env, document.object_key)
    } catch (error) {
      await releaseReservation(env.DB, identity.id, document.id)
      throw error
    }

    return json(
      {
        document: publicDocument(document),
        upload: {
          url: uploadUrl,
          method: 'PUT',
          headers: {
            'Content-Type': PDF_MIME_TYPE,
            'If-None-Match': '*',
          },
          expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        },
      },
      201,
    )
  }

  const completeMatch = pathname.match(
    /^\/api\/documents\/([^/]+)\/upload-complete$/,
  )
  if (request.method === 'POST' && completeMatch) {
    return handleUploadComplete(env, identity, completeMatch[1])
  }

  const pendingMatch = pathname.match(
    /^\/api\/documents\/([^/]+)\/pending$/,
  )
  if (request.method === 'DELETE' && pendingMatch) {
    const document = await getDocumentForUser(
      env.DB,
      identity.id,
      pendingMatch[1],
    )
    if (!document || document.status === 'failed') {
      return new Response(null, { status: 204 })
    }
    if (!['pending', 'uploading', 'canceling'].includes(document.status)) {
      throw new ApiError(
        'INVALID_UPLOAD_STATE',
        '這份文件已完成上傳，不能當作 pending 上傳取消。',
      )
    }
    const claimed = await beginReservationRelease(
      env.DB,
      identity.id,
      document.id,
    )
    if (!claimed) {
      throw new ApiError(
        'INVALID_UPLOAD_STATE',
        '這份文件已完成上傳，不能當作 pending 上傳取消。',
      )
    }
    await quarantineObjectAndRelease(env, claimed)
    return new Response(null, { status: 204 })
  }

  const downloadMatch = pathname.match(
    /^\/api\/documents\/([^/]+)\/download-url$/,
  )
  if (request.method === 'GET' && downloadMatch) {
    const document = await getDocumentForUser(
      env.DB,
      identity.id,
      downloadMatch[1],
    )
    if (!document || document.status !== 'ready') {
      throw new ApiError('DOCUMENT_NOT_FOUND', '找不到這份文件。')
    }
    return json({
      url: await createPresignedDownloadUrl(env, document.object_key),
    })
  }

  const documentMatch = pathname.match(/^\/api\/documents\/([^/]+)$/)
  if (request.method === 'DELETE' && documentMatch) {
    const document = await beginDocumentDeletion(
      env.DB,
      identity.id,
      documentMatch[1],
    )
    if (!document) {
      return new Response(null, { status: 204 })
    }

    try {
      await env.PDF_BUCKET.delete(document.object_key)
    } catch {
      throw new ApiError(
        'R2_DELETE_FAILED',
        '雲端刪除暫時失敗，請稍後重試。',
      )
    }
    await deleteDocumentAndReleaseUsage(
      env.DB,
      identity.id,
      document.id,
    )
    return new Response(null, { status: 204 })
  }

  throw new ApiError('DOCUMENT_NOT_FOUND', '找不到這個 API。')
}

export async function cleanupExpiredUploads(
  env: Env,
  now = new Date(),
): Promise<{ released: number; retryable: number }> {
  const expired = await listExpiredUploads(env.DB, now)
  let released = 0
  let retryable = 0

  for (const document of expired) {
    try {
      const claimed = await beginReservationRelease(
        env.DB,
        document.user_id,
        document.id,
        now,
        true,
      )
      if (!claimed) {
        continue
      }
      if (await quarantineObjectAndRelease(env, claimed)) {
        released += 1
      }
    } catch {
      retryable += 1
    }
  }

  const expiredFailed = await listExpiredFailedUploads(env.DB, now)
  for (const document of expiredFailed) {
    try {
      await env.PDF_BUCKET.delete(document.object_key)
      await deleteFailedUploadRecord(
        env.DB,
        document.user_id,
        document.id,
      )
    } catch {
      retryable += 1
    }
  }

  return { released, retryable }
}

async function handleAdminReconciliation(
  request: Request,
  env: Env,
): Promise<Response> {
  if (
    !env.ADMIN_SECRET ||
    request.headers.get('X-Admin-Secret') !== env.ADMIN_SECRET
  ) {
    throw new ApiError('FORBIDDEN', '沒有 reconciliation 權限。')
  }
  const body = await readJson(request)
  const candidate = body as { userId?: unknown; apply?: unknown }
  if (typeof candidate.userId !== 'string' || !candidate.userId) {
    throw new ApiError('INVALID_REQUEST', '必須提供 userId。')
  }
  const apply = candidate.apply === true
  return json(
    await reconcileUserStorage(env.DB, candidate.userId, apply),
  )
}

function withCors(response: Response, request: Request, env: Env): Response {
  const origin = request.headers.get('Origin')
  if (!origin || origin !== env.ALLOWED_ORIGIN) {
    return response
  }
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Credentials', 'true')
  headers.set('Vary', 'Origin')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    })
  }

  const url = new URL(request.url)
  if (
    request.method === 'POST' &&
    url.pathname === '/api/admin/storage/reconcile'
  ) {
    return handleAdminReconciliation(request, env)
  }

  const identity = await authenticateRequest(request, env)
  return handleAuthenticatedRequest(request, env, identity)
}

function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...error.details,
        },
      },
      error.status,
    )
  }

  console.error(error)
  return json(
    { error: { code: 'INTERNAL_ERROR', message: '伺服器暫時無法處理請求。' } },
    500,
  )
}

export default {
  async fetch(request, env) {
    try {
      return withCors(await handleRequest(request, env), request, env)
    } catch (error) {
      return withCors(errorResponse(error), request, env)
    }
  },

  scheduled(_controller, env, context) {
    context.waitUntil(cleanupExpiredUploads(env))
  },
} satisfies ExportedHandler<Env>
