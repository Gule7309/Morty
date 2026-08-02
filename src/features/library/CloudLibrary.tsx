import type {
  CloudDocument,
  StorageUsage,
} from '../../services/cloudStorage'
import { formatDecimalBytes } from '../../services/cloudStorage'
import { StorageUsageCard } from './StorageUsageCard'

interface CloudLibraryProps {
  usage: StorageUsage | null
  documents: CloudDocument[]
  loading: boolean
  busyDocumentId: string | null
  onOpen: (document: CloudDocument) => void
  onDelete: (document: CloudDocument) => void
}

export function CloudLibrary({
  usage,
  documents,
  loading,
  busyDocumentId,
  onOpen,
  onDelete,
}: CloudLibraryProps) {
  return (
    <div className="cloudLibrary">
      {usage && <StorageUsageCard usage={usage} />}

      <section className="cloudDocumentList" aria-labelledby="documents-title">
        <h2 id="documents-title">我的 PDF</h2>
        {loading && <p className="libraryMessage">正在載入文件庫…</p>}
        {!loading && documents.length === 0 && (
          <p className="libraryMessage">尚未保存任何雲端 PDF。</p>
        )}
        {documents.length > 0 && (
          <ul>
            {documents.map((document) => {
              const busy = busyDocumentId === document.id
              return (
                <li key={document.id}>
                  <div>
                    <strong>{document.name}</strong>
                    <span>{formatDecimalBytes(document.sizeBytes)}</span>
                  </div>
                  <div className="cloudDocumentActions">
                    <button
                      type="button"
                      disabled={Boolean(busyDocumentId)}
                      onClick={() => onOpen(document)}
                    >
                      {busy ? '處理中…' : '開啟'}
                    </button>
                    <button
                      className="cloudDeleteButton"
                      type="button"
                      disabled={Boolean(busyDocumentId)}
                      onClick={() => onDelete(document)}
                    >
                      刪除
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

