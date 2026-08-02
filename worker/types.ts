export interface Env {
  DB: D1Database
  PDF_BUCKET: R2Bucket
  ALLOWED_ORIGIN: string
  GOOGLE_CLIENT_ID: string
  R2_ACCOUNT_ID: string
  R2_BUCKET_NAME: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  ADMIN_SECRET?: string
}

export interface UserIdentity {
  id: string
  email?: string
}

export interface UserRow {
  id: string
  email: string | null
  storage_quota_bytes: number
  storage_used_bytes: number
  storage_reserved_bytes: number
  document_limit: number
  ready_document_count: number
  reserved_document_count: number
  created_at: string
  updated_at: string
}

export type DocumentStatus =
  | 'pending'
  | 'uploading'
  | 'ready'
  | 'failed'
  | 'canceling'
  | 'deleting'

export interface DocumentRow {
  id: string
  user_id: string
  object_key: string
  original_name: string
  mime_type: string
  size_bytes: number
  status: DocumentStatus
  created_at: string
  updated_at: string
  upload_expires_at: string | null
}

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
