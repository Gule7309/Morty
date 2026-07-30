import {
  DrivePicker,
  DrivePickerDocsView,
} from '@googleworkspace/drive-picker-react'
import { useEffect, useRef, useState } from 'react'
import {
  downloadDrivePdf,
  type DriveFileMetadata,
} from '../../services/googleDrive'

interface GoogleDrivePickerProps {
  clientId?: string
  appId?: string
  busy?: boolean
  onError: (message: string) => void
  onImport: (blob: Blob, file: DriveFileMetadata) => Promise<void>
  onStatus: (message: string) => void
}

interface DrivePickerElementWithVisibility extends HTMLElement {
  visible: boolean
}

export function GoogleDrivePicker({
  clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID,
  appId = import.meta.env.VITE_GOOGLE_APP_ID,
  busy: parentBusy = false,
  onError,
  onImport,
  onStatus,
}: GoogleDrivePickerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const accessTokenRef = useRef<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const configured = Boolean(clientId && appId)
  const busy = parentBusy || downloading

  useEffect(() => {
    const picker = hostRef.current?.querySelector('drive-picker')
    if (!picker) {
      return
    }

    const handlePickerError = () => {
      onError('無法開啟 Google Drive 選擇器，請稍後再試。')
    }
    picker.addEventListener('picker-error', handlePickerError)
    return () => picker.removeEventListener('picker-error', handlePickerError)
  }, [configured, onError])

  function openPicker() {
    const picker =
      hostRef.current?.querySelector<DrivePickerElementWithVisibility>(
        'drive-picker',
      )

    if (!picker) {
      onError('Google Drive 選擇器尚未準備完成，請稍後再試。')
      return
    }

    onStatus('')
    picker.visible = true
  }

  return (
    <div ref={hostRef} className="googlePickerHost">
      <button
        className="secondaryButton"
        type="button"
        disabled={!configured || busy}
        onClick={openPicker}
      >
        <span aria-hidden="true">△</span>
        {downloading ? '正在下載 PDF…' : '從 Google Drive 選擇'}
      </button>

      {!configured && (
        <p className="configurationNote">Google Drive 尚未設定</p>
      )}

      {configured && (
        <DrivePicker
          client-id={clientId}
          app-id={appId}
          scope="https://www.googleapis.com/auth/drive.file"
          max-items={1}
          multiselect={false}
          locale="zh-TW"
          onOauthResponse={(event) => {
            const token = event.detail.access_token
            if (!token) {
              onError('Google 登入未回傳存取權杖，請重試。')
              return
            }
            accessTokenRef.current = token
          }}
          onOauthError={() => {
            accessTokenRef.current = null
            onError('Google 登入失敗或已取消。')
          }}
          onCanceled={() => {
            onStatus('已取消 Google Drive 選擇。')
          }}
          onPicked={(event) => {
            const picked = event.detail.docs?.[0]
            const accessToken = accessTokenRef.current

            if (!picked) {
              onError('沒有選到 Google Drive 檔案。')
              return
            }
            if (picked.mimeType !== 'application/pdf') {
              onError('請從 Google Drive 選擇 PDF 檔案。')
              return
            }
            if (!accessToken) {
              onError('Google 登入資訊已失效，請重新開啟選擇器。')
              return
            }

            const file: DriveFileMetadata = {
              id: picked.id,
              name: picked.name,
              mimeType: picked.mimeType,
              size: picked.sizeBytes,
            }

            setDownloading(true)
            onStatus('正在從 Google Drive 下載 PDF…')
            void downloadDrivePdf(file, accessToken)
              .then((blob) => onImport(blob, file))
              .catch((error: unknown) => {
                onError(
                  error instanceof Error
                    ? error.message
                    : 'Google Drive 下載失敗。',
                )
              })
              .finally(() => {
                setDownloading(false)
                accessTokenRef.current = null
              })
          }}
        >
          <DrivePickerDocsView
            mime-types="application/pdf"
            include-folders="false"
            select-folder-enabled="false"
          />
        </DrivePicker>
      )}
    </div>
  )
}
