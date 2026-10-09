'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

/**
 * Dropdown that keeps several choices: click options to add or remove them —
 * the list stays open so you can keep picking. Includes a search box (long
 * lists such as specialties), "Select shown" and "Clear". Empty = all.
 */
export default function MultiSelectFilter({ label, allLabel, options, selected, onChange, style, searchPlaceholder = 'Search…' }: {
  label: string
  allLabel: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  style?: CSSProperties
  searchPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const chosen = useMemo(() => new Set(selected), [selected])

  // Close when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  useEffect(() => { if (open) searchRef.current?.focus() }, [open])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options
  }, [options, query])

  const toggle = (value: string) => onChange(chosen.has(value) ? selected.filter((v) => v !== value) : [...selected, value])
  const summary = selected.length === 0 ? allLabel
    : selected.length === 1 ? selected[0]
    : `${selected[0]} +${selected.length - 1} more`

  return (
    <div className="multi-select" ref={rootRef}>
      <button type="button" className="multi-select-trigger" style={style} aria-haspopup="listbox" aria-expanded={open}
        aria-controls={listId} aria-label={`${label}: ${selected.length ? `${selected.length} selected` : allLabel}`}
        title={selected.length > 1 ? selected.join(', ') : undefined}
        onClick={() => { setOpen((o) => !o); setQuery('') }}>
        <span className="multi-select-summary">{summary}</span>
        {selected.length > 1 && <span className="multi-select-count">{selected.length}</span>}
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="multi-select-pop">
          <input ref={searchRef} type="search" className="multi-select-search" placeholder={searchPlaceholder} aria-label={`Search ${label.toLowerCase()}`}
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="multi-select-actions">
            <span>{selected.length ? `${selected.length} selected` : allLabel}</span>
            <span>
              {shown.length > 0 && <button type="button" onClick={() => onChange(Array.from(new Set([...selected, ...shown])))}>Select shown</button>}
              {selected.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}
            </span>
          </div>
          <ul id={listId} role="listbox" aria-multiselectable="true" aria-label={label} className="multi-select-list">
            {shown.length === 0 ? <li className="multi-select-empty">No matches</li> : shown.map((option) => (
              <li key={option} role="option" aria-selected={chosen.has(option)} tabIndex={0}
                className={'multi-select-option' + (chosen.has(option) ? ' is-selected' : '')}
                onClick={() => toggle(option)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(option) } }}>
                <span className="multi-select-check" aria-hidden="true">{chosen.has(option) ? '✓' : ''}</span>
                <span>{option}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
