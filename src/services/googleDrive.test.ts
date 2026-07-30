import { describe, expect, it, vi } from 'vitest'
import { downloadDrivePdf } from './googleDrive'

describe('downloadDrivePdf', () => {
  it('downloads through the Drive API with a Bearer Authorization header', async () => {
    const downloadedBlob = new Blob(['pdf'], { type: 'application/pdf' })
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => {
      return {
        ok: true,
        status: 200,
        blob: async () => downloadedBlob,
      } as Response
    })

    const blob = await downloadDrivePdf(
      {
        id: 'file id',
        name: 'drive.pdf',
        mimeType: 'application/pdf',
      },
      'memory-only-token',
      fetchMock as typeof fetch,
    )

    const [url, options] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(
      'https://www.googleapis.com/drive/v3/files/file%20id?alt=media',
    )
    expect(new Headers(options?.headers).get('Authorization')).toBe(
      'Bearer memory-only-token',
    )
    expect(blob.type).toBe('application/pdf')
  })
})
