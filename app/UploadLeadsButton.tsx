'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadLeadsCsv } from './upload-actions'

// Minimal, dependency-free CSV parser that handles quoted fields and commas
// inside quotes. Returns array of row-objects keyed by the header row.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* ignore */ }
      else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }

  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim())
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {}
      headers.forEach((h, idx) => { obj[h] = r[idx] ?? '' })
      return obj
    })
}

export default function UploadLeadsButton() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const onPick = () => inputRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setMsg('Reading file…')
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (rows.length === 0) { setMsg('No rows found in that file.'); setBusy(false); return }
      setMsg(`Uploading ${rows.length} rows…`)
      const res = await uploadLeadsCsv(rows)
      setMsg(res.message)
      if (res.ok) router.refresh()
    } catch (err: any) {
      setMsg('Upload failed: ' + (err?.message ?? 'unknown error'))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {msg && <span style={{ fontSize: 12, color: '#8a99a8' }}>{msg}</span>}
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