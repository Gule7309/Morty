import { describe, expect, it } from 'vitest'
import { isPdfFile, validateLocalPdf } from './pdfValidation'

describe('PDF validation', () => {
  it('accepts a PDF by MIME type or extension', () => {
    expect(isPdfFile({ type: 'application/pdf', name: 'file' })).toBe(true)
    expect(
      isPdfFile({ type: 'application/octet-stream', name: 'FILE.PDF' }),
    ).toBe(true)
  })

  it('returns a clear error for a non-PDF or empty PDF', () => {
    expect(
      validateLocalPdf(new File(['text'], 'notes.txt', { type: 'text/plain' })),
    ).toBe('請選擇 PDF 檔案。')
    expect(
      validateLocalPdf(
        new File([], 'empty.pdf', { type: 'application/pdf' }),
      ),
    ).toBe('這份 PDF 是空檔案，請選擇其他檔案。')
  })
})
