'use client'

// ← CHANGED: "Upload worksheets" now opens a small panel.
//
//  • An agent's call work — CSV columns: NPI, Disposition / Response,
//    Call details * / Note. Pick the company and the agent who did the work;
//    good rows become that agent's call worksheets on Active Call, rows with
//    a problem are skipped and listed (and can be downloaded to fix).
//  • The full worksheet file (Company Name, Agent Name, NPI, Notes, …) still
//    works exactly as before — it is detected automatically.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseCsv, detectDelimiter, readUploadText } from '../../lib/csv' // ← CHANGED: + delimiter / encoding detection
import { importWorksheetCsv, importAgentWorksheetCsv, getImportAgents, type ImportAgentOption } from '../worksheet-import-actions'
import { isFullWorksheetFormat, looksLikeWorksheetHeader, type SkippedRow } from '../../lib/agent-worksheet-import' // ← CHANGED
import { toCsv, downloadFile } from '../../lib/export-file'

type Company = { id: string; name: string }

export default function UploadWorksheetCsvButton({ companies = [], defaultCompanyId }: {
  companies?: Company[]
  defaultCompanyId?: string
}) {
  const input = useRef<HTMLInputElement>(null), router = useRouter()
  const [open, setOpen] = useState(false)
  const [companyId, setCompanyId] = useState(defaultCompanyId ?? '')
  const [agents, setAgents] = useState<ImportAgentOption[]>([])
  const [agentId, setAgentId] = useState('')
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [skipped, setSkipped] = useState<SkippedRow[]>([])

  // People of the chosen company, for the Agent dropdown.
  useEffect(() => {
    if (!open || !companyId) return
    let cancelled = false
    void Promise.resolve().then(async () => {
      setAgentsLoading(true); setAgents([]); setAgentId('')
      try {
        const res = await getImportAgents(companyId)
        if (cancelled) return
        if (!res.ok) setMessage({ ok: false, text: res.message ?? 'Could not load agents.' })
        else setAgents(res.agents ?? [])
      } finally { if (!cancelled) setAgentsLoading(false) }
    })
    return () => { cancelled = true }
  }, [open, companyId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy])

  async function upload(file?: File) {
    if (!file) return
    setBusy(true); setMessage({ ok: true, text: 'Checking the file…' }); setSkipped([])
    try {
      // ← CHANGED: accepts comma, semicolon or tab separated files, Excel
      // "Unicode Text", and a title row above the column names.
      const read = await readUploadText(file)
      if (!read.ok) { setMessage({ ok: false, text: read.message }); return }
      const rows = parseCsv(read.text, { delimiter: detectDelimiter(read.text), findHeader: looksLikeWorksheetHeader })
      if (!rows.length) { setMessage({ ok: false, text: 'No data rows were found in the file.' }); return }
      if (isFullWorksheetFormat(rows)) {
        // Old full format — Company Name + Agent Name in the file itself.
        const result = await importWorksheetCsv(file.name, rows)
        setMessage({ ok: result.ok, text: result.ok ? `${result.message} (full worksheet file)` : [result.message, ...(result.errors ?? []).slice(0, 3)].join(' ') })
        if (result.ok) { window.dispatchEvent(new CustomEvent('reminders:changed')); router.refresh() }
        return
      }
      if (!companyId || !agentId) { setMessage({ ok: false, text: 'Choose the company and the agent first.' }); return }
      const result = await importAgentWorksheetCsv(file.name, companyId, agentId, rows)
      setMessage({ ok: result.ok, text: result.message })
      setSkipped(result.skipped ?? [])
      if ((result.imported ?? 0) > 0) { window.dispatchEvent(new CustomEvent('reminders:changed')); router.refresh() }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Upload failed.' })
    } finally {
      setBusy(false); if (input.current) input.current.value = ''
    }
  }

  const downloadSkipped = () => downloadFile(
    `skipped-rows-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv({ headers: ['Row', 'NPI', 'Reason'], rows: skipped.map((s) => [String(s.row), s.npi ?? '', s.reason]) }),
    'text/csv;charset=utf-8',
  )

  const agentName = agents.find((a) => a.id === agentId)?.name
  const ready = !!companyId && !!agentId && !busy

  return <>
    <button type="button" className="btn btn-primary" onClick={() => { setOpen(true); setMessage(null); setSkipped([]) }}>Upload worksheets</button>
    {open && (
      <div role="presentation" onClick={() => { if (!busy) setOpen(false) }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 16px', overflowY: 'auto' }}>
        <div role="dialog" aria-modal="true" aria-label="Upload worksheets" className="card" onClick={(e) => e.stopPropagation()}
          style={{ width: 'min(620px, 100%)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Upload an agent&apos;s call work</h2>
          <p className="subtle" style={{ margin: '0 0 16px', fontSize: 12.5, lineHeight: 1.5 }}>
            CSV columns: <strong>NPI</strong>, <strong>Disposition / Response</strong>, <strong>Call details * / Note</strong>.
            The leads must already be in the CRM. Each good row is saved as the chosen agent&apos;s worksheet and shows on
            Active Call; rows with a problem are skipped and listed.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <label style={{ display: 'grid', gap: 5, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted)' }}>
              Company
              <select className="input" value={companyId} disabled={busy} onChange={(e) => { setCompanyId(e.target.value); setMessage(null) }}>
                <option value="">— Choose company —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 5, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted)' }}>
              Agent who did the work
              <select className="input" value={agentId} disabled={busy || !companyId || agentsLoading} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">{!companyId ? 'Choose a company first' : agentsLoading ? 'Loading…' : agents.length ? '— Choose agent —' : 'No active users'}</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => input.current?.click()}>
              {busy ? 'Importing…' : 'Choose CSV and import'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>Close</button>
            {agentName && !busy && <span className="subtle" style={{ fontSize: 12 }}>Work will be recorded as <strong>{agentName}</strong>.</span>}
            <input ref={input} hidden type="file" accept=".csv,text/csv" onChange={(event) => upload(event.target.files?.[0])} />
          </div>

          {message && (
            <p role={message.ok ? 'status' : 'alert'} style={{ margin: '14px 0 0', fontSize: 13, fontWeight: 600, color: message.ok ? 'var(--ok)' : 'var(--danger)' }}>
              {message.text}
            </p>
          )}

          {skipped.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: 12.5 }}>Skipped rows ({skipped.length})</strong>
                <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 10px' }} onClick={downloadSkipped}>Download list (CSV)</button>
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
                  <thead><tr><th style={{ width: 52 }}>Row</th><th style={{ width: 120 }}>NPI</th><th>Reason</th></tr></thead>
                  <tbody>
                    {skipped.slice(0, 500).map((s) => (
                      <tr key={`${s.row}-${s.npi ?? ''}`}><td>{s.row}</td><td style={{ fontFamily: 'ui-monospace, monospace' }}>{s.npi ?? '—'}</td><td>{s.reason}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="subtle" style={{ margin: '14px 0 0', fontSize: 11.5 }}>
            A full worksheet file with <strong>Company Name</strong> and <strong>Agent Name</strong> columns is still accepted — it is detected automatically and the choices above are not needed.
          </p>
        </div>
      </div>
    )}
  </>
}
