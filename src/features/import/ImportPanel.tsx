import type { ReactNode } from 'react'
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
  cloudReady: boolean
  authControl: ReactNode
  library: ReactNode
}

export function ImportPanel({
  busy,
  error,
  status,
  onError,
  onLocalSelect,
  onDriveImport,
  onStatus,
  cloudReady,
  authControl,
  library,
}: ImportPanelProps) {
  return (
    <main className="emptyState">
      <section className="importCard" aria-labelledby="app-title">
        <div className="brandMark" aria-hidden="true">
          PDF
        </div>
        <h1 id="app-title">Pocket PDF</h1>
        <p className="tagline">在手機上舒服地閱讀 PDF</p>

        {authControl}

        <div className="importActions">
          <LocalPdfPicker
            busy={busy || !cloudReady}
            onError={onError}
            onSelect={onLocalSelect}
          />
          <GoogleDrivePicker
            busy={busy || !cloudReady}
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
          <>
            <p className="errorMessage" role="alert">
              {error}
            </p>
            {cloudReady && error.includes('文件庫') && (
              <a className="libraryActionLink" href="#documents-title">
                前往文件庫整理
              </a>
            )}
          </>
        )}

        {cloudReady && library}

        <p className="privacyNote">
          <span aria-hidden="true">⌁</span>
          R2 保存雲端原始檔；IndexedDB 只作此裝置離線 cache
        </p>
      </section>
    </main>
  )
}
