'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseCsv } from '../../lib/csv'
import { importWorksheetCsv } from '../worksheet-import-actions'

export default function UploadWorksheetCsvButton() {
  const input = useRef<HTMLInputElement>(null), router = useRouter()
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  async function upload(file?: File) {
    if (!file) return
    setBusy(true); setMessage('Validating…')
    try {
      const result = await importWorksheetCsv(file.name, parseCsv(await file.text()))
      setMessage(result.ok ? result.message : [result.message, ...(result.errors ?? []).slice(0, 3)].join(' '))
      if (result.ok) router.refresh()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Upload failed.') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    {message && <span className="subtle" style={{ fontSize: 11, maxWidth: 420 }}>{message}</span>}
    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Importing…' : 'Upload worksheets'}</button>
    <input ref={input} hidden type="file" accept=".csv,text/csv" onChange={event => upload(event.target.files?.[0])} />
  </div>
}
