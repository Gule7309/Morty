import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReaderControls } from './useReaderControls'

describe('useReaderControls', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('pauses auto-hide while the drawer is open and resumes after close', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useReaderControls(true, 2400))

    act(() => result.current.togglePanel('outline'))
    expect(result.current.controlsVisible).toBe(true)
    expect(result.current.drawerOpen).toBe(true)

    act(() => vi.advanceTimersByTime(10_000))
    expect(result.current.controlsVisible).toBe(true)

    act(() => result.current.closeDrawer())
    act(() => vi.advanceTimersByTime(2399))
    expect(result.current.controlsVisible).toBe(true)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.controlsVisible).toBe(false)
  })
})
