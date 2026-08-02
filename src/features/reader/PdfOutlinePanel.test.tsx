import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { describe, expect, it, vi } from 'vitest'
import { PdfOutlinePanel } from './PdfOutlinePanel'

interface TestOutlineItem {
  title: string
  bold: boolean
  italic: boolean
  color: Uint8ClampedArray
  dest: string | Array<unknown> | null
  url: null
  unsafeUrl: undefined
  newWindow: undefined
  count: undefined
  items: TestOutlineItem[]
}

function outlineItem(
  title: string,
  dest: string | Array<unknown> | null,
  items: TestOutlineItem[] = [],
): TestOutlineItem {
  return {
    title,
    bold: false,
    italic: false,
    color: new Uint8ClampedArray([0, 0, 0]),
    dest,
    url: null,
    unsafeUrl: undefined,
    newWindow: undefined,
    count: undefined,
    items,
  }
}

function createPdfDocument(
  outline: TestOutlineItem[] | null,
  pageIndex = 4,
): PDFDocumentProxy {
  return {
    numPages: 10,
    getOutline: vi.fn().mockResolvedValue(outline),
    getDestination: vi
      .fn()
      .mockResolvedValue([
        { num: 8, gen: 0 },
        { name: 'XYZ' },
        0,
        0,
        null,
      ]),
    getPageIndex: vi.fn().mockResolvedValue(pageIndex),
  } as unknown as PDFDocumentProxy
}

describe('PdfOutlinePanel', () => {
  it('resolves a named destination and navigates with its pageIndex', async () => {
    const onNavigate = vi.fn()
    const pdfDocument = createPdfDocument([
      outlineItem('第一章', 'chapter-one'),
    ])

    render(
      <PdfOutlinePanel
        pdfDocument={pdfDocument}
        onNavigate={onNavigate}
      />,
    )

    fireEvent.click(
      await screen.findByRole('button', { name: '第一章' }),
    )
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(4))
    expect(pdfDocument.getDestination).toHaveBeenCalledWith('chapter-one')
  })

  it('shows the specified empty state when no outline exists', async () => {
    render(
      <PdfOutlinePanel
        pdfDocument={createPdfDocument(null)}
        onNavigate={vi.fn()}
      />,
    )

    expect(
      await screen.findByText('這份 PDF 沒有內建章節目錄'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('你仍可使用頁面縮圖快速跳轉'),
    ).toBeInTheDocument()
  })

  it('disables an item whose destination cannot be resolved', async () => {
    const pdfDocument = createPdfDocument([
      outlineItem('失效章節', 'missing'),
    ])
    vi.mocked(pdfDocument.getDestination).mockResolvedValue(null)

    render(
      <PdfOutlinePanel
        pdfDocument={pdfDocument}
        onNavigate={vi.fn()}
      />,
    )

    fireEvent.click(
      await screen.findByRole('button', { name: '失效章節' }),
    )
    expect(
      await screen.findByRole('button', {
        name: '失效章節，無法跳轉',
      }),
    ).toBeDisabled()
  })

  it('keeps nested outline branches expandable', async () => {
    render(
      <PdfOutlinePanel
        pdfDocument={createPdfDocument([
          outlineItem('父章節', null, [
            outlineItem('很長的 nested child title 測試章節', [
              2,
              { name: 'XYZ' },
              0,
              0,
              null,
            ]),
          ]),
        ])}
        onNavigate={vi.fn()}
      />,
    )

    const toggle = await screen.findByRole('button', {
      name: '收合 父章節',
    })
    expect(
      screen.getByRole('button', {
        name: '很長的 nested child title 測試章節',
      }),
    ).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(
      screen.queryByRole('button', {
        name: '很長的 nested child title 測試章節',
      }),
    ).not.toBeInTheDocument()
  })
})
