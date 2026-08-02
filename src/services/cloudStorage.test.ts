import { describe, expect, it, vi } from 'vitest'
import {
  CloudApiError,
  describeCloudError,
  formatDecimalBytes,
  getStorageUsage,
  uploadCloudDocument,
} from './cloudStorage'

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

describe('cloudStorage', () => {
  it('loads usage with the Google ID token', async () => {
    const usage = {
      documents: { used: 1, reserved: 0, limit: 100 },
      storage: {
        usedBytes: 10,
        reservedBytes: 0,
        limitBytes: 2_000_000_000,
        remainingBytes: 1_999_999_990,
        usageRatio: 0.000000005,
      },
      warning: false,
      canUpload: true,
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(usage),
    )

    await expect(getStorageUsage('id-token', fetchMock)).resolves.toEqual(
      usage,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/storage/usage',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    )
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('Authorization')).toBe('Bearer id-token')
  })

  it('reserves, uploads directly to R2, then completes', async () => {
    const completed = {
      document: {
        id: 'document-1',
        name: 'book.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 9,
        status: 'ready',
        createdAt: '2026-07-31T00:00:00.000Z',
        updatedAt: '2026-07-31T00:00:01.000Z',
      },
      usage: {
        documents: { used: 1, reserved: 0, limit: 100 },
        storage: {
          usedBytes: 9,
          reservedBytes: 0,
          limitBytes: 2_000_000_000,
          remainingBytes: 1_999_999_991,
          usageRatio: 4.5e-9,
        },
        warning: false,
        canUpload: true,
      },
    }
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            document: { ...completed.document, status: 'pending' },
            upload: {
              url: 'https://r2.test/signed',
              method: 'PUT',
              headers: { 'Content-Type': 'application/pdf' },
              expiresInSeconds: 600,
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(completed))
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' })

    await expect(
      uploadCloudDocument(
        { name: 'book.pdf', blob },
        'id-token',
        fetchMock,
      ),
    ).resolves.toEqual(completed)

    expect(fetchMock.mock.calls[1][0]).toBe('https://r2.test/signed')
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      body: blob,
    })
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      '/api/documents/document-1/upload-complete',
    )
  })

  it('releases the pending reservation when direct R2 upload fails', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            document: { id: 'pending-1' },
            upload: {
              url: 'https://r2.test/signed',
              method: 'PUT',
              headers: { 'Content-Type': 'application/pdf' },
              expiresInSeconds: 600,
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(
      uploadCloudDocument(
        {
          name: 'book.pdf',
          blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
        },
        'id-token',
        fetchMock,
      ),
    ).rejects.toMatchObject({ code: 'R2_UPLOAD_FAILED' })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      '/api/documents/pending-1/pending',
    )
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE')
  })

  it('describes quota errors using API-provided per-user values', () => {
    const error = new CloudApiError(
      'STORAGE_QUOTA_EXCEEDED',
      '你的雲端儲存空間不足。',
      409,
      {
        limitBytes: 2_000_000_000,
        usedBytes: 1_900_000_000,
        reservedBytes: 50_000_000,
        requestedBytes: 100_000_000,
      },
    )

    expect(describeCloudError(error)).toBe(
      '需要 100 MB，目前只剩 50 MB。請前往文件庫整理。',
    )
  })

  it('formats decimal MB and GB without binary conversion', () => {
    expect(formatDecimalBytes(812_000_000)).toBe('812 MB')
    expect(formatDecimalBytes(2_000_000_000)).toBe('2 GB')
  })
})

