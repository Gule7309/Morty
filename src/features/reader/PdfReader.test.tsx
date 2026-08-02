import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredDocument } from '../../storage/database'
import { PdfReader } from './PdfReader'

const pdfMockState = vi.hoisted(() => ({
  mode: 'loading' as 'loading' | 'loaded' | 'error',
  outline: [] as Array<{
    title: string
    dest: string | Array<unknown> | null
    items: Array<unknown>
  }>,
}))

const mockPdfDocument = {
  numPages: 3,
  getOutline: () => Promise.resolve(pdfMockState.outline),
  getDestination: () =>
    Promise.resolve([{ num: 2, gen: 0 }, { name: 'XYZ' }, 0, 0, null]),
  getPageIndex: () => Promise.resolve(1),
}

interface MockDocumentProps {
  children?: ReactNode
  loading?: ReactNode
  onLoadSuccess?: (pdf: typeof mockPdfDocument) => void
  onLoadError?: (error: Error) => void
}

vi.mock('react-pdf', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react')

  return {
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
    Document: ({
      children,
      loading,
      onLoadSuccess,
      onLoadError,
    }: MockDocumentProps) => {
      ReactModule.useEffect(() => {
        if (pdfMockState.mode === 'loaded') {
          onLoadSuccess?.(mockPdfDocument)
        } else if (pdfMockState.mode === 'error') {
          onLoadError?.(new Error('Invalid PDF format'))
        }
      }, [onLoadError, onLoadSuccess])

      return pdfMockState.mode === 'loading' ? loading : children
    },
    Page: () => <div data-testid="mock-pdf-page" />,
    Thumbnail: ({ pageNumber }: { pageNumber: number }) => (
      <div data-testid="mock-thumbnail">第 {pageNumber} 頁縮圖</div>
    ),
  }
})

const storedDocument: StoredDocument = {
  id: 'active-document',
  name: 'reader-test.pdf',
  source: 'local',
  mimeType: 'application/pdf',
  size: 12,
  blob: new Blob(['pdf'], { type: 'application/pdf' }),
  createdAt: 1,
  lastOpenedAt: 1,
}

describe('PdfReader states', () => {
  beforeEach(() => {
    pdfMockState.mode = 'loading'
    pdfMockState.outline = []
  })

  it('shows the parsing state while the PDF loads', () => {
    render(
      <PdfReader
        document={storedDocument}
        onChooseDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
      />,
    )

    expect(screen.getByText('正在解析 PDF…')).toBeInTheDocument()
  })

  it('shows the loaded page count', async () => {
    pdfMockState.mode = 'loaded'
    render(
      <PdfReader
        document={storedDocument}
        onChooseDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
      />,
    )

    expect(await screen.findByText('1 / 3')).toBeInTheDocument()
    expect(screen.getAllByText('reader-test.pdf')).toHaveLength(2)
  })

  it('shows the side rail only when the shared controls are visible', async () => {
    pdfMockState.mode = 'loaded'
    render(
      <PdfReader
        document={storedDocument}
        onChooseDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
      />,
    )

    await screen.findByText('1 / 3')
    expect(
      screen.queryByRole('button', { name: '開啟章節目錄' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('reader-viewport'))
    expect(
      await screen.findByRole('button', { name: '開啟章節目錄' }),
    ).toBeInTheDocument()
  })

  it('opens either drawer panel and closes on the active rail button', async () => {
    pdfMockState.mode = 'loaded'
    render(
      <PdfReader
        document={storedDocument}
        onChooseDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
      />,
    )

    await screen.findByText('1 / 3')
    fireEvent.click(screen.getByTestId('reader-viewport'))
    const outlineButton = await screen.findByRole('button', {
      name: '開啟章節目錄',
    })

    fireEvent.click(outlineButton)
    expect(
      screen.getByRole('dialog', { name: 'PDF 導覽' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: '章節' }),
    ).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: '縮圖' }))
    expect(
      screen.getByRole('tab', { name: '縮圖' }),
    ).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: '關閉 PDF 導覽' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'PDF 導覽' }),
      ).not.toBeInTheDocument()
    })

    fireEvent.click(outlineButton)
    fireEvent.click(outlineButton)
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'PDF 導覽' }),
      ).not.toBeInTheDocument()
    })
  })

  it('closes the drawer from its backdrop and Escape key', async () => {
    pdfMockState.mode = 'loaded'
    render(
      <PdfReader
        document={storedDocument}
        onChooseDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
      />,
    )

    await screen.findByText('1 / 3')
    fireEvent.click(screen.getByTestId('reader-viewport'))
    const outlineButton = await screen.findByRole('button', {
      name: '開啟章節目錄',
    })
    fireEvent.click(outlineButton)
    fireEvent.click(screen.getByTestId('reader-navigation-backdrop'))
    expect(
      screen.queryByRole('dialog', { name: 'PDF 導覽' }),
    ).not.toBeInTheDocument()

    fireEvent.click(outlineButton)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'PDF 導覽' }),
      ).not.toBeInTheDocument()
    })
  })

  it('uses the shared zero-based navigation path for outline items', async () => {
    pdfMockState.mode = 'loaded'
    pdfMockState.outline = [
      {
        title: '第二章',
        dest: 'chapter-two',
        items: [],
      },
    ]
    render(
      <PdfReader
        document={storedDocument}
        onChooseDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
      />,
    )

    await screen.findByText('1 / 3')
    fireEvent.click(screen.getByTestId('reader-viewport'))
    fireEvent.click(
      await screen.findByRole('button', { name: '開啟章節目錄' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: '第二章' }))

    expect(await screen.findByText('2 / 3')).toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: 'PDF 導覽' }),
    ).not.toBeInTheDocument()
  })

  it('keeps double-click zoom from scheduling two control toggles', async () => {
    pdfMockState.mode = 'loaded'
    render(
      <PdfReader
        document={storedDocument}
        onChooseDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
      />,
    )

    await screen.findByText('1 / 3')
    const viewport = screen.getByTestId('reader-viewport')
    fireEvent.click(viewport)
    fireEvent.click(viewport)
    fireEvent.doubleClick(viewport)

    expect(
      screen.getByRole('button', { name: '開啟章節目錄' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '符合頁面寬度' }),
    ).toHaveAttribute('aria-pressed', 'false')

    await new Promise((resolve) => window.setTimeout(resolve, 250))
    expect(
      screen.getByRole('button', { name: '開啟章節目錄' }),
    ).toBeInTheDocument()
  })

  it('shows a clear error for a broken PDF', async () => {
    pdfMockState.mode = 'error'
    render(
      <PdfReader
        document={storedDocument}
        onChooseDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('這份 PDF 已損壞或格式不正確。'),
    ).toBeInTheDocument()
  })
})
