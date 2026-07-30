import { assertPdfBlob } from '../features/import/pdfValidation'

export interface DriveFileMetadata {
  id: string
  name: string
  mimeType: string
  size?: number
}

export async function downloadDrivePdf(
  file: DriveFileMetadata,
  accessToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Blob> {
  const response = await fetchImplementation(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Google 登入已過期，請重新選擇檔案。')
    }
    if (response.status === 403) {
      throw new Error('沒有權限下載這份 Google Drive PDF。')
    }
    if (response.status === 404) {
      throw new Error('找不到這份 Google Drive PDF。')
    }
    throw new Error(`Google Drive 下載失敗（${response.status}）。`)
  }

  const blob = await response.blob()
  assertPdfBlob(blob, file.name)
  return blob
}
