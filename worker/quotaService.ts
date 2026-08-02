import {
  DEFAULT_USER_QUOTA,
  PDF_MIME_TYPE,
  UPLOAD_RESERVATION_TTL_MS,
} from './constants'
import { ApiError, mapDatabaseError } from './errors'
import type {
  DocumentRow,
  StorageUsage,
  UserIdentity,
  UserRow,
} from './types'

interface ReserveUploadInput {
  name: string
  mimeType: string
  sizeBytes: number
}

interface ReconciliationSnapshot {
  userId: string
  cached: {
    usedBytes: number
    reservedBytes: number
    readyDocuments: number
    reservedDocuments: number
  }
  calculated: {
    usedBytes: number
    reservedBytes: number
    readyDocuments: number
    reservedDocuments: number
  }
  differs: boolean
  applied: boolean
}

interface ReconciliationRow {
  used_bytes: number
  reserved_bytes: number
  ready_count: number
  reserved_count: number
}

function changes(result: D1Result): number {
  return result.meta.changes ?? 0
}

function enrichQuotaError(
  error: ApiError,
  user: UserRow,
  requestedBytes?: number,
): ApiError {
  if (error.code === 'DOCUMENT_LIMIT_REACHED') {
    return new ApiError(error.code, error.message, {
      limit: user.document_limit,
      used: user.ready_document_count,
      reserved: user.reserved_document_count,
    })
  }
  if (error.code === 'STORAGE_QUOTA_EXCEEDED') {
    return new ApiError(error.code, error.message, {
      limitBytes: user.storage_quota_bytes,
      usedBytes: user.storage_used_bytes,
      reservedBytes: user.storage_reserved_bytes,
      ...(requestedBytes === undefined ? {} : { requestedBytes }),
    })
  }
  return error
}

