import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import {
  cleanupExpiredUploads,
  handleAuthenticatedRequest,
} from '../index'
import {
  beginReservationRelease,
  completeUpload,
  ensureUser,
  getDocumentForUser,
  getUserQuota,
  getUserStorageUsage,
  listReadyDocuments,
  reconcileUserStorage,
  releaseReservation,
  reserveUpload,
  validateUploadMetadata,
} from '../quotaService'
import type { DocumentRow, UserIdentity } from '../types'

const MB = 1_000_000
const GB = 1_000_000_000

function user(label: string): UserIdentity {
  return { id: `${label}-${crypto.randomUUID()}`, email: `${label}@test.dev` }
}

async function createUser(label: string): Promise<UserIdentity> {
  const identity = user(label)
  await ensureUser(env.DB, identity)
  return identity
}

async function setCounters(
  userId: string,
  values: {
    quota?: number
    used?: number
    reserved?: number
    ready?: number
    reservedDocuments?: number
    documentLimit?: number
  },
): Promise<void> {
  const current = await getUserQuota(env.DB, userId)
  await env.DB.prepare(
    `UPDATE users SET
       storage_quota_bytes = ?, storage_used_bytes = ?,
       storage_reserved_bytes = ?, ready_document_count = ?,
       reserved_document_count = ?, document_limit = ?
     WHERE id = ?`,
  )
    .bind(
      values.quota ?? current.storage_quota_bytes,
      values.used ?? current.storage_used_bytes,
      values.reserved ?? current.storage_reserved_bytes,
      values.ready ?? current.ready_document_count,
      values.reservedDocuments ?? current.reserved_document_count,
      values.documentLimit ?? current.document_limit,
      userId,
    )
    .run()
}

function reserve(
  identity: UserIdentity,
  sizeBytes: number,
  now?: Date,
): Promise<DocumentRow> {
  return reserveUpload(
    env.DB,
    identity.id,
    {
      name: 'book.pdf',
      mimeType: 'application/pdf',
      sizeBytes,
    },
    now,
  )
}

async function putPdf(document: DocumentRow, size = 20): Promise<void> {
  const body = '%PDF-1.7'.padEnd(size, 'x')
  await env.PDF_BUCKET.put(document.object_key, body, {
    httpMetadata: { contentType: 'application/pdf' },
  })
}

