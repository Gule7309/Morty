import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Thumbnail } from 'react-pdf'

const THUMBNAIL_RATIO_ESTIMATE = 1.414
const THUMBNAIL_ROW_GAP = 12

interface PdfThumbnailPanelProps {
  currentPageIndex: number
  numPages: number
  pdfDocument: PDFDocumentProxy
  onNavigate: (pageIndex: number) => void
}

function getThumbnailWidth(panelWidth: number): number {
  const viewportWidth = window.innerWidth
  if (viewportWidth <= 359) {
    return Math.round(Math.min(88, Math.max(76, panelWidth * 0.27)))
  }
  if (viewportWidth <= 479) {
    return Math.round(Math.min(104, Math.max(88, panelWidth * 0.29)))
  }
  return Math.round(Math.min(120, Math.max(96, panelWidth * 0.32)))
}

function getThumbnailRowEstimate(thumbnailWidth: number): number {
  const responsiveMinimum = Math.min(
    240,
    Math.max(190, window.innerHeight * 0.28),
  )
  return Math.max(
    responsiveMinimum,
    thumbnailWidth * THUMBNAIL_RATIO_ESTIMATE + THUMBNAIL_ROW_GAP,
  )
}

export function PdfThumbnailPanel({
  currentPageIndex,
  numPages,
  pdfDocument,
  onNavigate,
}: PdfThumbnailPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const recenterTimerRef = useRef<number | null>(null)
  const recenteredAfterRenderRef = useRef(false)
  const [thumbnailWidth, setThumbnailWidth] = useState(92)

  // TanStack Virtual intentionally returns mutable functions; React Compiler
  // memoization is not enabled for this reader.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: numPages,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => getThumbnailRowEstimate(thumbnailWidth),
    overscan: 3,
  })

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) {
      return
    }

    const updateWidth = (width: number) => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null
        setThumbnailWidth(getThumbnailWidth(width))
      })
    }

    updateWidth(scrollContainer.clientWidth)
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width === 'number' && width > 0) {
        updateWidth(width)
      }
    })
    observer.observe(scrollContainer)

    return () => {
      observer.disconnect()
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
    }
  }, [])

  useLayoutEffect(() => {
    recenteredAfterRenderRef.current = false
    virtualizer.measure()
    const safeCurrentPageIndex = Math.min(
      Math.max(0, currentPageIndex),
      Math.max(0, numPages - 1),
    )
    const frame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(safeCurrentPageIndex, {
        align: 'center',
        behavior: 'auto',
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [currentPageIndex, numPages, thumbnailWidth, virtualizer])

  const scheduleRecenterAfterRender = useCallback(() => {
    if (recenteredAfterRenderRef.current) {
      return
    }
    if (recenterTimerRef.current !== null) {
      window.clearTimeout(recenterTimerRef.current)
    }
    recenterTimerRef.current = window.setTimeout(() => {
      recenterTimerRef.current = null
      recenteredAfterRenderRef.current = true
      virtualizer.measure()
      virtualizer.scrollToIndex(currentPageIndex, {
        align: 'center',
        behavior: 'auto',
      })
    }, 80)
  }, [currentPageIndex, virtualizer])

  useEffect(() => {
    return () => {
      if (recenterTimerRef.current !== null) {
        window.clearTimeout(recenterTimerRef.current)
      }
    }
  }, [])

  return (
    <div
      ref={scrollContainerRef}
      className="pdfThumbnailScroll"
      data-testid="thumbnail-scroll-container"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="pdfThumbnailVirtualList"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const pageIndex = virtualRow.index
          const pageNumber = pageIndex + 1
          const isCurrentPage = pageIndex === currentPageIndex

          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              className={`pdfThumbnailRow ${
                isCurrentPage ? 'pdfThumbnailRowCurrent' : ''
              }`}
              data-index={pageIndex}
              data-testid="thumbnail-row"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
              onDoubleClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div
                className="pdfThumbnailPreview"
                inert
                aria-hidden="true"
              >
                <Thumbnail
                  className="pdfThumbnail"
                  pdf={pdfDocument}
                  pageNumber={pageNumber}
                  width={thumbnailWidth}
                  devicePixelRatio={Math.min(
                    window.devicePixelRatio || 1,
                    1.5,
                  )}
                  onRenderSuccess={scheduleRecenterAfterRender}
                  loading={
                    <span
                      className="pdfThumbnailSkeleton"
                      style={{
                        width: thumbnailWidth,
                        height:
                          thumbnailWidth * THUMBNAIL_RATIO_ESTIMATE,
                      }}
                    />
                  }
                  error={
                    <span
                      className="pdfThumbnailError"
                      style={{ width: thumbnailWidth }}
                    >
                      無法預覽
                    </span>
                  }
                />
              </div>
              <span className="pdfThumbnailPageNumber">
                第 {pageNumber} 頁
                {isCurrentPage && (
                  <span className="pdfThumbnailCurrentLabel">
                    目前頁面
                  </span>
                )}
              </span>
              <button
                className="pdfThumbnailRowButton"
                type="button"
                aria-label={`前往第 ${pageNumber} 頁`}
                aria-current={isCurrentPage ? 'page' : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  onNavigate(pageIndex)
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
