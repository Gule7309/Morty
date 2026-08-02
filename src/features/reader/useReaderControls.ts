import { useCallback, useEffect, useRef, useState } from 'react'

export type ReaderNavigationPanel = 'outline' | 'thumbnails'

const SINGLE_TAP_DELAY_MS = 220
const DEFAULT_AUTO_HIDE_MS = 2400

export function useReaderControls(
  enabled: boolean,
  autoHideMs = DEFAULT_AUTO_HIDE_MS,
) {
  const [controlsVisible, setControlsVisible] = useState(false)
  const [activePanel, setActivePanel] =
    useState<ReaderNavigationPanel | null>(null)
  const [activityVersion, setActivityVersion] = useState(0)
  const singleTapTimerRef = useRef<number | null>(null)

  const markActivity = useCallback(() => {
    setActivityVersion((version) => version + 1)
  }, [])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    markActivity()
  }, [markActivity])

  const toggleControls = useCallback(() => {
    setControlsVisible((visible) => !visible)
    markActivity()
  }, [markActivity])

  const cancelPendingSingleTap = useCallback(() => {
    if (singleTapTimerRef.current !== null) {
      window.clearTimeout(singleTapTimerRef.current)
      singleTapTimerRef.current = null
    }
  }, [])

  const scheduleControlsToggle = useCallback(() => {
    cancelPendingSingleTap()
    singleTapTimerRef.current = window.setTimeout(() => {
      singleTapTimerRef.current = null
      toggleControls()
    }, SINGLE_TAP_DELAY_MS)
  }, [cancelPendingSingleTap, toggleControls])

  const handleReaderDoubleTap = useCallback(() => {
    cancelPendingSingleTap()
    revealControls()
  }, [cancelPendingSingleTap, revealControls])

  const togglePanel = useCallback(
    (panel: ReaderNavigationPanel) => {
      setControlsVisible(true)
      setActivePanel((currentPanel) =>
        currentPanel === panel ? null : panel,
      )
      markActivity()
    },
    [markActivity],
  )

  const selectPanel = useCallback(
    (panel: ReaderNavigationPanel) => {
      setControlsVisible(true)
      setActivePanel(panel)
      markActivity()
    },
    [markActivity],
  )

  const closeDrawer = useCallback(() => {
    setActivePanel(null)
    markActivity()
  }, [markActivity])

  useEffect(() => {
    if (enabled) {
      return
    }
    cancelPendingSingleTap()
  }, [cancelPendingSingleTap, enabled])

  useEffect(() => {
    if (!enabled || !controlsVisible || activePanel) {
      return
    }

    const autoHideTimer = window.setTimeout(() => {
      setControlsVisible(false)
    }, autoHideMs)
    return () => window.clearTimeout(autoHideTimer)
  }, [
    activePanel,
    activityVersion,
    autoHideMs,
    controlsVisible,
    enabled,
  ])

  useEffect(() => cancelPendingSingleTap, [cancelPendingSingleTap])

  return {
    activePanel: enabled ? activePanel : null,
    closeDrawer,
    controlsVisible: enabled && controlsVisible,
    drawerOpen: enabled && activePanel !== null,
    handleReaderDoubleTap,
    revealControls,
    scheduleControlsToggle,
    selectPanel,
    togglePanel,
  }
}
