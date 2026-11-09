'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

type Props = {
  targetRef: RefObject<HTMLElement | null>
  enabled?: boolean
}

export default function FloatingHorizontalScrollbar({ targetRef, enabled = true }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [left, setLeft] = useState(0)
  const [width, setWidth] = useState(0)
  const [scrollWidth, setScrollWidth] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setVisible(false)
      return
    }

    const update = () => {
      const target = targetRef.current
      const track = trackRef.current
      if (!target || !track) return

      const rect = target.getBoundingClientRect()
      const hasHorizontalOverflow = target.scrollWidth > target.clientWidth + 1
      const intersectsViewport = rect.bottom > 0 && rect.top < window.innerHeight
      const isAwayFromBottomControls = rect.bottom > 72

      const maxTrackWidth = Math.max(0, window.innerWidth - 16)
      const viewportWidth = Math.min(rect.width, maxTrackWidth)
      const clampedLeft = Math.max(8, Math.min(rect.left, window.innerWidth - viewportWidth - 8))
      const nextScrollWidth = hasHorizontalOverflow ? target.scrollWidth : 0

      setLeft(clampedLeft)
      setWidth(viewportWidth)
      setScrollWidth(nextScrollWidth)
      setVisible(hasHorizontalOverflow && intersectsViewport && isAwayFromBottomControls)

      if (track.scrollLeft !== target.scrollLeft) track.scrollLeft = target.scrollLeft
    }

    const target = targetRef.current
    if (!target) return

    const handleTargetScroll = () => update()
    const handleTrackScroll = () => {
      const current = targetRef.current
      if (current && trackRef.current && current.scrollLeft !== trackRef.current.scrollLeft) {
        current.scrollLeft = trackRef.current.scrollLeft
      }
    }

    target.addEventListener('scroll', handleTargetScroll, { passive: true })
    window.addEventListener('scroll', update, { passive: true, capture: true })
    window.addEventListener('resize', update, { passive: true })
    trackRef.current?.addEventListener('scroll', handleTrackScroll, { passive: true })

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(target)

    const mutationObserver = new MutationObserver(update)
    mutationObserver.observe(target, {
      childList: true,
      attributes: true,
      subtree: true,
    })

    update()
    return () => {
      target.removeEventListener('scroll', handleTargetScroll)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      trackRef.current?.removeEventListener('scroll', handleTrackScroll)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [enabled, targetRef])

  if (!visible) return null

  return (
    <div
      role="scrollbar"
      aria-label="Horizontal table scrollbar"
      aria-orientation="horizontal"
      style={{
        position: 'fixed',
        left,
        bottom: 10,
        width,
        height: 18,
        zIndex: 1000,
        overflowX: 'auto',
        overflowY: 'hidden',
        borderRadius: 999,
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
        boxShadow: '0 3px 12px rgba(15, 23, 42, .18)',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--muted) var(--surface-2)',
      }}
      ref={trackRef}
    >
      <div style={{ width: scrollWidth, height: 1 }} />
    </div>
  )
}
