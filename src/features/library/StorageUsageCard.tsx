import {
  formatDecimalBytes,
  type StorageUsage,
} from '../../services/cloudStorage'

interface StorageUsageCardProps {
  usage: StorageUsage
}

export function StorageUsageCard({ usage }: StorageUsageCardProps) {
  const { storage, documents } = usage
  const occupiedDocuments = documents.used + documents.reserved
  const progressPercent = Math.min(
    100,
    Math.max(0, storage.usageRatio * 100),
  )
  const state =
    storage.usageRatio >= 1
      ? 'full'
      : usage.warning
        ? 'warning'
        : 'normal'
  const stateLabel =
    state === 'full'
      ? '空間已滿'
      : state === 'warning'
        ? '空間即將用完'
        : '空間充足'

  return (
    <section
      id="storage-usage"
      className="storageUsageCard"
      data-state={state}
      aria-labelledby="storage-title"
    >
      <div className="storageUsageHeading">
        <h2 id="storage-title">雲端文件庫</h2>
        <span className="quotaStateLabel">{stateLabel}</span>
      </div>

      <div className="quotaMetric">
        <span>儲存空間</span>
        <strong>
          {formatDecimalBytes(storage.usedBytes)} /{' '}
          {formatDecimalBytes(storage.limitBytes)}
        </strong>
      </div>
      <div
        className="quotaProgressTrack"
        role="progressbar"
        aria-label="雲端儲存空間使用量"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progressPercent)}
      >
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="quotaDetails">
        <span>
          可用容量：{formatDecimalBytes(Math.max(0, storage.remainingBytes))}
        </span>
        {storage.reservedBytes > 0 && (
          <span>上傳中預留：{formatDecimalBytes(storage.reservedBytes)}</span>
        )}
        {storage.remainingBytes < 0 && (
          <span>目前超額：{formatDecimalBytes(-storage.remainingBytes)}</span>
        )}
      </div>

      <div className="quotaMetric documentQuotaMetric">
        <span>文件</span>
        <strong>
          {occupiedDocuments} / {documents.limit}
        </strong>
      </div>

      {state === 'warning' && (
        <p className="quotaNotice" role="status">
          你的雲端空間即將用完，建議刪除不需要的文件。
        </p>
      )}
      {state === 'full' && (
        <p className="quotaNotice" role="alert">
          雲端空間已滿；你仍可閱讀或刪除文件，但暫時不能新增上傳。
        </p>
      )}
      {occupiedDocuments >= documents.limit && (
        <p className="quotaNotice" role="alert">
          已達{documents.limit}份文件上限，請先刪除一份文件。
        </p>
      )}
    </section>
  )
}
