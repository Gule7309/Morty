import { Page, pdfjs } from 'react-pdf'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface PdfPageProps {
  pageIndex: number
  pageWidth: number
  zoom: number
  onAspectRatio: (pageIndex: number, ratio: number) => void
}

export function PdfPage({
  pageIndex,
  pageWidth,
  zoom,
  onAspectRatio,
}: PdfPageProps) {
  return (
    <div className="pdfPageFrame" data-testid="pdf-page">
      <Page
        pageIndex={pageIndex}
        width={pageWidth}
        scale={zoom}
        devicePixelRatio={Math.min(window.devicePixelRatio || 1, 2)}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        loading={
          <div
            className="pageSkeleton"
            style={{ width: pageWidth * zoom }}
            aria-label={`正在載入第 ${pageIndex + 1} 頁`}
          />
        }
        error={
          <p className="pageError" role="alert">
            第 {pageIndex + 1} 頁無法顯示
          </p>
        }
        onLoadSuccess={(page) => {
          const width = page.view[2] - page.view[0]
          const height = page.view[3] - page.view[1]
          if (width > 0 && height > 0) {
            onAspectRatio(pageIndex, height / width)
          }
        }}
      />
    </div>
  )
}
