import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReadingProgress } from './useReadingProgress'

describe('useReadingProgress', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces persistence instead of writing on every scroll update', async () => {
    vi.useFakeTimers()
    const persist = vi.fn().mockResolvedValue(undefined)
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useReadingProgress('active-document', onError, 400, persist),
    )

    act(() => {
      result.current({ pageIndex: 2, pageOffset: 20, zoom: 1 })
      result.current({ pageIndex: 3, pageOffset: 40, zoom: 1.2 })
    })

    await vi.advanceTimersByTimeAsync(399)
    expect(persist).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'active-document',
        pageIndex: 3,
        pageOffset: 40,
        zoom: 1.2,
      }),
    )
  })
})
