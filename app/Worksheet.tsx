'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { saveWorksheet, type WorksheetData } from './worksheet-actions'
import { logActivity, setReminder, getClosers, transferToCloser, markAsSold } from './actions'

const C = {
  panel: '#0f1620', panelAlt: '#0b1119', line: '#1c2836',
  text: '#e6edf3', dim: '#8a99a8', faint: '#566472', cyan: '#22d3ee', blue: '#3b82f6',
  amber: '#d97706', violet: '#7c3aed', green: '#16a34a', red: '#dc2626',
}

const DISPOSITIONS = ['New', 'No Answer', 'Voicemail', 'Interested', 'Not Interested', 'Callback', 'Qualified', 'DNC', 'Sold']
const TIMEZONES = ['Eastern', 'Central', 'Mountain', 'Pacific', 'Other']
const HANDOFF_STATUSES = ['Pending', 'Sent', 'Signed']

type Initial = Partial<WorksheetData> & { updatedByName?: string | null; updatedAt?: string | null }

export default function Worksheet({ practiceCode, initial }: { practiceCode: string; initial?: Initial }) {
  const router = useRouter()

  // Worksheet fields
  const [callDetails, setCallDetails] = useState(initial?.callDetails ?? '')
  const [additionalPhone, setAdditionalPhone] = useState(initial?.additionalPhone ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [concernedPerson, setConcernedPerson] = useState(initial?.concernedPerson ?? '')
  const [directLine, setDirectLine] = useState(initial?.directLine ?? '')
  const [callbackAt, setCallbackAt] = useState(initial?.callbackAt ?? '')
  const [timezone, setTimezone] = useState(initial?.timezone ?? 'Eastern')
  const [disposition, setDisposition] = useState(initial?.disposition ?? 'New')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Transfer
  const [closers, setClosers] = useState<{ id: string; name: string; email: string }[]>([])
  const [closerId, setCloserId] = useState('')
  const [handoffStatus, setHandoffStatus] = useState('')
  const [transferMsg, setTransferMsg] = useState('')

  // Sale
  const [service, setService] = useState('')
  const [contractValue, setContractValue] = useState('')
  const [mrr, setMrr] = useState('')
  const [saleNote, setSaleNote] = useState('')
  const [saleMsg, setSaleMsg] = useState('')

  useEffect(() => { getClosers().then(setClosers) }, [])

  const setQuick = (mins: number) => {
    const d = new Date(Date.now() + mins * 60000)
    const pad = (n: number) => String(n).padStart(2, '0')
    setCallbackAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
  }

  // Save the worksheet. Also logs an activity (disposition + call details as the note)
  // so Activity History records it, and creates a reminder if a callback is set.
  const save = async () => {
    setSaving(true); setMsg('')
    const res = await saveWorksheet(practiceCode, {
      callDetails, additionalPhone, email, concernedPerson, directLine, callbackAt, timezone, disposition,
    })
    if (res.ok && disposition && disposition !== 'New') {
      // log it as activity too (note required = the call details)
      await logActivity(practiceCode, disposition, callDetails || `Disposition: ${disposition}`)
    }
    setSaving(false)
    setMsg(res.message)
    if (res.ok) router.refresh()
  }

  const doTransfer = async () => {
    if (!closerId) { setTransferMsg('Pick a closer.'); return }
    if (!handoffStatus) { setTransferMsg('Pick a handoff status.'); return }
    const res = await transferToCloser(practiceCode, closerId, handoffStatus)
    setTransferMsg(res.message)
    if (res.ok) { setHandoffStatus(''); setCloserId(''); router.refresh() }
  }

  const doSale = async () => {
    if (!service.trim()) { setSaleMsg('Enter the service sold.'); return }
    const res = await markAsSold(practiceCode, service.trim(), contractValue, mrr, saleNote.trim())
    setSaleMsg(res.message)
    if (res.ok) { setService(''); setContractValue(''); setMrr(''); setSaleNote(''); router.refresh() }
  }

  const field: React.CSSProperties = {
    width: '100%', padding: '9px 12px', boxSizing: 'border-box',
    background: C.panelAlt, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 13,
  }
  const lbl: React.CSSProperties = { fontSize: 10, color: C.faint, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, display: 'block' }
  const sectionTitle: React.CSSProperties = { fontSize: 12, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 10px' }

  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: C.cyan }}>▭</span> Worksheet
      </h2>

      <textarea
        value={callDetails} onChange={(e) => setCallDetails(e.target.value)}
        placeholder="Type call details, gating factors, next steps…"
        style={{ ...field, minHeight: 90, marginBottom: 14 }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
        <div><label style={lbl}>Additional Phone</label>
          <input value={additionalPhone} onChange={(e) => setAdditionalPhone(e.target.value)} placeholder="Secondary / Mobile Phone" style={field} /></div>
        <div><label style={lbl}>Email Address</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@practice.com" style={field} /></div>
        <div><label style={lbl}>Concerned Person</label>
          <input value={concernedPerson} onChange={(e) => setConcernedPerson(e.target.value)} placeholder="e.g. Practice Administrator" style={field} /></div>
        <div><label style={lbl}>Direct Line</label>
          <input value={directLine} onChange={(e) => setDirectLine(e.target.value)} placeholder="Direct Phone / Extension" style={field} /></div>
      </div>

      <label style={{ ...lbl, marginTop: 14 }}>Follow-up / Callback</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} style={{ ...field, flex: 1, minWidth: 190 }} />
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ ...field, width: 120 }}>
          {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {[['Today +1h', 60], ['Tomorrow 9:00', 60 * 24], ['Tomorrow 11:00', 60 * 26], ['Tomorrow 14:00', 60 * 29], ['Next Monday 10:00', 60 * 24 * 3]].map(([label, mins]) => (
          <button key={label as string} onClick={() => setQuick(mins as number)}
            style={{ background: 'transparent', color: C.cyan, border: 'none', fontSize: 12, cursor: 'pointer', padding: 0 }}>
            {label}
          </button>
        ))}
      </div>

      <label style={lbl}>Call Disposition</label>
      <select value={disposition} onChange={(e) => setDisposition(e.target.value)} style={{ ...field, marginBottom: 16 }}>
        {DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>

      <button onClick={save} disabled={saving}
        style={{ width: '100%', background: C.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '11px', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
        {saving ? 'Saving…' : 'Save Worksheet Details'}
      </button>
      {msg && <p style={{ fontSize: 12, color: C.dim, marginTop: 10 }}>{msg}</p>}
      {initial?.updatedByName && (
        <p style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>
          Last updated by {initial.updatedByName}{initial.updatedAt ? ` · ${new Date(initial.updatedAt).toLocaleString()}` : ''}
        </p>
      )}

      {/* Transfer to Closer */}
      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 18, paddingTop: 14 }}>
        <div style={sectionTitle}>Qualified Lead Transfer</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={closerId} onChange={(e) => setCloserId(e.target.value)} style={{ ...field, flex: 1, minWidth: 150 }}>
            <option value="">Choose closer…</option>
            {closers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
          </select>
          <select value={handoffStatus} onChange={(e) => setHandoffStatus(e.target.value)} style={{ ...field, width: 150 }}>
            <option value="">Handoff status…</option>
            {HANDOFF_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={doTransfer}
          style={{ marginTop: 10, width: '100%', background: C.violet, color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Transfer to Closer
        </button>
        {transferMsg && <p style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>{transferMsg}</p>}
      </div>

      {/* Close the sale */}
      <div style={{ borderTop: `2px solid ${C.green}`, marginTop: 18, paddingTop: 14 }}>
        <div style={{ ...sectionTitle, color: C.green, margin: '0 0 10px' }}>Close the sale 🎉</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Service sold (e.g. RCM)" style={field} />
          <input type="number" value={contractValue} onChange={(e) => setContractValue(e.target.value)} placeholder="Contract value" style={field} />
          <input type="number" value={mrr} onChange={(e) => setMrr(e.target.value)} placeholder="MRR" style={field} />
          <input value={saleNote} onChange={(e) => setSaleNote(e.target.value)} placeholder="Note (optional)" style={field} />
        </div>
        <button onClick={doSale}
          style={{ marginTop: 10, width: '100%', background: C.green, color: '#fff', border: 'none', borderRadius: 8, padding: '10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Mark as SOLD
        </button>
        {saleMsg && <p style={{ fontSize: 12, color: C.dim, marginTop: 8 }}>{saleMsg}</p>}
      </div>
    </div>
  )
}