describe('D1-backed storage quota', () => {
  it('gives new users the default 2 GB and 100 document quota', async () => {
    const identity = await createUser('defaults')
    const usage = await getUserStorageUsage(env.DB, identity.id)

    expect(usage.storage.limitBytes).toBe(2 * GB)
    expect(usage.documents.limit).toBe(100)
    expect(usage.storage.usedBytes).toBe(0)
    expect(usage.canUpload).toBe(true)
  })

  it('rejects the next reservation at 99 ready plus 1 pending', async () => {
    const identity = await createUser('document-limit')
    await setCounters(identity.id, { ready: 99 })
    await reserve(identity, 1)

    await expect(reserve(identity, 1)).rejects.toMatchObject({
      code: 'DOCUMENT_LIMIT_REACHED',
    })
  })

  it('rejects 100 MB when 1.95 GB is already used', async () => {
    const identity = await createUser('almost-full')
    await setCounters(identity.id, { used: 1.95 * GB })

    await expect(reserve(identity, 100 * MB)).rejects.toMatchObject({
      code: 'STORAGE_QUOTA_EXCEEDED',
    })
  })

  it('accepts 100 MB when 1.8 GB is used', async () => {
    const identity = await createUser('enough-room')
    await setCounters(identity.id, { used: 1.8 * GB })

    await expect(reserve(identity, 100 * MB)).resolves.toMatchObject({
      size_bytes: 100 * MB,
      status: 'pending',
    })
  })

  it('accepts exactly 100 MB and rejects one byte more', async () => {
    const accepted = await createUser('file-boundary')
    const rejected = await createUser('file-too-large')

    await expect(reserve(accepted, 100 * MB)).resolves.toBeTruthy()
    await expect(reserve(rejected, 100 * MB + 1)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    })
  })

  it('validates positive integer sizes, MIME type, and PDF extension', () => {
    expect(() =>
      validateUploadMetadata({
        name: 'bad.txt',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_FILE_TYPE' }))
    expect(() =>
      validateUploadMetadata({
        name: 'book.pdf',
        mimeType: 'text/plain',
        sizeBytes: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_FILE_TYPE' }))
    expect(() =>
      validateUploadMetadata({
        name: 'book.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1.5,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_FILE_SIZE' }))
  })

  it('reserves bytes and a document immediately', async () => {
    const identity = await createUser('reservation')
    await reserve(identity, 25 * MB)
    const usage = await getUserStorageUsage(env.DB, identity.id)

    expect(usage.storage.reservedBytes).toBe(25 * MB)
    expect(usage.documents.reserved).toBe(1)
    expect(usage.storage.remainingBytes).toBe(1_975_000_000)
  })

  it('serializes concurrent reservations so they cannot exceed quota', async () => {
    const identity = await createUser('concurrent')
    await setCounters(identity.id, { quota: 150 * MB })

    const results = await Promise.allSettled([
      reserve(identity, 100 * MB),
      reserve(identity, 100 * MB),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await getUserStorageUsage(env.DB, identity.id)).storage.reservedBytes).toBe(
      100 * MB,
    )
  })

  it('moves reserved usage to real usage on completion', async () => {
    const identity = await createUser('complete')
    const document = await reserve(identity, 10)

    await completeUpload(env.DB, identity.id, document.id, 12)
    const usage = await getUserStorageUsage(env.DB, identity.id)

    expect(usage.storage).toMatchObject({ usedBytes: 12, reservedBytes: 0 })
    expect(usage.documents).toMatchObject({ used: 1, reserved: 0 })
  })

  it('makes upload completion idempotent', async () => {
    const identity = await createUser('complete-twice')
    const document = await reserve(identity, 10)

    await completeUpload(env.DB, identity.id, document.id, 12)
    await completeUpload(env.DB, identity.id, document.id, 12)

    expect(await getUserStorageUsage(env.DB, identity.id)).toMatchObject({
      documents: { used: 1, reserved: 0 },
      storage: { usedBytes: 12, reservedBytes: 0 },
    })
  })

  it('uses actual R2 size and cleans up when it no longer fits', async () => {
    const identity = await createUser('actual-size')
    await setCounters(identity.id, { quota: 20, used: 10 })
    const document = await reserve(identity, 5)
    await putPdf(document, 15)

    await expect(
      handleAuthenticatedRequest(
        new Request(
          `https://api.test/api/documents/${document.id}/upload-complete`,
          { method: 'POST' },
        ),
        env,
        identity,
      ),
    ).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' })

    expect(await env.PDF_BUCKET.head(document.object_key)).toMatchObject({
      size: 0,
      httpMetadata: {
        contentType: 'application/x-pocket-pdf-upload-tombstone',
      },
    })
    expect(await getUserStorageUsage(env.DB, identity.id)).toMatchObject({
      documents: { used: 0, reserved: 0 },
      storage: { usedBytes: 10, reservedBytes: 0 },
    })
  })

  it('releases expired uploads and remains idempotent when rerun', async () => {
    const identity = await createUser('expired')
    const startedAt = new Date('2026-07-31T00:00:00.000Z')
    await reserve(identity, 50, startedAt)
    const cleanupAt = new Date('2026-07-31T00:31:00.000Z')

    await expect(cleanupExpiredUploads(env, cleanupAt)).resolves.toEqual({
      released: 1,
      retryable: 0,
    })
    await expect(cleanupExpiredUploads(env, cleanupAt)).resolves.toEqual({
      released: 0,
      retryable: 0,
    })
    expect((await getUserStorageUsage(env.DB, identity.id)).storage.reservedBytes).toBe(0)
  })

  it('claims cleanup before R2 deletion so completion cannot win the race', async () => {
    const identity = await createUser('cleanup-claim')
    const startedAt = new Date('2026-07-31T00:00:00.000Z')
    const cleanupAt = new Date('2026-07-31T00:31:00.000Z')
    const document = await reserve(identity, 10, startedAt)
    const claimed = await beginReservationRelease(
      env.DB,
      identity.id,
      document.id,
      cleanupAt,
      true,
    )

    expect(claimed?.status).toBe('canceling')
    await expect(
      completeUpload(env.DB, identity.id, document.id, 10),
    ).rejects.toMatchObject({ code: 'INVALID_UPLOAD_STATE' })
    await expect(cleanupExpiredUploads(env, cleanupAt)).resolves.toEqual({
      released: 1,
      retryable: 0,
    })
  })

  it('rejects completion after the 30-minute reservation expiry', async () => {
    const identity = await createUser('late-completion')
    const document = await reserve(
      identity,
      10,
      new Date('2020-01-01T00:00:00.000Z'),
    )
    await putPdf(document, 10)

    await expect(
      handleAuthenticatedRequest(
        new Request(
          `https://api.test/api/documents/${document.id}/upload-complete`,
          { method: 'POST' },
        ),
        env,
        identity,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_UPLOAD_STATE' })
    expect((await getUserStorageUsage(env.DB, identity.id)).storage.reservedBytes).toBe(0)
  })

  it('keeps a cancellation tombstone until the signed PUT has expired', async () => {
    const identity = await createUser('cancel-tombstone')
    const startedAt = new Date('2026-07-31T00:00:00.000Z')
    const document = await reserve(identity, 10, startedAt)
    await putPdf(document, 10)

    const response = await handleAuthenticatedRequest(
      new Request(
        `https://api.test/api/documents/${document.id}/pending`,
        { method: 'DELETE' },
      ),
      env,
      identity,
    )
    expect(response.status).toBe(204)
    expect(await env.PDF_BUCKET.head(document.object_key)).toMatchObject({
      size: 0,
    })
    expect((await getUserStorageUsage(env.DB, identity.id)).storage.reservedBytes).toBe(0)

    await cleanupExpiredUploads(
      env,
      new Date('2026-07-31T00:29:00.000Z'),
    )
    expect(await env.PDF_BUCKET.head(document.object_key)).not.toBeNull()

    await cleanupExpiredUploads(
      env,
      new Date('2026-07-31T00:31:00.000Z'),
    )
    expect(await env.PDF_BUCKET.head(document.object_key)).toBeNull()
  })

  it('returns a non-overwritable presigned PUT contract', async () => {
    const identity = await createUser('signed-put')
    const response = await handleAuthenticatedRequest(
      new Request('https://api.test/api/documents/upload-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'book.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
        }),
      }),
      env,
      identity,
    )
    const body = await response.json<{
      upload: { headers: Record<string, string>; expiresInSeconds: number }
    }>()

    expect(response.status).toBe(201)
    expect(body.upload.headers).toEqual({
      'Content-Type': 'application/pdf',
      'If-None-Match': '*',
    })
    expect(body.upload.expiresInSeconds).toBe(600)
  })

  it('deletes a ready document once without negative counters', async () => {
    const identity = await createUser('delete')
    const document = await reserve(identity, 10)
    await completeUpload(env.DB, identity.id, document.id, 10)
    await putPdf(document, 10)
    const request = new Request(
      `https://api.test/api/documents/${document.id}`,
      { method: 'DELETE' },
    )

    expect((await handleAuthenticatedRequest(request, env, identity)).status).toBe(204)
    expect(
      (
        await handleAuthenticatedRequest(
          new Request(request.url, { method: 'DELETE' }),
          env,
          identity,
        )
      ).status,
    ).toBe(204)
    expect(await getUserStorageUsage(env.DB, identity.id)).toMatchObject({
      documents: { used: 0, reserved: 0 },
      storage: { usedBytes: 0, reservedBytes: 0 },
    })
  })

  it('does not let one user read or delete another user document', async () => {
    const owner = await createUser('owner')
    const stranger = await createUser('stranger')
    const document = await reserve(owner, 10)
    await completeUpload(env.DB, owner.id, document.id, 10)

    await expect(
      handleAuthenticatedRequest(
        new Request(
          `https://api.test/api/documents/${document.id}/download-url`,
        ),
        env,
        stranger,
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_NOT_FOUND' })

    const response = await handleAuthenticatedRequest(
      new Request(`https://api.test/api/documents/${document.id}`, {
        method: 'DELETE',
      }),
      env,
      stranger,
    )
    expect(response.status).toBe(204)
    expect((await getUserStorageUsage(env.DB, owner.id)).storage.usedBytes).toBe(10)
  })

  it('applies the same quota to a Google Drive source hint', async () => {
    const identity = await createUser('drive')
    await setCounters(identity.id, { quota: 10, used: 10 })

    await expect(
      handleAuthenticatedRequest(
        new Request('https://api.test/api/documents/upload-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'drive.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1,
            source: 'google-drive',
          }),
        }),
        env,
        identity,
      ),
    ).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' })
  })

  it('keeps documents readable and deletable after quota is lowered', async () => {
    const identity = await createUser('lowered')
    const document = await reserve(identity, 10)
    await completeUpload(env.DB, identity.id, document.id, 10)
    await setCounters(identity.id, { quota: 5 })

    expect(await listReadyDocuments(env.DB, identity.id)).toHaveLength(1)
    const usage = await getUserStorageUsage(env.DB, identity.id)
    expect(usage.canUpload).toBe(false)
    expect(usage.storage.remainingBytes).toBe(-5)

    await putPdf(document, 10)
    const response = await handleAuthenticatedRequest(
      new Request(`https://api.test/api/documents/${document.id}`, {
        method: 'DELETE',
      }),
      env,
      identity,
    )
    expect(response.status).toBe(204)
  })

  it('reports correct cached usage fields and warning state', async () => {
    const identity = await createUser('usage')
    await setCounters(identity.id, {
      quota: 100,
      used: 75,
      reserved: 10,
      ready: 37,
      reservedDocuments: 1,
    })

    expect(await getUserStorageUsage(env.DB, identity.id)).toEqual({
      documents: { used: 37, reserved: 1, limit: 100 },
      storage: {
        usedBytes: 75,
        reservedBytes: 10,
        limitBytes: 100,
        remainingBytes: 15,
        usageRatio: 0.85,
      },
      warning: true,
      canUpload: true,
    })
  })

  it('reconciliation is dry-run unless apply is explicitly true', async () => {
    const identity = await createUser('reconcile')
    const document = await reserve(identity, 10)
    await releaseReservation(env.DB, identity.id, document.id)
    await setCounters(identity.id, { used: 999, ready: 9 })

    const dryRun = await reconcileUserStorage(env.DB, identity.id, false)
    expect(dryRun).toMatchObject({ differs: true, applied: false })
    expect((await getUserQuota(env.DB, identity.id)).storage_used_bytes).toBe(999)

    const applied = await reconcileUserStorage(env.DB, identity.id, true)
    expect(applied).toMatchObject({ differs: true, applied: true })
    expect((await getUserQuota(env.DB, identity.id)).storage_used_bytes).toBe(0)
  })

  it('cleanup stays safe after reconciliation excludes an expired reservation', async () => {
    const identity = await createUser('reconcile-expired')
    const startedAt = new Date('2026-07-31T00:00:00.000Z')
    const cleanupAt = new Date('2026-07-31T00:31:00.000Z')
    const document = await reserve(identity, 10, startedAt)

    await reconcileUserStorage(env.DB, identity.id, true, cleanupAt)
    await expect(cleanupExpiredUploads(env, cleanupAt)).resolves.toEqual({
      released: 1,
      retryable: 0,
    })
    expect((await getUserQuota(env.DB, identity.id)).storage_reserved_bytes).toBe(0)
    expect(
      await getDocumentForUser(env.DB, identity.id, document.id),
    ).toBeNull()
  })

  it('never creates a pending row when reservation is rejected', async () => {
    const identity = await createUser('no-pending')
    await setCounters(identity.id, { quota: 0 })

    await expect(reserve(identity, 1)).rejects.toMatchObject({
      code: 'STORAGE_QUOTA_EXCEEDED',
    })
    expect(
      await getDocumentForUser(env.DB, identity.id, 'missing-document'),
    ).toBeNull()
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM documents WHERE user_id = ?',
    )
      .bind(identity.id)
      .first<{ count: number }>()
    expect(count?.count).toBe(0)
  })
})
