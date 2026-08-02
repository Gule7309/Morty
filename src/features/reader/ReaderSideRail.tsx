import type { MouseEvent } from 'react'
import type { ReaderNavigationPanel } from './useReaderControls'

interface ReaderSideRailProps {
  activePanel: ReaderNavigationPanel | null
  visible: boolean
  onPanelToggle: (
    panel: ReaderNavigationPanel,
    trigger: HTMLButtonElement,
  ) => void
}

function stopEvent(event: MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

export function ReaderSideRail({
  activePanel,
  visible,
  onPanelToggle,
}: ReaderSideRailProps) {
  if (!visible) {
    return null
  }

  return (
    <nav
      className="readerSideRail"
      aria-label="PDF 導覽功能"
      onClick={stopEvent}
      onDoubleClick={stopEvent}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className="readerSideRailButton"
        type="button"
        aria-label="開啟章節目錄"
        aria-pressed={activePanel === 'outline'}
        aria-expanded={activePanel === 'outline'}
        aria-controls="reader-navigation-outline-panel"
        onClick={(event) => {
          event.stopPropagation()
          onPanelToggle('outline', event.currentTarget)
        }}
      >
        <span className="readerSideRailIcon" aria-hidden="true">
          ☷
        </span>
        <span>章節</span>
      </button>
      <button
        className="readerSideRailButton"
        type="button"
        aria-label="開啟頁面縮圖"
        aria-pressed={activePanel === 'thumbnails'}
        aria-expanded={activePanel === 'thumbnails'}
        aria-controls="reader-navigation-thumbnails-panel"
        onClick={(event) => {
          event.stopPropagation()
          onPanelToggle('thumbnails', event.currentTarget)
        }}
      >
        <span className="readerSideRailIcon" aria-hidden="true">
          ▦
        </span>
        <span>縮圖</span>
      </button>
    </nav>
  )
}
