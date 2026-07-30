import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type RefObject,
} from 'react'
import { PdfPage } from './PdfPage'

const DEFAULT_PAGE_RATIO = 1.414
const PAGE_GAP = 16
const HORIZONTAL_PADDING = 20

export interface ReaderPosition {
  pageIndex: number
  pageOffset: number
}

interface VirtualPageListProps {
  containerRef: RefObject<HTMLDivElement | null>
  containerWidth: number
  initialPageIndex: number
  initialPageOffset: number
  numPages: number
  zoom: number
  onPositionChange: (position: ReaderPosition) => void
  onRestoreComplete: () => void
}

export function VirtualPageList({
  containerRef,
  containerWidth,
  initialPageIndex,
  initialPageOffset,
  numPages,
  zoom,
  onPositionChange,
  onRestoreComplete,
}: VirtualPageListProps) {
  const pageRatiosRef = useRef(new Map<number, number>())
  const restoredRef = useRef(false)
  const pendingPositionRef = useRef<ReaderPosition | null>(null)
  const positionFrameRef = useRef<number | null>(null)
  const [, rerenderForRatio] = useReducer((value) => value + 1, 0)
  const pageWidth = Math.max(1, containerWidth - HORIZONTAL_PADDING)
  const renderedPageWidth = pageWidth * zoom

  const schedulePositionChange = useCallback(
    (position: ReaderPosition) => {
      pendingPositionRef.current = position
      if (positionFrameRef.current !== null) {
        return
      }

      positionFrameRef.current = requestAnimationFrame(() => {
        positionFrameRef.current = null
        if (pendingPositionRef.current) {
          onPositionChange(pendingPositionRef.current)
        }
      })
    },
    [onPositionChange],
  )

  // TanStack Virtual intentionally returns mutable functions; React Compiler
  // memoization is not enabled for this MVP.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: numPages,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) =>
      renderedPageWidth *
        (pageRatiosRef.current.get(index) ?? DEFAULT_PAGE_RATIO) +
      PAGE_GAP,
    overscan: 2,
    onChange(instance) {
      const scrollOffset = instance.scrollOffset ?? 0
      const firstVisible = instance
        .getVirtualItems()
        .find((item) => item.end > scrollOffset + 1)

      if (firstVisible) {
        schedulePositionChange({
          pageIndex: firstVisible.index,
          pageOffset: Math.max(0, scrollOffset - firstVisible.start),
        })
      }
    },
  })

  useLayoutEffect(() => {
    virtualizer.measure()
  }, [containerWidth, virtualizer, zoom])

  useEffect(() => {
    return () => {
      if (positionFrameRef.current !== null) {
        cancelAnimationFrame(positionFrameRef.current)
        positionFrameRef.current = null
      }
      pendingPositionRef.current = null
    }
  }, [])

  useEffect(() => {
    if (restoredRef.current || containerWidth <= 0 || numPages <= 0) {
      return
    }

    restoredRef.current = true
    const safePageIndex = Math.min(
      Math.max(0, initialPageIndex),
      numPages - 1,
    )
    let secondFrame = 0
    let completed = false
    const firstFrame = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(safePageIndex, { align: 'start' })
      secondFrame = requestAnimationFrame(() => {
        const scrollElement = containerRef.current
        if (scrollElement && initialPageOffset > 0) {
          virtualizer.scrollToOffset(
            scrollElement.scrollTop + initialPageOffset,
          )
        }
        completed = true
        onRestoreComplete()
      })
    })

    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      if (!completed) {
        restoredRef.current = false
      }
    }
  }, [
    containerRef,
    containerWidth,
    initialPageIndex,
    initialPageOffset,
    numPages,
    onRestoreComplete,
    virtualizer,
  ])

  const handleAspectRatio = useCallback(
    (pageIndex: number, ratio: number) => {
      if (pageRatiosRef.current.get(pageIndex) === ratio) {
        return
      }
      pageRatiosRef.current.set(pageIndex, ratio)
      rerenderForRatio()
    },
    [],
  )

  return (
    <div
      className="virtualPageList"
      data-testid="virtual-page-list"
      style={{
        height: virtualizer.getTotalSize(),
        width: `max(100%, ${renderedPageWidth + HORIZONTAL_PADDING}px)`,
      }}
    >
      {virtualizer.getVirtualItems().map((virtualPage) => (
        <div
          key={virtualPage.key}
          ref={virtualizer.measureElement}
          className="virtualPageItem"
          data-index={virtualPage.index}
          style={{
            transform: `translateY(${virtualPage.start}px)`,
            minHeight:
              renderedPageWidth *
                (pageRatiosRef.current.get(virtualPage.index) ??
                  DEFAULT_PAGE_RATIO) +
              PAGE_GAP,
          }}
        >
          <PdfPage
            pageIndex={virtualPage.index}
            pageWidth={pageWidth}
            zoom={zoom}
            onAspectRatio={handleAspectRatio}
          />
        </div>
      ))}
    </div>
  )
}
