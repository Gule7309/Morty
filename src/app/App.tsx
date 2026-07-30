import { useEffect, useRef, useState } from 'react'
import { ImportPanel } from '../features/import/ImportPanel'
import { validateLocalPdf } from '../features/import/pdfValidation'
import { PdfReader } from '../features/reader/PdfReader'
import type {
  ReadingProgress,
  StoredDocument,
} from '../storage/database'
import {
  deleteActiveDocument,
  getActiveDocument,
  replaceActiveDocument,
} from '../storage/documentRepository'
import { getReadingProgress } from '../storage/readingProgressRepository'
import type { DriveFileMetadata } from '../services/googleDrive'

function describeStorageError(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  ) {
    return '裝置儲存空間不足，無法保存這份 PDF。'
  }
  return '無法存取裝置儲存空間，請確認瀏覽器允許離線資料。'
}

export function App() {
  const replacementInputRef = useRef<HTMLInputElement>(null)
  const [restoring, setRestoring] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [activeDocument, setActiveDocument] =
    useState<StoredDocument | null>(null)
  const [initialProgress, setInitialProgress] =
    useState<ReadingProgress>()

  useEffect(() => {
    let canceled = false

    void getActiveDocument()
      .then(async (document) => {
        if (!document || canceled) {
          return
        }
        const progress = await getReadingProgress(document.id)
        if (!canceled) {
          setInitialProgress(progress)
          setActiveDocument(document)
        }
      })
      .catch((restoreError: unknown) => {
        if (!canceled) {
          setError(describeStorageError(restoreError))
        }
      })
      .finally(() => {
        if (!canceled) {
          setRestoring(false)
        }
      })

    return () => {
      canceled = true
    }
  }, [])

  async function importLocalPdf(file: File) {
    setBusy(true)
    setError(null)
    setStatus('正在將 PDF 儲存到這台裝置…')

    try {
      const document = await replaceActiveDocument({
        name: file.name,
        source: 'local',
        mimeType: file.type || 'application/pdf',
        size: file.size,
        blob: file,
      })
      setInitialProgress(undefined)
      setActiveDocument(document)
      setStatus('')
    } catch (importError) {
      setError(describeStorageError(importError))
    } finally {
      setBusy(false)
    }
  }

  async function importDrivePdf(blob: Blob, file: DriveFileMetadata) {
    setBusy(true)
    setError(null)
    setStatus('正在將 PDF 儲存到這台裝置…')

    try {
      const document = await replaceActiveDocument({
        name: file.name,
        source: 'google-drive',
        sourceFileId: file.id,
        mimeType: file.mimeType || 'application/pdf',
        size: file.size ?? blob.size,
        blob,
      })
      setInitialProgress(undefined)
      setActiveDocument(document)
      setStatus('')
    } catch (importError) {
      setError(describeStorageError(importError))
    } finally {
      setBusy(false)
    }
  }

  async function handleReplacement(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    const validationError = validateLocalPdf(file)
    if (validationError) {
      setError(validationError)
      return
    }
    await importLocalPdf(file)
  }

  async function deleteDocument() {
    const confirmed = window.confirm(
      '要從這台裝置刪除此 PDF 與閱讀位置嗎？',
    )
    if (!confirmed) {
      return
    }

    try {
      await deleteActiveDocument()
      setActiveDocument(null)
      setInitialProgress(undefined)
      setError(null)
      setStatus('')
    } catch (deleteError) {
      setError(describeStorageError(deleteError))
    }
  }

  if (restoring) {
    return (
      <main className="appLoading" aria-live="polite">
        <div className="loadingSpinner" aria-hidden="true" />
        正在恢復上次閱讀…
      </main>
    )
  }

  if (activeDocument) {
    return (
      <>
        <input
          ref={replacementInputRef}
          hidden
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => void handleReplacement(event)}
        />
        <PdfReader
          key={activeDocument.createdAt}
          document={activeDocument}
          initialProgress={initialProgress}
          onChooseDocument={() => replacementInputRef.current?.click()}
          onDeleteDocument={() => void deleteDocument()}
        />
      </>
    )
  }

  return (
    <ImportPanel
      busy={busy}
      error={error}
      status={status}
      onError={setError}
      onLocalSelect={importLocalPdf}
      onDriveImport={importDrivePdf}
      onStatus={setStatus}
    />
  )
}
