'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadLeadsCsv } from './upload-actions'
import { parseCsv, type CsvRow } from '../lib/csv' // ← CHANGED: + CsvRow type
import { markLeadsChanged } from '../lib/leads-fresh' // ← ADDED

// ← ADDED: big files are sent in parts. One request is capped at 10 MB
// locally and 4.5 MB on Vercel, so a ~10,000-row CSV in one go fails with
// "Unterminated string in JSON". Each part stays far below both limits.
// uploadLeadsCsv (the server side) is unchanged — it is simply called once
// per part. Every row is classified on its own columns, so splitting the
// file gives the same result as one upload.
const MAX_PART_CHARS = 2_000_000 // ~2 MB of data per request
const MAX_PART_ROWS = 2000

// ← ADDED: keep the first row for each NPI — the same rule the server applies
// inside one upload — so a duplicate NPI in a later part can't behave
// differently from a duplicate in the same part.
function dedupeByNpi(rows: CsvRow[]): { rows: CsvRow[]; uniqueNpis: number } {
  const npiKey = Object.keys(rows[0] ?? {}).find(key => key.trim().toLowerCase() === 'npi')
  if (!npiKey) return { rows, uniqueNpis: 0 } // server reports the missing NPI column
  const seen = new Set<string>()
  const out: CsvRow[] = []
  for (const row of rows) {
    const npi = (row[npiKey] ?? '').trim()
    if (!npi) continue // the server ignores rows without an NPI as well
    if (seen.has(npi)) continue
    seen.add(npi)
    out.push(row)
  }
  return { rows: out, uniqueNpis: seen.size }
}

// ← ADDED: split by size AND row count, so wide CSVs (many/long columns)
// still produce small requests.
function splitIntoParts(rows: CsvRow[]): CsvRow[][] {
  const parts: CsvRow[][] = []
  let current: CsvRow[] = []
  let size = 0
  for (const row of rows) {
    const rowSize = JSON.stringify(row).length + 1
    if (current.length && (size + rowSize > MAX_PART_CHARS || current.length >= MAX_PART_ROWS)) {
      parts.push(current)
      current = []
      size = 0
    }
    current.push(row)
    size += rowSize
  }
  if (current.length) parts.push(current)
  return parts
}

export default function UploadLeadsButton() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [details, setDetails] = useState('') // ← ADDED: per-part results (hover the message)

  // ← ADDED: warn before closing the tab in the middle of a multi-part upload.
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  const onPick = () => inputRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setDetails('')
    setMsg('Reading file…')
    let anySaved = false
    try {
      const text = await file.text()
      const parsed = parseCsv(text)
      if (parsed.length === 0) { setMsg('No rows found in that file.'); return }

      const { rows, uniqueNpis } = dedupeByNpi(parsed)
      // No NPI column / no NPI values: let the server give its usual message.
      const parts = rows.length ? splitIntoParts(rows) : [parsed]

      // ← CHANGED: small files still go in ONE request, exactly as before.
      if (parts.length === 1) {
        setMsg(`Uploading ${parsed.length} rows…`)
        const res = await uploadLeadsCsv(parts[0])
        setMsg(res.message)
        if (res.ok) { markLeadsChanged(); router.refresh() } // ← CHANGED
        return
      }

      // ← ADDED: large file — upload part by part, in order.
      let inserted = 0
      let skipped = 0
      const partMessages: string[] = []
      let done = 0
      for (let i = 0; i < parts.length; i++) {
        const from = done + 1
        const to = done + parts[i].length
        setMsg(`Uploading part ${i + 1} of ${parts.length} (rows ${from.toLocaleString()}–${to.toLocaleString()} of ${rows.length.toLocaleString()})…`)
        let res: Awaited<ReturnType<typeof uploadLeadsCsv>>
        try {
          res = await uploadLeadsCsv(parts[i])
        } catch (err: unknown) {
          res = { ok: false, message: err instanceof Error ? err.message : 'network error' }
        }
        partMessages.push(`Part ${i + 1}: ${res.message}`)
        setDetails(partMessages.join('\n'))
        if (!res.ok) {
          setMsg(
            `Part ${i + 1} of ${parts.length} failed: ${res.message}` +
            (i > 0
              ? ` Parts 1–${i} (${done.toLocaleString()} rows) were saved. Upload the same file again — saved rows are skipped as duplicates.`
              : ''),
          )
          return
        }
        anySaved = true
        inserted += res.inserted ?? 0
        skipped += res.skipped ?? 0
        done = to
      }

      // inserted = main leads; skipped = already existing (incl. enriched);
      // whatever is left of the unique NPIs went in as roster members.
      const roster = Math.max(0, uniqueNpis - inserted - skipped)
      const enrichedNote = partMessages.some(m => /enrich|eligible for Credentialing/i.test(m))
        ? ' Some existing leads were enriched or need review — hover this message for details.'
        : ''
      setMsg(
        `Done — ${rows.length.toLocaleString()} rows in ${parts.length} parts. ` +
        `Uploaded ${inserted.toLocaleString()} lead(s)` +
        (roster ? ` + ${roster.toLocaleString()} roster member(s)` : '') +
        (skipped ? `, ${skipped.toLocaleString()} already existed` : '') +
        '.' + enrichedNote,
      )
    } catch (err: unknown) {
      setMsg('Upload failed: ' + (err instanceof Error ? err.message : 'unknown error'))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
      if (anySaved) { markLeadsChanged(); router.refresh() } // ← CHANGED: show saved rows even if a later part failed (fresh, not the instant snapshot)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {msg && <span title={details || undefined} role="status" style={{ fontSize: 12, color: '#8a99a8' }}>{msg}</span>}
      <button
        onClick={onPick}
        disabled={busy}
        style={{
          background: busy ? '#1c2836' : '#3b82f6',
          color: '#fff', border: 'none', borderRadius: 8,
          padding: '9px 16px', fontSize: 13, fontWeight: 600,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Uploading…' : '⬆ Upload CSV'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onFile}
        style={{ display: 'none' }}
      />
    </div>
  )
}

