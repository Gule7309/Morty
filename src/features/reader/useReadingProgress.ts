import { useCallback, useEffect, useRef } from 'react'
import type { ReadingProgress } from '../../storage/database'
import { saveReadingProgress } from '../../storage/readingProgressRepository'

type ProgressWithoutMetadata = Omit<
  ReadingProgress,
  'documentId' | 'updatedAt'
>

export function useReadingProgress(
  documentId: string,
  onError: (message: string) => void,
  delay = 400,
  persist: (progress: ReadingProgress) => Promise<void> = saveReadingProgress,
) {
  const pendingRef = useRef<ReadingProgress | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (!pendingRef.current) {
      return
    }

    const pending = pendingRef.current
    pendingRef.current = null
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    void persist(pending).catch(() => {
      onError('無法儲存閱讀位置，裝置儲存空間可能不足。')
    })
  }, [onError, persist])

  const schedule = useCallback(
    (progress: ProgressWithoutMetadata) => {
      pendingRef.current = {
        documentId,
        ...progress,
        updatedAt: Date.now(),
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(flush, delay)
    },
    [delay, documentId, flush],
  )

  useEffect(() => {
    function flushWhenHidden() {
      if (document.visibilityState === 'hidden') {
        flush()
      }
    }

    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      flush()
    }
  }, [flush])

  return schedule
}
