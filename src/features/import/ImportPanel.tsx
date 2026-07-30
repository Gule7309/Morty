import { GoogleDrivePicker } from './GoogleDrivePicker'
import { LocalPdfPicker } from './LocalPdfPicker'
import type { DriveFileMetadata } from '../../services/googleDrive'

interface ImportPanelProps {
  busy: boolean
  error: string | null
  status: string
  onError: (message: string) => void
  onLocalSelect: (file: File) => Promise<void>
  onDriveImport: (blob: Blob, file: DriveFileMetadata) => Promise<void>
  onStatus: (message: string) => void
}

export function ImportPanel({
  busy,
  error,
  status,
  onError,
  onLocalSelect,
  onDriveImport,
  onStatus,
}: ImportPanelProps) {
  return (
    <main className="emptyState">
      <section className="importCard" aria-labelledby="app-title">
        <div className="brandMark" aria-hidden="true">
          PDF
        </div>
        <h1 id="app-title">Pocket PDF</h1>
        <p className="tagline">在手機上舒服地閱讀 PDF</p>

        <div className="importActions">
          <LocalPdfPicker
            busy={busy}
            onError={onError}
            onSelect={onLocalSelect}
          />
          <GoogleDrivePicker
            busy={busy}
            onError={onError}
            onImport={onDriveImport}
            onStatus={onStatus}
          />
        </div>

        {(busy || status) && (
          <p className="statusMessage" aria-live="polite">
            {status || '正在開啟 PDF…'}
          </p>
        )}
        {error && (
          <p className="errorMessage" role="alert">
            {error}
          </p>
        )}

        <p className="privacyNote">
          <span aria-hidden="true">⌁</span>
          檔案只會儲存在這台裝置
        </p>
      </section>
    </main>
  )
}
