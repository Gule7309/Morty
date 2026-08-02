import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { Document, pdfjs } from 'react-pdf'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type {
  ReadingProgress,
  StoredDocument,
} from '../../storage/database'
import { ReaderToolbar } from './ReaderToolbar'
import { ReaderNavigationDrawer } from './ReaderNavigationDrawer'
import { ReaderSideRail } from './ReaderSideRail'
import {
  VirtualPageList,
  type ReaderPosition,
  type VirtualPageListHandle,
} from './VirtualPageList'
import { useReadingProgress } from './useReadingProgress'
import {
  useReaderControls,
  type ReaderNavigationPanel,
} from './useReaderControls'

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
  const virtualPageListRef = useRef<VirtualPageListHandle>(null)
  const drawerReturnFocusRef = useRef<HTMLButtonElement | null>(null)
  const resizeCorrectionFrameRef = useRef<number | null>(null)
  const stablePageTimerRef = useRef<number | null>(null)
  const stablePageIndexRef = useRef(initialProgress?.pageIndex ?? 0)
  const zoomCorrectionFrameRef = useRef<number | null>(null)
  const restoreCompleteRef = useRef(false)
  const positionRef = useRef<ReaderPosition>({
    pageIndex: initialProgress?.pageIndex ?? 0,
    pageOffset: initialProgress?.pageOffset ?? 0,
  })
  const [containerWidth, setContainerWidth] = useState(0)
  const [numPages, setNumPages] = useState(0)
  const [pdfDocument, setPdfDocument] =
    useState<PDFDocumentProxy | null>(null)
  const [currentPage, setCurrentPage] = useState(
    (initialProgress?.pageIndex ?? 0) + 1,
  )
  const [zoom, setZoom] = useState(() =>
    clampZoom(initialProgress?.zoom ?? 1),
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const scheduleProgress = useReadingProgress(
    document.id,
    setStorageError,
  )
  const {
    activePanel,
    closeDrawer,
    controlsVisible,
    drawerOpen,
    handleReaderDoubleTap,
    revealControls,
    scheduleControlsToggle,
    selectPanel,
    togglePanel,
  } = useReaderControls(numPages > 0)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    let previousWidth = Math.max(0, Math.floor(viewport.clientWidth))
    const updateWidth = (width: number) => {
      const nextWidth = Math.max(0, Math.floor(width))
      const pageIndexToPreserve =
        previousWidth > 0 &&
        nextWidth !== previousWidth &&
        restoreCompleteRef.current
          ? stablePageIndexRef.current
          : null
      previousWidth = nextWidth
      setContainerWidth(nextWidth)

      if (pageIndexToPreserve !== null) {
        if (resizeCorrectionFrameRef.current !== null) {
          cancelAnimationFrame(resizeCorrectionFrameRef.current)
        }
        resizeCorrectionFrameRef.current = requestAnimationFrame(() => {
          resizeCorrectionFrameRef.current = requestAnimationFrame(() => {
            resizeCorrectionFrameRef.current = null
            virtualPageListRef.current?.scrollToIndex(pageIndexToPreserve)
            positionRef.current = {
              pageIndex: pageIndexToPreserve,
              pageOffset: 0,
            }
            stablePageIndexRef.current = pageIndexToPreserve
            setCurrentPage(pageIndexToPreserve + 1)
          })
        })
      }
    }
    updateWidth(viewport.clientWidth)

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width === 'number') {
        updateWidth(width)
      }
    })
    observer.observe(viewport)
    return () => {
      observer.disconnect()
      if (resizeCorrectionFrameRef.current !== null) {
        cancelAnimationFrame(resizeCorrectionFrameRef.current)
        resizeCorrectionFrameRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    return () => {
      if (zoomCorrectionFrameRef.current !== null) {
        cancelAnimationFrame(zoomCorrectionFrameRef.current)
      }
      if (stablePageTimerRef.current !== null) {
        window.clearTimeout(stablePageTimerRef.current)
      }
    }
  }, [])

  const handlePositionChange = useCallback(
    (position: ReaderPosition) => {
      positionRef.current = position
      if (stablePageTimerRef.current !== null) {
        window.clearTimeout(stablePageTimerRef.current)
      }
      stablePageTimerRef.current = window.setTimeout(() => {
        stablePageTimerRef.current = null
        stablePageIndexRef.current = position.pageIndex
      }, 180)
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
    const pageIndexToPreserve = positionRef.current.pageIndex
    setZoom(clamped)
    revealControls()
    scheduleProgress({
      ...positionRef.current,
      zoom: clamped,
    })
    if (zoomCorrectionFrameRef.current !== null) {
      cancelAnimationFrame(zoomCorrectionFrameRef.current)
    }
    zoomCorrectionFrameRef.current = requestAnimationFrame(() => {
      zoomCorrectionFrameRef.current = null
      virtualPageListRef.current?.scrollToIndex(pageIndexToPreserve)
    })
  }

  const handleLoadSuccess = useCallback((pdf: PDFDocumentProxy) => {
    setLoadError(null)
    setPdfDocument(pdf)
    setNumPages(pdf.numPages)
  }, [])

  const handleLoadError = useCallback((error: Error) => {
    setNumPages(0)
    setPdfDocument(null)
    setLoadError(describePdfError(error))
  }, [])

  const goToPage = useCallback(
    (pageIndex: number) => {
      if (
        !Number.isInteger(pageIndex) ||
        pageIndex < 0 ||
        pageIndex >= numPages
      ) {
        return
      }

      virtualPageListRef.current?.scrollToIndex(pageIndex)
      positionRef.current = { pageIndex, pageOffset: 0 }
      if (stablePageTimerRef.current !== null) {
        window.clearTimeout(stablePageTimerRef.current)
        stablePageTimerRef.current = null
      }
      stablePageIndexRef.current = pageIndex
      setCurrentPage(pageIndex + 1)
    },
    [numPages],
  )

  function handlePanelToggle(
    panel: ReaderNavigationPanel,
    trigger: HTMLButtonElement,
  ) {
    drawerReturnFocusRef.current = trigger
    togglePanel(panel)
  }

  function handleDrawerNavigate(pageIndex: number) {
    goToPage(pageIndex)
    closeDrawer()
  }

  function handleViewportClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || drawerOpen) {
      return
    }
    scheduleControlsToggle()
  }

  function handleViewportDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || drawerOpen) {
      return
    }
    handleReaderDoubleTap()
    changeZoom(zoom === 1 ? 1.25 : 1)
  }

  return (
    <main className="readerShell" onKeyDown={revealControls}>
      <ReaderToolbar
        documentName={document.name}
        visible={controlsVisible}
        zoom={zoom}
        onChooseDocument={onChooseDocument}
        onDeleteDocument={onDeleteDocument}
        onZoomOut={() => changeZoom(zoom - ZOOM_STEP)}
        onFitWidth={() => changeZoom(1)}
        onZoomIn={() => changeZoom(zoom + ZOOM_STEP)}
        onInteraction={revealControls}
      />
      <ReaderSideRail
        activePanel={activePanel}
        visible={controlsVisible}
        onPanelToggle={handlePanelToggle}
      />

      <div
        ref={viewportRef}
        className={`readerViewport ${
          drawerOpen ? 'readerViewportLocked' : ''
        }`}
        data-testid="reader-viewport"
        inert={drawerOpen}
        onClick={handleViewportClick}
        onDoubleClick={handleViewportDoubleClick}
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
              ref={virtualPageListRef}
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

      {pdfDocument && numPages > 0 && (
        <ReaderNavigationDrawer
          activePanel={activePanel}
          currentPageIndex={currentPage - 1}
          documentName={document.name}
          isOpen={drawerOpen}
          numPages={numPages}
          pdfDocument={pdfDocument}
          returnFocusRef={drawerReturnFocusRef}
          onClose={closeDrawer}
          onNavigate={handleDrawerNavigate}
          onPanelChange={selectPanel}
        />
      )}

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
