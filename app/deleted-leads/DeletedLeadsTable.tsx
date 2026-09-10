'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { restoreLeads, hardDeleteLeads } from '../actions'

type DeletedRow = {
  id: string
  practiceCode: string
  name: string
  state: string | null
  specialty: string | null
  deletedAt: string | null
  deletedByName: string | null
  allocatedTo: string[]  // company names that still have this allocated
  isAssigned: boolean    // any active person-level assignment
}

type Props = { rows: DeletedRow[] }

const C = {
  panel: 'var(--surface)',
  panelAlt: 'var(--surface-2)',
  line: 'var(--border-dim)',
  text: 'var(--ink-strong)',
  dim: 'var(--muted)',
  faint: 'var(--muted-2)',
  blue: 'var(--accent)',
  green: 'var(--ok)',
  amber: 'var(--warn)',
  danger: 'var(--danger, #c0392b)',
  violet: 'var(--purple)',
  cyan: 'var(--c-transfers)',
}

export default function DeletedLeadsTable({ rows }: Props) {
  const router = useRouter()

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.practiceCode.toLowerCase().includes(q) ||
      (r.state ?? '').toLowerCase().includes(q) ||
      (r.specialty ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  const toggleOne = (code: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  const allSelected = filtered.length > 0 && filtered.every(r => selected.has(r.practiceCode))
  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) filtered.forEach(r => next.delete(r.practiceCode))
      else filtered.forEach(r => next.add(r.practiceCode))
      return next
    })
  }

  const handleRestore = async () => {
    if (selected.size === 0) { setMsg('Select at least one lead.'); return }
    if (!window.confirm(`Restore ${selected.size} lead(s) back to the main pool?`)) return
    setBusy(true)
    const res = await restoreLeads(Array.from(selected))
    setMsg(res.message)
    setBusy(false)
    if (res.ok) {
      setSelected(new Set())
      router.refresh()
    }
  }

  const handleHardDelete = async () => {
    if (selected.size === 0) { setMsg('Select at least one lead.'); return }

    // Extra strong confirmation for irreversible action.
    const anyStillLive = filtered.some(r =>
      selected.has(r.practiceCode) && (r.allocatedTo.length > 0 || r.isAssigned)
    )
    const warning = anyStillLive
      ? '\n\n⚠️  WARNING: Some selected leads are still allocated or assigned to a company/agent. Hard-delete will pull them out from under active work.\n\n'
      : '\n\n'

    if (!window.confirm(
      `Permanently DELETE ${selected.size} lead(s) from the database?${warning}` +
      `This cannot be undone. Type OK on the next dialog to confirm.`
    )) return

    const typed = window.prompt('Type DELETE to confirm permanent deletion:')
    if (typed !== 'DELETE') { setMsg('Cancelled — you must type DELETE exactly.'); return }

    setBusy(true)
    const res = await hardDeleteLeads(Array.from(selected))
    setMsg(res.message)
    setBusy(false)
    if (res.ok) {
      setSelected(new Set())
      router.refresh()
    }
  }

  return (
    <div style={{ color: C.text, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* ---- Toolbar ---- */}
      <section style={{ ...panel, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          placeholder="Search by name, code, state, specialty…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...input, minWidth: 260, flex: 1, maxWidth: 380 }}
        />
        <strong style={{ fontSize: 14 }}>{selected.size} selected</strong>
        <button
          onClick={handleRestore}
          disabled={busy || selected.size === 0}
          style={{
            ...btnPrimary,
            background: C.green,
            opacity: (busy || selected.size === 0) ? 0.6 : 1,
            cursor: (busy || selected.size === 0) ? 'not-allowed' : 'pointer',
          }}
          title="Restore selected leads to the main pool"
        >
          ↺ Restore to Pool
        </button>
        <button
          onClick={handleHardDelete}
          disabled={busy || selected.size === 0}
          style={{
            ...btnPrimary,
            background: C.danger,
            opacity: (busy || selected.size === 0) ? 0.6 : 1,
            cursor: (busy || selected.size === 0) ? 'not-allowed' : 'pointer',
          }}
          title="Permanently delete from database — cannot be undone"
        >
          ✕ Delete Permanently
        </button>
        {msg && <span style={{ fontSize: 13, color: C.dim }}>{msg}</span>}
      </section>

      {/* ---- Table ---- */}
      <section style={{ ...panel, padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.line}` }}>
              <th style={th}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} title={allSelected ? 'Clear all' : 'Select all'} />
              </th>
              <th style={{ ...thLeft, minWidth: 240 }}>Practice</th>
              <th style={th}>State</th>
              <th style={thLeft}>Specialty</th>
              <th style={thLeft}>Still Allocated / Assigned</th>
              <th style={thLeft}>Deleted On</th>
              <th style={thLeft}>Deleted By</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => {
              const isLive = r.allocatedTo.length > 0 || r.isAssigned
              return (
                <tr key={r.practiceCode} style={{ borderBottom: `1px solid ${C.line}`, background: isLive ? 'color-mix(in srgb, var(--warn) 8%, transparent)' : 'transparent' }}>
                  <td style={td}>
                    <input type="checkbox" checked={selected.has(r.practiceCode)} onChange={() => toggleOne(r.practiceCode)} />
                  </td>
                  <td style={{ ...tdLeft, minWidth: 240 }}>
                    <div style={{ fontWeight: 700, color: C.cyan, fontSize: 13.5 }}>{r.name}</div>
                    <div style={{ fontSize: 10, color: C.faint, fontFamily: 'ui-monospace, monospace', fontWeight: 600, letterSpacing: 0.3, marginTop: 3 }}>{r.practiceCode}</div>
                  </td>
                  <td style={{ ...td, color: C.text, fontWeight: 700 }}>{r.state ?? '—'}</td>
                  <td style={{ ...tdLeft, color: C.dim }}>{r.specialty ?? '—'}</td>
                  <td style={tdLeft}>
                    {r.allocatedTo.length === 0 && !r.isAssigned ? (
                      <span style={{ color: C.faint, fontSize: 12 }}>Not in use</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {r.allocatedTo.map(name => (
                          <span key={name} style={badge(C.violet)}>{name}</span>
                        ))}
                        {r.isAssigned && (
                          <span style={badge(C.amber)} title="Currently assigned to an agent/closer">
                            Assigned
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdLeft, color: C.dim, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{fmtDateTime(r.deletedAt)}</td>
                  <td style={{ ...tdLeft, color: C.dim, fontSize: 12 }}>{r.deletedByName ?? '—'}</td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...tdLeft, color: C.faint, padding: 32, textAlign: 'center' }}>
                  {rows.length === 0
                    ? 'No deleted leads. When you delete leads from the main pool, they will appear here.'
                    : 'No leads match your search.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div style={{ marginTop: 14, fontSize: 12, color: C.dim }}>
        Showing {filtered.length} of {rows.length} deleted lead{rows.length === 1 ? '' : 's'}.
        {' '}Rows highlighted in <span style={{ color: C.amber, fontWeight: 700 }}>amber</span> are still allocated or assigned somewhere.
      </div>
    </div>
  )
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// ---- shared styles ----
const panel: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 0, padding: 18 }
const input: React.CSSProperties = { background: C.panelAlt, color: C.text, border: `1px solid ${C.line}`, borderRadius: 0, padding: '8px 12px', fontSize: 13 }
const btnPrimary: React.CSSProperties = { background: C.blue, color: '#fff', border: 'none', borderRadius: 0, padding: '8px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }
const th: React.CSSProperties = { padding: '14px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.6, whiteSpace: 'nowrap' }
const thLeft: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '14px 16px', textAlign: 'center' }
const tdLeft: React.CSSProperties = { padding: '14px 16px', textAlign: 'left' }

function badge(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700,
    color, border: `1px solid ${color}`, borderRadius: 999,
    padding: '3px 10px', background: `color-mix(in srgb, ${color} 15%, transparent)`, lineHeight: 1,
  }
}