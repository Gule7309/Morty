export const DEFAULT_USER_QUOTA = {
  maxDocuments: 100,
  maxTotalBytes: 2_000_000_000,
  maxFileBytes: 100_000_000,
  warningThreshold: 0.8,
} as const

export const PDF_MIME_TYPE = 'application/pdf'
export const UPLOAD_URL_TTL_SECONDS = 10 * 60
export const UPLOAD_RESERVATION_TTL_MS = 30 * 60 * 1000
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60