export async function ensureUser(
  db: D1Database,
  identity: UserIdentity,
  now = new Date(),
): Promise<void> {
  const timestamp = now.toISOString()
  await db
    .prepare(
      `INSERT INTO users (
        id, email, storage_quota_bytes, storage_used_bytes,
        storage_reserved_bytes, document_limit, ready_document_count,
        reserved_document_count, created_at, updated_at
      ) VALUES (?, ?, ?, 0, 0, ?, 0, 0, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      identity.id,
      identity.email ?? null,
      DEFAULT_USER_QUOTA.maxTotalBytes,
      DEFAULT_USER_QUOTA.maxDocuments,
      timestamp,
      timestamp,
    )
    .run()

  if (identity.email) {
    await db
      .prepare(
        `UPDATE users SET email = ?, updated_at = ?
         WHERE id = ? AND (email IS NULL OR email <> ?)`,
      )
      .bind(identity.email, timestamp, identity.id, identity.email)
      .run()
  }
}

export async function getUserQuota(
  db: D1Database,
  userId: string,
): Promise<UserRow> {
  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRow>()

  if (!user) {
    throw new ApiError('UNAUTHORIZED', '找不到目前的使用者。')
  }
  return user
}

export async function getUserStorageUsage(
  db: D1Database,
  userId: string,
): Promise<StorageUsage> {
  const user = await getUserQuota(db, userId)
  const occupiedBytes =
    user.storage_used_bytes + user.storage_reserved_bytes
  const occupiedDocuments =
    user.ready_document_count + user.reserved_document_count
  const usageRatio =
    user.storage_quota_bytes === 0
      ? 1
      : occupiedBytes / user.storage_quota_bytes

  return {
    documents: {
      used: user.ready_document_count,
      reserved: user.reserved_document_count,
      limit: user.document_limit,
    },
    storage: {
      usedBytes: user.storage_used_bytes,
      reservedBytes: user.storage_reserved_bytes,
      limitBytes: user.storage_quota_bytes,
      remainingBytes: user.storage_quota_bytes - occupiedBytes,
      usageRatio,
    },
    warning: usageRatio >= DEFAULT_USER_QUOTA.warningThreshold,
    canUpload:
      occupiedBytes < user.storage_quota_bytes &&
      occupiedDocuments < user.document_limit,
  }
}

export async function reserveUpload(
  db: D1Database,
  userId: string,
  input: ReserveUploadInput,
  now = new Date(),
): Promise<DocumentRow> {
  input = validateUploadMetadata(input)
  if (input.sizeBytes > DEFAULT_USER_QUOTA.maxFileBytes) {
    throw new ApiError('FILE_TOO_LARGE', '單一PDF目前最多100MB。', {
      limitBytes: DEFAULT_USER_QUOTA.maxFileBytes,
      requestedBytes: input.sizeBytes,
    })
  }

  const id = crypto.randomUUID()
  const timestamp = now.toISOString()
  const expiresAt = new Date(
    now.getTime() + UPLOAD_RESERVATION_TTL_MS,
  ).toISOString()
  const objectKey = `documents/${crypto.randomUUID()}.pdf`

  try {
    const result = await db
      .prepare(
        `INSERT INTO documents (
          id, user_id, object_key, original_name, mime_type, size_bytes,
          status, created_at, updated_at, upload_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .bind(
        id,
        userId,
        objectKey,
        input.name,
        input.mimeType,
        input.sizeBytes,
        timestamp,
        timestamp,
        expiresAt,
      )
      .run()

    if (changes(result) < 1) {
      throw new Error('Reservation INSERT did not affect any rows')
    }
  } catch (error) {
    const quotaError = mapDatabaseError(error)
    if (quotaError) {
      const user = await getUserQuota(db, userId)
      throw enrichQuotaError(quotaError, user, input.sizeBytes)
    }
    throw error
  }

  const document = await getDocumentForUser(db, userId, id)
  if (!document) {
    throw new Error('Reserved document could not be read back')
  }
  return document
}

export async function completeUpload(
  db: D1Database,
  userId: string,
  documentId: string,
  actualSizeBytes: number,
  now = new Date(),
): Promise<DocumentRow> {
  if (!Number.isSafeInteger(actualSizeBytes) || actualSizeBytes <= 0) {
    throw new ApiError(
      'INVALID_FILE_SIZE',
      'PDF 檔案大小必須是正整數。',
    )
  }
  if (actualSizeBytes > DEFAULT_USER_QUOTA.maxFileBytes) {
    throw new ApiError('FILE_TOO_LARGE', '單一PDF目前最多100MB。', {
      limitBytes: DEFAULT_USER_QUOTA.maxFileBytes,
      requestedBytes: actualSizeBytes,
    })
  }

  const current = await getDocumentForUser(db, userId, documentId)
  if (!current) {
    throw new ApiError('DOCUMENT_NOT_FOUND', '找不到這份文件。')
  }
  if (current.status === 'ready') {
    return current
  }
  if (!['pending', 'uploading'].includes(current.status)) {
    throw new ApiError(
      'INVALID_UPLOAD_STATE',
      '這份文件目前無法完成上傳。',
    )
  }

  try {
    const result = await db
      .prepare(
        `UPDATE documents
         SET size_bytes = ?, status = 'ready', updated_at = ?,
             upload_expires_at = NULL
         WHERE id = ? AND user_id = ?
           AND status IN ('pending', 'uploading')`,
      )
      .bind(actualSizeBytes, now.toISOString(), documentId, userId)
      .run()

    if (changes(result) === 0) {
      const raced = await getDocumentForUser(db, userId, documentId)
      if (raced?.status === 'ready') {
        return raced
      }
      throw new ApiError(
        'INVALID_UPLOAD_STATE',
        '這份文件目前無法完成上傳。',
      )
    }
  } catch (error) {
    const quotaError = mapDatabaseError(error)
    if (quotaError) {
      const user = await getUserQuota(db, userId)
      throw enrichQuotaError(quotaError, user, actualSizeBytes)
    }
    throw error
  }

  const completed = await getDocumentForUser(db, userId, documentId)
  if (!completed) {
    throw new Error('Completed document could not be read back')
  }
  return completed
}

export async function releaseReservation(
  db: D1Database,
  userId: string,
  documentId: string,
  now = new Date(),
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE documents
       SET status = 'failed', updated_at = ?
       WHERE id = ? AND user_id = ?
         AND status IN ('pending', 'uploading', 'canceling')`,
    )
    .bind(now.toISOString(), documentId, userId)
    .run()
  return changes(result) > 0
}

export async function beginReservationRelease(
  db: D1Database,
  userId: string,
  documentId: string,
  now = new Date(),
  expiredOnly = false,
): Promise<DocumentRow | null> {
  const result = await db
    .prepare(
      `UPDATE documents
       SET status = 'canceling', updated_at = ?
       WHERE id = ? AND user_id = ?
         AND status IN ('pending', 'uploading')
         AND (? = 0 OR upload_expires_at <= ?)`,
    )
    .bind(
      now.toISOString(),
      documentId,
      userId,
      expiredOnly ? 1 : 0,
      now.toISOString(),
    )
    .run()

  if (changes(result) > 0) {
    const claimed = await getDocumentForUser(db, userId, documentId)
    if (claimed?.status !== 'canceling') {
      throw new Error('Claimed reservation did not enter canceling state')
    }
    return claimed
  }

  const current = await getDocumentForUser(db, userId, documentId)
  return current?.status === 'canceling' ? current : null
}

export async function beginDocumentDeletion(
  db: D1Database,
  userId: string,
  documentId: string,
  now = new Date(),
): Promise<DocumentRow | null> {
  const current = await getDocumentForUser(db, userId, documentId)
  if (!current) {
    return null
  }
  if (current.status === 'deleting') {
    return current
  }
  if (current.status !== 'ready') {
    throw new ApiError(
      'INVALID_UPLOAD_STATE',
      '這份文件目前無法刪除。',
    )
  }

  const result = await db
    .prepare(
      `UPDATE documents SET status = 'deleting', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'ready'`,
    )
    .bind(now.toISOString(), documentId, userId)
    .run()

  if (changes(result) === 0) {
    return getDocumentForUser(db, userId, documentId)
  }
  return { ...current, status: 'deleting', updated_at: now.toISOString() }
}

export async function deleteDocumentAndReleaseUsage(
  db: D1Database,
  userId: string,
  documentId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM documents
       WHERE id = ? AND user_id = ? AND status = 'deleting'`,
    )
    .bind(documentId, userId)
    .run()
  return changes(result) > 0
}

