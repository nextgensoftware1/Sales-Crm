'use client'

// Floating horizontal scrollbar for wide tables.
//
// When a table has many rows (50, 100, 200…) its own horizontal scrollbar sits
// at the very bottom of the table, far below the screen. This component shows a
// second scrollbar pinned to the bottom of the viewport, exactly as wide as the
// table, and keeps both in sync. It hides itself automatically when:
//   • the table does not overflow horizontally, or
//   • the table's real scrollbar is already visible on screen, or
//   • the table is scrolled out of view.
//
// It is rendered with position: fixed through a portal, so it works even though
// .content uses overflow-x: hidden (which breaks CSS position: sticky).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type BarState = { visible: boolean; left: number; width: number; scrollWidth: number }

const HIDDEN: BarState = { visible: false, left: 0, width: 0, scrollWidth: 0 }

export default function StickyHScrollbar({ target }: { target: HTMLElement | null }) {
  const barRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<BarState>(HIDDEN)

  // Measure the table wrapper and decide whether the floating bar is needed.
  useEffect(() => {
    if (!target) return
    let raf = 0

    const measure = () => {
      raf = 0
      const rect = target.getBoundingClientRect()
      const viewportH = window.innerHeight
      const overflows = target.scrollWidth - target.clientWidth > 1
      // Show only while the table is on screen but its bottom edge (where the
      // native scrollbar lives) is below the viewport.
      const visible = overflows && rect.top < viewportH - 60 && rect.bottom > viewportH
      const next: BarState = visible
        ? { visible, left: Math.round(rect.left), width: Math.round(target.clientWidth), scrollWidth: target.scrollWidth }
        : HIDDEN
      setState((prev) =>
        prev.visible === next.visible && prev.left === next.left && prev.width === next.width && prev.scrollWidth === next.scrollWidth
          ? prev
          : next,
      )
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure) }

    // Table → floating bar
    const onTargetScroll = () => {
      const bar = barRef.current
      if (bar && Math.abs(bar.scrollLeft - target.scrollLeft) > 1) bar.scrollLeft = target.scrollLeft
    }

    // Re-measure when the table, its rows, or the page layout change size.
    const resizeObserver = new ResizeObserver(schedule)
    const observeChildren = () => {
      resizeObserver.disconnect()
      resizeObserver.observe(target)
      Array.from(target.children).forEach((child) => resizeObserver.observe(child))
    }
    observeChildren()
    const mutationObserver = new MutationObserver(() => { observeChildren(); schedule() })
    mutationObserver.observe(target, { childList: true })

    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    target.addEventListener('scroll', onTargetScroll, { passive: true })
    measure()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      target.removeEventListener('scroll', onTargetScroll)
    }
  }, [target])

  // When the bar appears, start it at the table's current position and
  // forward its scrolling to the table (floating bar → table).
  useEffect(() => {
    const bar = barRef.current
    if (!state.visible || !target || !bar) return
    bar.scrollLeft = target.scrollLeft
    const onBarScroll = () => {
      if (Math.abs(target.scrollLeft - bar.scrollLeft) > 1) target.scrollLeft = bar.scrollLeft
    }
    bar.addEventListener('scroll', onBarScroll, { passive: true })
    return () => bar.removeEventListener('scroll', onBarScroll)
  }, [state.visible, state.scrollWidth, target])

  if (!state.visible || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={barRef}
      className="sticky-hscroll"
      style={{ left: state.left, width: state.width }}
      aria-hidden="true"
    >
      <div style={{ width: state.scrollWidth, height: 1 }} />
    </div>,
    document.body,
  )
}
