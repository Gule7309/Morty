import { useCallback, useEffect, useState } from 'react'
import { GoogleSignInCard } from '../features/auth/GoogleSignInCard'
import { ImportPanel } from '../features/import/ImportPanel'
import { CloudLibrary } from '../features/library/CloudLibrary'
import { PdfReader } from '../features/reader/PdfReader'
import {
  deleteCloudDocument,
  describeCloudError,
  downloadCloudDocument,
  getStorageUsage,
  listCloudDocuments,
  uploadCloudDocument,
  type CloudDocument,
  type StorageUsage,
} from '../services/cloudStorage'
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
  const [restoring, setRestoring] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [idToken, setIdToken] = useState<string | null>(null)
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [cloudDocuments, setCloudDocuments] = useState<CloudDocument[]>([])
  const [cloudLoading, setCloudLoading] = useState(false)
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null)
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

  const refreshCloudLibrary = useCallback(async (token: string) => {
    setCloudLoading(true)
    try {
      const [nextUsage, documents] = await Promise.all([
        getStorageUsage(token),
        listCloudDocuments(token),
      ])
      setUsage(nextUsage)
      setCloudDocuments(documents)
    } finally {
      setCloudLoading(false)
    }
  }, [])

  const handleCredential = useCallback(
    (credential: string) => {
      setIdToken(credential)
      setError(null)
      void refreshCloudLibrary(credential).catch((cloudError: unknown) => {
        setError(describeCloudError(cloudError))
      })
    },
    [refreshCloudLibrary],
  )

  const handleCloudError = useCallback((message: string) => {
    setError(message)
  }, [])

  const handleSignOut = useCallback(() => {
    setIdToken(null)
    setUsage(null)
    setCloudDocuments([])
    setError(null)
  }, [])

  async function cacheUploadedDocument(
    blob: Blob,
    input: {
      name: string
      source: StoredDocument['source']
      sourceFileId?: string
      mimeType: string
      size: number
    },
  ) {
    if (!idToken) {
      throw new Error('請先使用 Google 登入。')
    }

    const uploaded = await uploadCloudDocument(
      { name: input.name, blob },
      idToken,
    )
    setUsage(uploaded.usage)

    try {
      const document = await replaceActiveDocument({
        ...input,
        blob,
        cloudDocumentId: uploaded.document.id,
      })
      setInitialProgress(undefined)
      setActiveDocument(document)
      setCloudDocuments((current) => [
        uploaded.document,
        ...current.filter((item) => item.id !== uploaded.document.id),
      ])
      setStatus('')
    } catch (cacheError) {
      setCloudDocuments((current) => [
        uploaded.document,
        ...current.filter((item) => item.id !== uploaded.document.id),
      ])
      throw new Error(
        `PDF 已保存到雲端，但無法建立此裝置 cache。${describeStorageError(cacheError)}`,
        { cause: cacheError },
      )
    }
  }

  async function importLocalPdf(file: File) {
    setBusy(true)
    setError(null)
    setStatus('正在檢查雲端空間並上傳 PDF…')

    try {
      await cacheUploadedDocument(file, {
        name: file.name,
        source: 'local',
        mimeType: file.type || 'application/pdf',
        size: file.size,
      })
    } catch (importError) {
      setError(describeCloudError(importError))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  async function importDrivePdf(blob: Blob, file: DriveFileMetadata) {
    setBusy(true)
    setError(null)
    setStatus('正在檢查雲端空間並保存 Google Drive PDF…')

    try {
      await cacheUploadedDocument(blob, {
        name: file.name,
        source: 'google-drive',
        sourceFileId: file.id,
        mimeType: file.mimeType || 'application/pdf',
        size: file.size ?? blob.size,
      })
    } catch (importError) {
      setError(describeCloudError(importError))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  async function deleteDocument() {
    const confirmed = window.confirm(
      activeDocument?.cloudDocumentId
        ? '要刪除此雲端 PDF、此裝置 cache 與閱讀位置嗎？'
        : '要從這台裝置刪除此 PDF 與閱讀位置嗎？',
    )
    if (!confirmed) {
      return
    }

    try {
      if (activeDocument?.cloudDocumentId) {
        if (!idToken) {
          setError('請先回到文件庫重新登入，再刪除雲端文件。')
          return
        }
        await deleteCloudDocument(activeDocument.cloudDocumentId, idToken)
      }
      await deleteActiveDocument()
      setActiveDocument(null)
      setInitialProgress(undefined)
      setError(null)
      setStatus('')
      if (idToken) {
        await refreshCloudLibrary(idToken)
      }
    } catch (deleteError) {
      setError(describeCloudError(deleteError))
    }
  }

  async function openCloudDocument(document: CloudDocument) {
    if (!idToken) {
      return
    }
    setBusyDocumentId(document.id)
    setError(null)
    setStatus('正在下載 PDF 並建立此裝置 cache…')
    try {
      const blob = await downloadCloudDocument(document, idToken)
      const cached = await replaceActiveDocument({
        name: document.name,
        source: 'pocket-pdf',
        cloudDocumentId: document.id,
        mimeType: document.mimeType,
        size: document.sizeBytes,
        blob,
      })
      setInitialProgress(undefined)
      setActiveDocument(cached)
      setStatus('')
    } catch (openError) {
      setError(describeCloudError(openError))
      setStatus('')
    } finally {
      setBusyDocumentId(null)
    }
  }

  async function deleteFromLibrary(document: CloudDocument) {
    if (!idToken || !window.confirm(`要刪除「${document.name}」嗎？`)) {
      return
    }
    setBusyDocumentId(document.id)
    setError(null)
    try {
      await deleteCloudDocument(document.id, idToken)
      const cached = await getActiveDocument()
      if (cached?.cloudDocumentId === document.id) {
        await deleteActiveDocument()
      }
      await refreshCloudLibrary(idToken)
    } catch (deleteError) {
      setError(describeCloudError(deleteError))
    } finally {
      setBusyDocumentId(null)
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
      <PdfReader
        key={activeDocument.createdAt}
        document={activeDocument}
        initialProgress={initialProgress}
        onChooseDocument={() => {
          setActiveDocument(null)
          setInitialProgress(undefined)
          setError(null)
          setStatus('')
        }}
        onDeleteDocument={() => void deleteDocument()}
      />
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
      cloudReady={Boolean(idToken)}
      authControl={
        <GoogleSignInCard
          authenticated={Boolean(idToken)}
          onCredential={handleCredential}
          onError={handleCloudError}
          onSignOut={handleSignOut}
        />
      }
      library={
        <CloudLibrary
          usage={usage}
          documents={cloudDocuments}
          loading={cloudLoading}
          busyDocumentId={busyDocumentId}
          onOpen={(document) => void openCloudDocument(document)}
          onDelete={(document) => void deleteFromLibrary(document)}
        />
      }
    />
  )
}
