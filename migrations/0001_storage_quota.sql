PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  storage_quota_bytes INTEGER NOT NULL DEFAULT 2000000000 CHECK (storage_quota_bytes >= 0),
  storage_used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_used_bytes >= 0),
  storage_reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (storage_reserved_bytes >= 0),
  document_limit INTEGER NOT NULL DEFAULT 100 CHECK (document_limit >= 0),
  ready_document_count INTEGER NOT NULL DEFAULT 0 CHECK (ready_document_count >= 0),
  reserved_document_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_document_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 100000000),
  status TEXT NOT NULL CHECK (status IN ('pending', 'uploading', 'ready', 'failed', 'canceling', 'deleting')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  upload_expires_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS documents_user_status_idx
  ON documents(user_id, status);
CREATE INDEX IF NOT EXISTS documents_user_updated_idx
  ON documents(user_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS documents_object_key_idx
  ON documents(object_key);

-- The INSERT and its counter update are one SQLite statement. D1 serializes
-- writes, so competing reservations cannot both pass these guards.
CREATE TRIGGER IF NOT EXISTS documents_reservation_guard
BEFORE INSERT ON documents
WHEN NEW.status IN ('pending', 'uploading')
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id)
      THEN RAISE(ABORT, 'USER_NOT_FOUND')
  END;
  SELECT CASE
    WHEN (SELECT ready_document_count + reserved_document_count >= document_limit
          FROM users WHERE id = NEW.user_id)
      THEN RAISE(ABORT, 'DOCUMENT_LIMIT_REACHED')
  END;
  SELECT CASE
    WHEN (SELECT storage_used_bytes + storage_reserved_bytes + NEW.size_bytes > storage_quota_bytes
          FROM users WHERE id = NEW.user_id)
      THEN RAISE(ABORT, 'STORAGE_QUOTA_EXCEEDED')
  END;
END;

CREATE TRIGGER IF NOT EXISTS documents_reservation_apply
AFTER INSERT ON documents
WHEN NEW.status IN ('pending', 'uploading')
BEGIN
  UPDATE users
  SET storage_reserved_bytes = storage_reserved_bytes + NEW.size_bytes,
      reserved_document_count = reserved_document_count + 1,
      updated_at = NEW.updated_at
  WHERE id = NEW.user_id;
END;

CREATE TRIGGER IF NOT EXISTS documents_completion_guard
BEFORE UPDATE OF status, size_bytes ON documents
WHEN OLD.status IN ('pending', 'uploading') AND NEW.status = 'ready'
BEGIN
  SELECT CASE
    WHEN (SELECT storage_reserved_bytes < OLD.size_bytes OR reserved_document_count < 1
          FROM users WHERE id = OLD.user_id)
      THEN RAISE(ABORT, 'COUNTER_INVARIANT')
  END;
  SELECT CASE
    WHEN (SELECT storage_used_bytes + storage_reserved_bytes - OLD.size_bytes + NEW.size_bytes > storage_quota_bytes
          FROM users WHERE id = OLD.user_id)
      THEN RAISE(ABORT, 'STORAGE_QUOTA_EXCEEDED')
  END;
END;

CREATE TRIGGER IF NOT EXISTS documents_completion_apply
AFTER UPDATE OF status, size_bytes ON documents
WHEN OLD.status IN ('pending', 'uploading') AND NEW.status = 'ready'
BEGIN
  UPDATE users
  SET storage_reserved_bytes = storage_reserved_bytes - OLD.size_bytes,
      reserved_document_count = reserved_document_count - 1,
      storage_used_bytes = storage_used_bytes + NEW.size_bytes,
      ready_document_count = ready_document_count + 1,
      updated_at = NEW.updated_at
  WHERE id = OLD.user_id;
END;

CREATE TRIGGER IF NOT EXISTS documents_reservation_release_apply
AFTER UPDATE OF status ON documents
WHEN OLD.status IN ('pending', 'uploading', 'canceling') AND NEW.status = 'failed'
BEGIN
  UPDATE users
  SET storage_reserved_bytes = MAX(0, storage_reserved_bytes - OLD.size_bytes),
      reserved_document_count = MAX(0, reserved_document_count - 1),
      updated_at = NEW.updated_at
  WHERE id = OLD.user_id;
END;

CREATE TRIGGER IF NOT EXISTS documents_delete_guard
BEFORE DELETE ON documents
WHEN OLD.status NOT IN ('failed', 'deleting')
BEGIN
  SELECT RAISE(ABORT, 'INVALID_DELETE_STATE');
END;

CREATE TRIGGER IF NOT EXISTS documents_ready_delete_apply
AFTER DELETE ON documents
WHEN OLD.status = 'deleting'
BEGIN
  UPDATE users
  SET storage_used_bytes = MAX(0, storage_used_bytes - OLD.size_bytes),
      ready_document_count = MAX(0, ready_document_count - 1),
      updated_at = OLD.updated_at
  WHERE id = OLD.user_id;
END;
