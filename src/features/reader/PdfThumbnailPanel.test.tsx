import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PdfThumbnailPanel } from './PdfThumbnailPanel'

vi.mock('react-pdf', () => ({
  Thumbnail: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid="mounted-thumbnail">{pageNumber}</div>
  ),
}))

const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect
const originalScrollTo = HTMLElement.prototype.scrollTo

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 393,
  })
  HTMLElement.prototype.getBoundingClientRect = function getTestRect() {
    const isScrollContainer = this.classList.contains('pdfThumbnailScroll')
    const isRow = this.classList.contains('pdfThumbnailRow')
    const width = isScrollContainer || isRow ? 320 : 0
    const height = isScrollContainer ? 600 : isRow ? 150 : 0
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => undefined,
    }
  }
  HTMLElement.prototype.scrollTo = function scrollTo(
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    this.scrollTop = Math.max(
      0,
      typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0),
    )
    this.dispatchEvent(new Event('scroll'))
  }
})

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect =
    originalGetBoundingClientRect
  HTMLElement.prototype.scrollTo = originalScrollTo
})

describe('PdfThumbnailPanel', () => {
  it('virtualizes 200 pages and marks the current page accessibly', async () => {
    render(
      <PdfThumbnailPanel
        currentPageIndex={0}
        numPages={200}
        pdfDocument={{ numPages: 200 } as PDFDocumentProxy}
        onNavigate={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('mounted-thumbnail').length).toBeGreaterThan(
        0,
      )
    })
    const mountedThumbnails = screen.getAllByTestId('mounted-thumbnail')
    expect(mountedThumbnails.length).toBeLessThan(15)
    expect(mountedThumbnails.length).not.toBe(200)
    expect(
      screen.getByRole('button', { name: '前往第 1 頁' }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('navigates with the clicked thumbnail zero-based pageIndex', async () => {
    const onNavigate = vi.fn()
    render(
      <PdfThumbnailPanel
        currentPageIndex={0}
        numPages={200}
        pdfDocument={{ numPages: 200 } as PDFDocumentProxy}
        onNavigate={onNavigate}
      />,
    )

    const pageTwoButton = await screen.findByRole('button', {
      name: '前往第 2 頁',
    })
    fireEvent.click(pageTwoButton)
    expect(onNavigate).toHaveBeenCalledWith(1)
  })
})
