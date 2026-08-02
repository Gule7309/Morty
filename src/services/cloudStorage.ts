import { assertPdfBlob } from '../features/import/pdfValidation'

export interface StorageUsage {
  documents: {
    used: number
    reserved: number
    limit: number
  }
  storage: {
    usedBytes: number
    reservedBytes: number
    limitBytes: number
    remainingBytes: number
    usageRatio: number
  }
  warning: boolean
  canUpload: boolean
}

export interface CloudDocument {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  status:
    | 'pending'
    | 'uploading'
    | 'ready'
    | 'failed'
    | 'canceling'
    | 'deleting'
  createdAt: string
  updatedAt: string
}

interface ErrorBody {
  error?: {
    code?: string
    message?: string
    [key: string]: unknown
  }
}

interface UploadIntentResponse {
  document: CloudDocument
  upload: {
    url: string
    method: 'PUT'
    headers: Record<string, string>
    expiresInSeconds: number
  }
}

interface UploadCompleteResponse {
  document: CloudDocument
  usage: StorageUsage
}

export class CloudApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(
    code: string,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'CloudApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

function apiUrl(path: string): string {
  const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''
  return `${base}${path}`
}

async function errorFromResponse(response: Response): Promise<CloudApiError> {
  let body: ErrorBody = {}
  try {
    body = (await response.json()) as ErrorBody
  } catch {
    // The fallback below is used for non-JSON proxy or network responses.
  }

  const error = body.error
  const { code, message, ...details } = error ?? {}
  return new CloudApiError(
    code ?? 'REQUEST_FAILED',
    message ?? `雲端請求失敗（${response.status}）。`,
    response.status,
    details,
  )
}

async function authorizedJson<T>(
  path: string,
  idToken: string,
  init: RequestInit = {},
  fetchImplementation: typeof fetch = fetch,
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${idToken}`)
  if (init.body) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetchImplementation(apiUrl(path), {
    ...init,
    headers,
  })
  if (!response.ok) {
    throw await errorFromResponse(response)
  }
  return (await response.json()) as T
}

export function getStorageUsage(
  idToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<StorageUsage> {
  return authorizedJson(
    '/api/storage/usage',
    idToken,
    {},
    fetchImplementation,
  )
}

export async function listCloudDocuments(
  idToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<CloudDocument[]> {
  const result = await authorizedJson<{ documents: CloudDocument[] }>(
    '/api/documents',
    idToken,
    {},
    fetchImplementation,
  )
  return result.documents
}

async function cancelPendingUpload(
  documentId: string,
  idToken: string,
  fetchImplementation: typeof fetch,
): Promise<void> {
  try {
    await fetchImplementation(
      apiUrl(`/api/documents/${encodeURIComponent(documentId)}/pending`),
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      },
    )
  } catch {
    // Expiration cleanup remains the fallback if immediate cancellation fails.
  }
}

export async function uploadCloudDocument(
  input: { name: string; blob: Blob },
  idToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<UploadCompleteResponse> {
  const intent = await authorizedJson<UploadIntentResponse>(
    '/api/documents/upload-intent',
    idToken,
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        sizeBytes: input.blob.size,
        mimeType: 'application/pdf',
      }),
    },
    fetchImplementation,
  )

  let uploadResponse: Response
  try {
    uploadResponse = await fetchImplementation(intent.upload.url, {
      method: intent.upload.method,
      headers: intent.upload.headers,
      body: input.blob,
    })
  } catch (error) {
    await cancelPendingUpload(
      intent.document.id,
      idToken,
      fetchImplementation,
    )
    throw error
  }

  if (!uploadResponse.ok) {
    await cancelPendingUpload(
      intent.document.id,
      idToken,
      fetchImplementation,
    )
    throw new CloudApiError(
      'R2_UPLOAD_FAILED',
      `PDF 上傳失敗（${uploadResponse.status}）。`,
      uploadResponse.status,
    )
  }

  return authorizedJson<UploadCompleteResponse>(
    `/api/documents/${encodeURIComponent(intent.document.id)}/upload-complete`,
    idToken,
    { method: 'POST' },
    fetchImplementation,
  )
}

export async function downloadCloudDocument(
  document: CloudDocument,
  idToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Blob> {
  const { url } = await authorizedJson<{ url: string }>(
    `/api/documents/${encodeURIComponent(document.id)}/download-url`,
    idToken,
    {},
    fetchImplementation,
  )
  const response = await fetchImplementation(url)
  if (!response.ok) {
    throw new CloudApiError(
      'R2_DOWNLOAD_FAILED',
      `PDF 下載失敗（${response.status}）。`,
      response.status,
    )
  }
  const blob = await response.blob()
  assertPdfBlob(blob, document.name)
  return blob
}

export async function deleteCloudDocument(
  documentId: string,
  idToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImplementation(
    apiUrl(`/api/documents/${encodeURIComponent(documentId)}`),
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    },
  )
  if (!response.ok) {
    throw await errorFromResponse(response)
  }
}

export function describeCloudError(error: unknown): string {
  if (!(error instanceof CloudApiError)) {
    return error instanceof Error ? error.message : '雲端操作失敗，請稍後再試。'
  }

  if (error.code === 'STORAGE_QUOTA_EXCEEDED') {
    const requested = Number(error.details.requestedBytes)
    const limit = Number(error.details.limitBytes)
    const used = Number(error.details.usedBytes)
    const reserved = Number(error.details.reservedBytes)
    if ([requested, limit, used, reserved].every(Number.isFinite)) {
      const remaining = Math.max(0, limit - used - reserved)
      return `需要 ${formatDecimalBytes(requested)}，目前只剩 ${formatDecimalBytes(remaining)}。請前往文件庫整理。`
    }
  }
  if (error.code === 'DOCUMENT_LIMIT_REACHED') {
    const limit = Number(error.details.limit)
    if (Number.isFinite(limit)) {
      return `已達${limit}份文件上限，請先刪除一份文件。`
    }
  }
  return error.message
}

export function formatDecimalBytes(bytes: number): string {
  const absolute = Math.abs(bytes)
  if (absolute >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(absolute >= 10_000_000_000 ? 0 : 2).replace(/\.00$/, '')} GB`
  }
  if (absolute >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(absolute >= 100_000_000 ? 0 : 1).replace(/\.0$/, '')} MB`
  }
  if (absolute >= 1_000) {
    return `${(bytes / 1_000).toFixed(1).replace(/\.0$/, '')} KB`
  }
  return `${bytes} bytes`
}
