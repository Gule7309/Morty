import { useCallback, useEffect, useRef, useState } from 'react'
import { Document, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type {
  ReadingProgress,
  StoredDocument,
} from '../../storage/database'
import { ReaderToolbar } from './ReaderToolbar'
import {
  VirtualPageList,
  type ReaderPosition,
} from './VirtualPageList'
import { useReadingProgress } from './useReadingProgress'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const MIN_ZOOM = 0.8
const MAX_ZOOM = 2
const ZOOM_STEP = 0.2

interface PdfReaderProps {
  document: StoredDocument
  initialProgress?: ReadingProgress
  onChooseDocument: () => void
  onDeleteDocument: () => void
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function describePdfError(error: Error): string {
  const message = error.message.toLowerCase()
  if (message.includes('password')) {
    return '這份 PDF 已加密或需要密碼，Pocket PDF 暫不支援。'
  }
  if (message.includes('invalid') || message.includes('format')) {
    return '這份 PDF 已損壞或格式不正確。'
  }
  return '無法開啟這份 PDF，請確認檔案完整後再試。'
}

export function PdfReader({
  document,
  initialProgress,
  onChooseDocument,
  onDeleteDocument,
}: PdfReaderProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const restoreCompleteRef = useRef(false)
  const positionRef = useRef<ReaderPosition>({
    pageIndex: initialProgress?.pageIndex ?? 0,
    pageOffset: initialProgress?.pageOffset ?? 0,
  })
  const [containerWidth, setContainerWidth] = useState(0)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(
    (initialProgress?.pageIndex ?? 0) + 1,
  )
  const [zoom, setZoom] = useState(() =>
    clampZoom(initialProgress?.zoom ?? 1),
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [toolbarVisible, setToolbarVisible] = useState(true)
  const scheduleProgress = useReadingProgress(
    document.id,
    setStorageError,
  )

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    const updateWidth = (width: number) => {
      setContainerWidth(Math.max(0, Math.floor(width)))
    }
    updateWidth(viewport.clientWidth)

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width === 'number') {
        updateWidth(width)
      }
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!numPages || !toolbarVisible) {
      return
    }

    const timeout = window.setTimeout(() => setToolbarVisible(false), 2400)
    return () => window.clearTimeout(timeout)
  }, [numPages, toolbarVisible])

  const handlePositionChange = useCallback(
    (position: ReaderPosition) => {
      positionRef.current = position
      setCurrentPage((current) => {
        const next = position.pageIndex + 1
        return current === next ? current : next
      })
      if (restoreCompleteRef.current) {
        scheduleProgress({
          ...position,
          zoom,
        })
      }
    },
    [scheduleProgress, zoom],
  )

  const handleRestoreComplete = useCallback(() => {
    restoreCompleteRef.current = true
  }, [])

  function changeZoom(nextZoom: number) {
    const clamped = clampZoom(Number(nextZoom.toFixed(2)))
    setZoom(clamped)
    setToolbarVisible(true)
    scheduleProgress({
      ...positionRef.current,
      zoom: clamped,
    })
  }

  function handleLoadSuccess(pdf: PDFDocumentProxy) {
    setLoadError(null)
    setNumPages(pdf.numPages)
  }

  function handleLoadError(error: Error) {
    setNumPages(0)
    setLoadError(describePdfError(error))
  }

  return (
    <main
      className="readerShell"
      onPointerDown={() => setToolbarVisible(true)}
      onKeyDown={() => setToolbarVisible(true)}
    >
      <ReaderToolbar
        documentName={document.name}
        visible={toolbarVisible}
        zoom={zoom}
        onChooseDocument={onChooseDocument}
        onDeleteDocument={onDeleteDocument}
        onZoomOut={() => changeZoom(zoom - ZOOM_STEP)}
        onFitWidth={() => changeZoom(1)}
        onZoomIn={() => changeZoom(zoom + ZOOM_STEP)}
      />

      <div
        ref={viewportRef}
        className="readerViewport"
        onDoubleClick={() => changeZoom(zoom === 1 ? 1.25 : 1)}
      >
        <Document
          key={document.createdAt}
          file={document.blob}
          loading={
            <div className="readerStatus" aria-live="polite">
              正在解析 PDF…
            </div>
          }
          error={null}
          onLoadSuccess={handleLoadSuccess}
          onLoadError={handleLoadError}
          onSourceError={handleLoadError}
          onPassword={(callback) => {
            setLoadError(
              '這份 PDF 已加密或需要密碼，Pocket PDF 暫不支援。',
            )
            callback(null)
          }}
        >
          {numPages > 0 && containerWidth > 0 && (
            <VirtualPageList
              containerRef={viewportRef}
              containerWidth={containerWidth}
              initialPageIndex={initialProgress?.pageIndex ?? 0}
              initialPageOffset={initialProgress?.pageOffset ?? 0}
              numPages={numPages}
              zoom={zoom}
              onPositionChange={handlePositionChange}
              onRestoreComplete={handleRestoreComplete}
            />
          )}
        </Document>

        {loadError && (
          <div className="readerStatus readerErrorState" role="alert">
            <p>{loadError}</p>
            <button
              className="primaryButton"
              type="button"
              onClick={onChooseDocument}
            >
              選擇其他 PDF
            </button>
          </div>
        )}
      </div>

      {numPages > 0 && (
        <div className="pageBadge" aria-live="polite">
          {currentPage} / {numPages}
        </div>
      )}
      {storageError && (
        <p className="readerStorageError" role="alert">
          {storageError}
        </p>
      )}
    </main>
  )
}
