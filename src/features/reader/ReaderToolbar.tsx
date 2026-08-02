interface ReaderToolbarProps {
  documentName: string
  visible: boolean
  zoom: number
  onChooseDocument: () => void
  onDeleteDocument: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitWidth: () => void
  onInteraction: () => void
}

export function ReaderToolbar({
  documentName,
  visible,
  zoom,
  onChooseDocument,
  onDeleteDocument,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onInteraction,
}: ReaderToolbarProps) {
  return (
    <>
      <header
        className={`readerTopBar ${visible ? '' : 'readerToolbarHidden'}`}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onFocus={onInteraction}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <p className="readerDocumentName" title={documentName}>
          {documentName}
        </p>
        <div className="readerTopActions">
          <button
            className="toolbarTextButton"
            type="button"
            onClick={onChooseDocument}
          >
            更換 PDF
          </button>
          <button
            className="iconButton dangerButton"
            type="button"
            aria-label="刪除這台裝置上的 PDF"
            onClick={onDeleteDocument}
          >
            <span aria-hidden="true">⌫</span>
          </button>
        </div>
      </header>

      <div
        className={`zoomToolbar ${visible ? '' : 'readerToolbarHidden'}`}
        aria-label="PDF 縮放控制"
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onFocus={onInteraction}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          className="iconButton"
          type="button"
          aria-label="縮小 PDF"
          disabled={zoom <= 0.8}
          onClick={onZoomOut}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          className="fitWidthButton"
          type="button"
          aria-label="符合頁面寬度"
          aria-pressed={zoom === 1}
          onClick={onFitWidth}
        >
          Fit Width
        </button>
        <button
          className="iconButton"
          type="button"
          aria-label="放大 PDF"
          disabled={zoom >= 2}
          onClick={onZoomIn}
        >
          <span aria-hidden="true">＋</span>
        </button>
      </div>
    </>
  )
}
