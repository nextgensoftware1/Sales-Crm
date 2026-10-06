'use client'

import { useEffect, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

// Open/close state for the page's left "workspace" panel (the Leads page
// panel, the Assigned Leads company panel and every other page's context
// panel). One remembered preference is shared by all pages, like the main
// sidebar's expand/collapse.
const STORAGE_KEY = 'hbs-workspace-panel-open'
const SYNC_EVENT = 'hbs-workspace-panel-change'

export function useWorkspacePanel(): [boolean, () => void] {
  // Open by default (also what the server renders); the saved choice is
  // applied right after the page loads, as the main sidebar does.
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const read = () => {
      try { setOpen(window.localStorage.getItem(STORAGE_KEY) !== 'false') } catch { /* storage unavailable */ }
    }
    read()
    window.addEventListener(SYNC_EVENT, read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener(SYNC_EVENT, read)
      window.removeEventListener('storage', read)
    }
  }, [])

  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next))
      window.dispatchEvent(new Event(SYNC_EVENT))
    } catch { /* storage unavailable: still toggles for this page */ }
  }

  return [open, toggle]
}

/**
 * Open: a small icon button in the panel's top-right corner.
 * Collapsed: the button becomes the whole slim rail — an accent icon tile
 * plus the panel's name written vertically — and clicking anywhere on the
 * rail opens the panel again.
 */
export default function WorkspacePanelToggle({ open, onToggle, panelId, label }: {
  open: boolean
  onToggle: () => void
  panelId: string
  label: string
}) {
  const title = open ? `Collapse ${label} panel` : `Expand ${label} panel`
  const Icon = open ? PanelLeftClose : PanelLeftOpen
  return (
    <button
      type="button"
      className="workspace-panel-toggle"
      onClick={onToggle}
      aria-label={title}
      title={title}
      aria-expanded={open}
      aria-controls={panelId}
    >
      <span className="workspace-panel-toggle-icon" aria-hidden="true"><Icon size={17} strokeWidth={2} /></span>
      {!open && <span className="workspace-panel-rail-label" aria-hidden="true">{label}</span>}
    </button>
  )
}
