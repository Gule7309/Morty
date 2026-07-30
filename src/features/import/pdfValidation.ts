const PDF_MIME_TYPE = 'application/pdf'

interface PdfCandidate {
  type: string
  name?: string
}

export function isPdfFile(candidate: PdfCandidate): boolean {
  const hasPdfMimeType = candidate.type.toLowerCase() === PDF_MIME_TYPE
  const hasPdfExtension = candidate.name?.toLowerCase().endsWith('.pdf') ?? false

  return hasPdfMimeType || hasPdfExtension
}

export function validateLocalPdf(file: File): string | null {
  if (!isPdfFile(file)) {
    return '請選擇 PDF 檔案。'
  }

  if (file.size === 0) {
    return '這份 PDF 是空檔案，請選擇其他檔案。'
  }

  return null
}

export function assertPdfBlob(blob: Blob, name: string): void {
  if (blob.size === 0) {
    throw new Error('下載的 PDF 是空檔案。')
  }

  if (!isPdfFile({ type: blob.type, name })) {
    throw new Error('下載的檔案不是 PDF。')
  }
}
