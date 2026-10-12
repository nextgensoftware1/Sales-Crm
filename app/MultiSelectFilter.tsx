'use client'

// ← ADDED (new file) — dropdown that lets you tick several options at once,
// with a search box for long lists (e.g. specialties). Used by the Leads
// Engine "Specialty" filter. Empty selection = "All".

import { useEffect, useId, useMemo, useRef, useState } from 'react'

export default function MultiSelectFilter({
  options, selected, onChange, allLabel, noun, style, ariaLabel,
}: {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Button text when nothing is selected, e.g. "All Specialties". */
  allLabel: string
  /** Plural noun for the summary, e.g. "specialties". */
  noun: string
  style?: React.CSSProperties
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options
  }, [options, query])

  const toggle = (value: string) => {
    onChange(selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }
  const selectShown = () => onChange(Array.from(new Set([...selected, ...shown])))

  const summary = selected.length === 0
    ? allLabel
    : selected.length === 1 ? selected[0] : `${selected.length} ${noun} selected`

  return (
    <div ref={boxRef} style={{ position: 'relative', minWidth: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...style, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 8, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={selected.join(', ') || undefined}>{summary}</span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', transform: open ? 'rotate(180deg)' : undefined }}><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 50, top: 'calc(100% + 4px)', left: 0, right: 0, minWidth: 260,
            background: 'var(--surface, #fff)', color: 'var(--ink, #111)', border: '1px solid var(--border, #d6dde3)',
            borderRadius: 8, boxShadow: '0 12px 32px rgba(10, 30, 45, 0.18)', padding: 8,
          }}
        >
          <input
            autoFocus
            type="search"
            className="input"
            placeholder={`Search ${noun}…`}
            aria-label={`Search ${noun}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%', fontSize: 13, padding: '7px 10px', borderRadius: 6, marginBottom: 6, boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '2px 2px 6px', fontSize: 12 }}>
            <span style={{ color: 'var(--muted, #667)' }}>{selected.length} selected</span>
            <span style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={selectShown} disabled={shown.length === 0}
                style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent-dark, #0f766e)', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                {query ? 'Select shown' : 'Select all'}
              </button>
              <button type="button" onClick={() => onChange([])} disabled={selected.length === 0}
                style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent-dark, #0f766e)', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
                Clear
              </button>
            </span>
          </div>
          <div id={listId} role="listbox" aria-multiselectable="true" aria-label={ariaLabel} style={{ maxHeight: 280, overflowY: 'auto' }}>
            {shown.length === 0 ? (
              <p style={{ margin: 0, padding: '8px 4px', fontSize: 12, color: 'var(--muted, #667)' }}>No {noun} match “{query}”.</p>
            ) : shown.map((option) => (
              <label key={option} role="option" aria-selected={selectedSet.has(option)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontSize: 13, cursor: 'pointer', borderRadius: 4 }}>
                <input type="checkbox" checked={selectedSet.has(option)} onChange={() => toggle(option)} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
