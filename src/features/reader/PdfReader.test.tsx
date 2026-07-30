import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredDocument } from '../../storage/database'
import { PdfReader } from './PdfReader'

const pdfMockState = vi.hoisted(() => ({
  mode: 'loading' as 'loading' | 'loaded' | 'error',
}))

interface MockDocumentProps {
  children?: ReactNode
  loading?: ReactNode
  onLoadSuccess?: (pdf: { numPages: number }) => void
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
          onLoadSuccess?.({ numPages: 3 })
        } else if (pdfMockState.mode === 'error') {
          onLoadError?.(new Error('Invalid PDF format'))
        }
      }, [onLoadError, onLoadSuccess])

      return pdfMockState.mode === 'loading' ? loading : children
    },
    Page: () => <div data-testid="mock-pdf-page" />,
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
    expect(screen.getByText('reader-test.pdf')).toBeInTheDocument()
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
