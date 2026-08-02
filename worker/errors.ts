export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_FILE_TYPE'
  | 'INVALID_FILE_SIZE'
  | 'FILE_TOO_LARGE'
  | 'DOCUMENT_LIMIT_REACHED'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'UPLOAD_NOT_FOUND'
  | 'DOCUMENT_NOT_FOUND'
  | 'INVALID_UPLOAD_STATE'
  | 'R2_DELETE_FAILED'
  | 'INVALID_REQUEST'
  | 'FORBIDDEN'

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  INVALID_FILE_TYPE: 400,
  INVALID_FILE_SIZE: 400,
  FILE_TOO_LARGE: 413,
  DOCUMENT_LIMIT_REACHED: 409,
  STORAGE_QUOTA_EXCEEDED: 409,
  UPLOAD_NOT_FOUND: 404,
  DOCUMENT_NOT_FOUND: 404,
  INVALID_UPLOAD_STATE: 409,
  R2_DELETE_FAILED: 503,
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
}

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details: Record<string, number | string | boolean>

  constructor(
    code: ApiErrorCode,
    message: string,
    details: Record<string, number | string | boolean> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = details
  }
}

export function mapDatabaseError(error: unknown): ApiError | null {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes('DOCUMENT_LIMIT_REACHED')) {
    return new ApiError(
      'DOCUMENT_LIMIT_REACHED',
      '已達文件數量上限，請先刪除一份文件。',
    )
  }
  if (message.includes('STORAGE_QUOTA_EXCEEDED')) {
    return new ApiError(
      'STORAGE_QUOTA_EXCEEDED',
      '你的雲端儲存空間不足。',
    )
  }

  return null
}