export async function getDocumentForUser(
  db: D1Database,
  userId: string,
  documentId: string,
): Promise<DocumentRow | null> {
  return db
    .prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
    .bind(documentId, userId)
    .first<DocumentRow>()
}

export async function listReadyDocuments(
  db: D1Database,
  userId: string,
): Promise<DocumentRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM documents
       WHERE user_id = ? AND status = 'ready'
       ORDER BY updated_at DESC`,
    )
    .bind(userId)
    .all<DocumentRow>()
  return result.results
}

export async function listExpiredUploads(
  db: D1Database,
  now = new Date(),
  limit = 100,
): Promise<DocumentRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM documents
       WHERE (status IN ('pending', 'uploading') AND upload_expires_at <= ?)
          OR status = 'canceling'
       ORDER BY upload_expires_at
       LIMIT ?`,
    )
    .bind(now.toISOString(), limit)
    .all<DocumentRow>()
  return result.results
}

export async function listExpiredFailedUploads(
  db: D1Database,
  now = new Date(),
  limit = 100,
): Promise<DocumentRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM documents
       WHERE status = 'failed' AND upload_expires_at <= ?
       ORDER BY upload_expires_at
       LIMIT ?`,
    )
    .bind(now.toISOString(), limit)
    .all<DocumentRow>()
  return result.results
}

export async function deleteFailedUploadRecord(
  db: D1Database,
  userId: string,
  documentId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM documents
       WHERE id = ? AND user_id = ? AND status = 'failed'`,
    )
    .bind(documentId, userId)
    .run()
  return changes(result) > 0
}

export async function reconcileUserStorage(
  db: D1Database,
  userId: string,
  apply: boolean,
  now = new Date(),
): Promise<ReconciliationSnapshot> {
  const user = await getUserQuota(db, userId)
  const calculated = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('ready', 'deleting') THEN size_bytes ELSE 0 END), 0) AS used_bytes,
         COALESCE(SUM(CASE WHEN (status IN ('pending', 'uploading') AND upload_expires_at > ?) OR status = 'canceling' THEN size_bytes ELSE 0 END), 0) AS reserved_bytes,
         COALESCE(SUM(CASE WHEN status IN ('ready', 'deleting') THEN 1 ELSE 0 END), 0) AS ready_count,
         COALESCE(SUM(CASE WHEN (status IN ('pending', 'uploading') AND upload_expires_at > ?) OR status = 'canceling' THEN 1 ELSE 0 END), 0) AS reserved_count
       FROM documents WHERE user_id = ?`,
    )
    .bind(now.toISOString(), now.toISOString(), userId)
    .first<ReconciliationRow>()

  if (!calculated) {
    throw new Error('Reconciliation query returned no row')
  }

  const differs =
    user.storage_used_bytes !== calculated.used_bytes ||
    user.storage_reserved_bytes !== calculated.reserved_bytes ||
    user.ready_document_count !== calculated.ready_count ||
    user.reserved_document_count !== calculated.reserved_count

  if (apply && differs) {
    await db
      .prepare(
        `UPDATE users SET
           storage_used_bytes = ?, storage_reserved_bytes = ?,
           ready_document_count = ?, reserved_document_count = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        calculated.used_bytes,
        calculated.reserved_bytes,
        calculated.ready_count,
        calculated.reserved_count,
        now.toISOString(),
        userId,
      )
      .run()
  }

  return {
    userId,
    cached: {
      usedBytes: user.storage_used_bytes,
      reservedBytes: user.storage_reserved_bytes,
      readyDocuments: user.ready_document_count,
      reservedDocuments: user.reserved_document_count,
    },
    calculated: {
      usedBytes: calculated.used_bytes,
      reservedBytes: calculated.reserved_bytes,
      readyDocuments: calculated.ready_count,
      reservedDocuments: calculated.reserved_count,
    },
    differs,
    applied: apply && differs,
  }
}

export function validateUploadMetadata(input: unknown): ReserveUploadInput {
  if (!input || typeof input !== 'object') {
    throw new ApiError('INVALID_REQUEST', '上傳資料格式不正確。')
  }

  const candidate = input as Record<string, unknown>
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const mimeType = candidate.mimeType
  const sizeBytes = candidate.sizeBytes

  if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0) {
    throw new ApiError(
      'INVALID_FILE_SIZE',
      'PDF 檔案大小必須是正整數。',
    )
  }
  if (
    mimeType !== PDF_MIME_TYPE ||
    !name.toLowerCase().endsWith('.pdf') ||
    name.length > 255
  ) {
    throw new ApiError('INVALID_FILE_TYPE', '請選擇有效的 PDF 檔案。')
  }

  return { name, mimeType, sizeBytes: sizeBytes as number }
}
