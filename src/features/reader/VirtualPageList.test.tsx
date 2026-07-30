import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VirtualPageList,
  type ReaderPosition,
} from './VirtualPageList'

vi.mock('react-pdf', () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
  Page: () => <div data-testid="mock-page" style={{ height: 540 }} />,
}))

const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect

beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function getTestRect() {
    const height = this.classList.contains('virtualPageItem') ? 540 : 0
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 390,
      bottom: height,
      width: 390,
      height,
      toJSON: () => undefined,
    }
  }
})

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
})

function VirtualListHarness({
  onPositionChange = vi.fn<(position: ReaderPosition) => void>(),
}: {
  onPositionChange?: (position: ReaderPosition) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={(element) => {
        viewportRef.current = element
        if (element) {
          Object.defineProperties(element, {
            offsetWidth: { configurable: true, value: 390 },
            offsetHeight: { configurable: true, value: 800 },
          })
          element.getBoundingClientRect = () => ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 390,
            bottom: 800,
            width: 390,
            height: 800,
            toJSON: () => undefined,
          })
        }
      }}
      data-testid="test-viewport"
      style={{ width: 390, height: 800, overflow: 'auto' }}
    >
      <VirtualPageList
        containerRef={viewportRef}
        containerWidth={390}
        initialPageIndex={0}
        initialPageOffset={0}
        numPages={200}
        zoom={1}
        onPositionChange={onPositionChange}
        onRestoreComplete={vi.fn()}
      />
    </div>
  )
}

describe('VirtualPageList', () => {
  it('does not mount all pages in a 200-page document', async () => {
    render(<VirtualListHarness />)

    await waitFor(() => {
      expect(screen.getAllByTestId('pdf-page').length).toBeGreaterThan(0)
    })

    const mountedPages = screen.getAllByTestId('pdf-page')
    const mountedIndexes = mountedPages.map(
      (page) => page.closest('[data-index]')?.getAttribute('data-index'),
    )
    expect(
      mountedPages.length,
      `mounted indexes: ${mountedIndexes.join(',')}`,
    ).toBeLessThan(20)
  })

  it('keeps reporting scroll positions after StrictMode effect replay', async () => {
    const onPositionChange = vi.fn()
    render(
      <StrictMode>
        <VirtualListHarness onPositionChange={onPositionChange} />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(onPositionChange).toHaveBeenCalled()
    })
    onPositionChange.mockClear()

    const viewport = screen.getByTestId('test-viewport')
    viewport.scrollTop = 2400
    fireEvent.scroll(viewport)

    await waitFor(() => {
      expect(onPositionChange).toHaveBeenCalledWith(
        expect.objectContaining({ pageIndex: expect.any(Number) }),
      )
    })
    expect(onPositionChange.mock.lastCall?.[0].pageIndex).toBeGreaterThan(0)
  })
})
