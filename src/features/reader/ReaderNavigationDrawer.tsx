import { useEffect, useRef, type MutableRefObject } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfOutlinePanel } from './PdfOutlinePanel'
import { PdfThumbnailPanel } from './PdfThumbnailPanel'
import type { ReaderNavigationPanel } from './useReaderControls'

interface ReaderNavigationDrawerProps {
  activePanel: ReaderNavigationPanel | null
  currentPageIndex: number
  documentName: string
  isOpen: boolean
  numPages: number
  pdfDocument: PDFDocumentProxy
  returnFocusRef: MutableRefObject<HTMLButtonElement | null>
  onClose: () => void
  onNavigate: (pageIndex: number) => void
  onPanelChange: (panel: ReaderNavigationPanel) => void
}

export function ReaderNavigationDrawer({
  activePanel,
  currentPageIndex,
  documentName,
  isOpen,
  numPages,
  pdfDocument,
  returnFocusRef,
  onClose,
  onNavigate,
  onPanelChange,
}: ReaderNavigationDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    let focusFrame = 0
    if (isOpen) {
      focusFrame = requestAnimationFrame(() => {
        closeButtonRef.current?.focus()
      })
    } else if (wasOpenRef.current) {
      returnFocusRef.current?.focus()
    }
    wasOpenRef.current = isOpen
    return () => cancelAnimationFrame(focusFrame)
  }, [isOpen, returnFocusRef])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  const selectedPanel = activePanel ?? 'outline'

  return (
    <div
      className="readerNavigationLayer"
      data-open={isOpen}
      aria-hidden={!isOpen}
    >
      <div
        className="readerNavigationBackdrop"
        data-testid="reader-navigation-backdrop"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <aside
        className="readerNavigationDrawer"
        role="dialog"
        aria-modal="true"
        aria-label="PDF 導覽"
        inert={!isOpen}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="readerNavigationHeader">
          <p title={documentName}>{documentName}</p>
          <button
            ref={closeButtonRef}
            className="readerNavigationCloseButton"
            type="button"
            aria-label="關閉 PDF 導覽"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="readerNavigationTabs" role="tablist">
          <button
            id="reader-navigation-outline-tab"
            type="button"
            role="tab"
            aria-selected={selectedPanel === 'outline'}
            aria-controls="reader-navigation-outline-panel"
            tabIndex={selectedPanel === 'outline' ? 0 : -1}
            onClick={(event) => {
              event.stopPropagation()
              onPanelChange('outline')
            }}
          >
            章節
          </button>
          <button
            id="reader-navigation-thumbnails-tab"
            type="button"
            role="tab"
            aria-selected={selectedPanel === 'thumbnails'}
            aria-controls="reader-navigation-thumbnails-panel"
            tabIndex={selectedPanel === 'thumbnails' ? 0 : -1}
            onClick={(event) => {
              event.stopPropagation()
              onPanelChange('thumbnails')
            }}
          >
            縮圖
          </button>
        </div>

        <section
          id="reader-navigation-outline-panel"
          className="readerNavigationPanel"
          role="tabpanel"
          aria-labelledby="reader-navigation-outline-tab"
          hidden={selectedPanel !== 'outline'}
        >
          <PdfOutlinePanel
            pdfDocument={pdfDocument}
            onNavigate={onNavigate}
          />
        </section>
        <section
          id="reader-navigation-thumbnails-panel"
          className="readerNavigationPanel readerNavigationThumbnailPanel"
          role="tabpanel"
          aria-labelledby="reader-navigation-thumbnails-tab"
          hidden={selectedPanel !== 'thumbnails'}
        >
          {isOpen && selectedPanel === 'thumbnails' && (
            <PdfThumbnailPanel
              currentPageIndex={currentPageIndex}
              numPages={numPages}
              pdfDocument={pdfDocument}
              onNavigate={onNavigate}
            />
          )}
        </section>
      </aside>
    </div>
  )
}
