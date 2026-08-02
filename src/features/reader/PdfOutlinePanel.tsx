import { useEffect, useMemo, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

type PdfOutline = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>
type PdfOutlineItem = PdfOutline[number]

interface PdfOutlinePanelProps {
  pdfDocument: PDFDocumentProxy
  onNavigate: (pageIndex: number) => void
}

interface OutlineBranchProps {
  disabledItems: ReadonlySet<string>
  expandedItems: ReadonlySet<string>
  items: PdfOutline
  parentPath: string
  resolvingItems: ReadonlySet<string>
  onNavigate: (item: PdfOutlineItem, itemPath: string) => void
  onToggle: (itemPath: string) => void
}

function collectExpandablePaths(
  items: PdfOutline,
  parentPath = 'outline',
  paths = new Set<string>(),
) {
  items.forEach((item, index) => {
    const itemPath = `${parentPath}-${index}`
    if (item.items.length > 0) {
      paths.add(itemPath)
      collectExpandablePaths(item.items, itemPath, paths)
    }
  })
  return paths
}

async function resolveOutlinePageIndex(
  pdfDocument: PDFDocumentProxy,
  item: PdfOutlineItem,
): Promise<number | null> {
  const destination =
    typeof item.dest === 'string'
      ? await pdfDocument.getDestination(item.dest)
      : item.dest

  if (!destination || !Array.isArray(destination)) {
    return null
  }

  const pageReference = destination[0]
  if (Number.isInteger(pageReference)) {
    return pageReference as number
  }
  if (!pageReference || typeof pageReference !== 'object') {
    return null
  }

  return pdfDocument.getPageIndex(
    pageReference as Parameters<PDFDocumentProxy['getPageIndex']>[0],
  )
}

function OutlineBranch({
  disabledItems,
  expandedItems,
  items,
  parentPath,
  resolvingItems,
  onNavigate,
  onToggle,
}: OutlineBranchProps) {
  return (
    <ul>
      {items.map((item, index) => {
        const itemPath = `${parentPath}-${index}`
        const hasChildren = item.items.length > 0
        const expanded = expandedItems.has(itemPath)
        const disabled = item.dest === null || disabledItems.has(itemPath)
        const resolving = resolvingItems.has(itemPath)

        return (
          <li key={itemPath}>
            <div className="pdfOutlineRow">
              {hasChildren ? (
                <button
                  className="pdfOutlineExpandButton"
                  type="button"
                  aria-label={`${expanded ? '收合' : '展開'} ${item.title}`}
                  aria-expanded={expanded}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggle(itemPath)
                  }}
                >
                  <span aria-hidden="true">{expanded ? '⌄' : '›'}</span>
                </button>
              ) : (
                <span className="pdfOutlineLeafSpacer" aria-hidden="true" />
              )}
              <button
                className="pdfOutlineTitleButton"
                type="button"
                disabled={disabled || resolving}
                aria-label={
                  disabledItems.has(itemPath)
                    ? `${item.title}，無法跳轉`
                    : item.title
                }
                onClick={(event) => {
                  event.stopPropagation()
                  onNavigate(item, itemPath)
                }}
              >
                <span>{item.title || '未命名章節'}</span>
                {resolving && (
                  <span className="pdfOutlineResolving">定位中…</span>
                )}
                {disabledItems.has(itemPath) && (
                  <span className="pdfOutlineResolving">無法跳轉</span>
                )}
              </button>
            </div>
            {hasChildren && expanded && (
              <OutlineBranch
                disabledItems={disabledItems}
                expandedItems={expandedItems}
                items={item.items}
                parentPath={itemPath}
                resolvingItems={resolvingItems}
                onNavigate={onNavigate}
                onToggle={onToggle}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function PdfOutlinePanel({
  pdfDocument,
  onNavigate,
}: PdfOutlinePanelProps) {
  const [outline, setOutline] = useState<PdfOutline | null>()
  const [loadError, setLoadError] = useState(false)
  const [expandedItems, setExpandedItems] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [disabledItems, setDisabledItems] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [resolvingItems, setResolvingItems] = useState<
    ReadonlySet<string>
  >(new Set())

  useEffect(() => {
    let active = true

    void pdfDocument
      .getOutline()
      .then((nextOutline) => {
        if (!active) {
          return
        }
        setOutline(nextOutline)
        setExpandedItems(
          nextOutline ? collectExpandablePaths(nextOutline) : new Set(),
        )
      })
      .catch(() => {
        if (active) {
          setLoadError(true)
          setOutline(null)
        }
      })

    return () => {
      active = false
    }
  }, [pdfDocument])

  const hasOutline = useMemo(
    () => Boolean(outline && outline.length > 0),
    [outline],
  )

  async function handleNavigate(
    item: PdfOutlineItem,
    itemPath: string,
  ) {
    setResolvingItems((current) => new Set(current).add(itemPath))
    try {
      const pageIndex = await resolveOutlinePageIndex(pdfDocument, item)
      if (
        pageIndex === null ||
        pageIndex < 0 ||
        pageIndex >= pdfDocument.numPages
      ) {
        throw new Error('Outline destination is outside the document.')
      }
      onNavigate(pageIndex)
    } catch {
      setDisabledItems((current) => new Set(current).add(itemPath))
    } finally {
      setResolvingItems((current) => {
        const next = new Set(current)
        next.delete(itemPath)
        return next
      })
    }
  }

  function handleToggle(itemPath: string) {
    setExpandedItems((current) => {
      const next = new Set(current)
      if (next.has(itemPath)) {
        next.delete(itemPath)
      } else {
        next.add(itemPath)
      }
      return next
    })
  }

  if (outline === undefined && !loadError) {
    return (
      <div className="pdfOutlineSkeleton" aria-label="正在載入章節目錄">
        <span />
        <span />
        <span />
        <span />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="readerNavigationMessage" role="alert">
        <strong>無法讀取這份 PDF 的章節目錄</strong>
        <span>你可以改用頁面縮圖快速跳轉。</span>
      </div>
    )
  }

  if (!hasOutline || !outline) {
    return (
      <div className="readerNavigationMessage">
        <strong>這份 PDF 沒有內建章節目錄</strong>
        <span>你仍可使用頁面縮圖快速跳轉</span>
      </div>
    )
  }

  return (
    <nav className="pdfOutline" aria-label="PDF 章節目錄">
      <OutlineBranch
        disabledItems={disabledItems}
        expandedItems={expandedItems}
        items={outline}
        parentPath="outline"
        resolvingItems={resolvingItems}
        onNavigate={(item, itemPath) =>
          void handleNavigate(item, itemPath)
        }
        onToggle={handleToggle}
      />
    </nav>
  )
}
