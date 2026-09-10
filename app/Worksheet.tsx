'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { saveWorksheet, type WorksheetData } from './worksheet-actions'
import { logActivity, setReminder, getClosers, transferToCloser, markAsSold } from './actions'

const DISPOSITIONS = ['New', 'No Answer', 'Call back', 'Front Desk', 'Not Interested', 'Transfer', 'Voicemail', 'Interested', 'Not Eligible', 'Hung up', 'DNC', 'Offc Perm Closed', 'Follow up', 'Proposal', 'Contract', 'Sold']
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
    if (!callDetails.trim()) { setMsg('Call details are required before saving.'); return }
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

  return (
    <div className="lead-card">
      <h4>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
        </svg>
        Worksheet
      </h4>

      <label className="lead-field-label" style={{ display: 'block', marginBottom: 6 }}>
        Call Details <span style={{ color: 'var(--danger)' }}>*</span>
      </label>
      <textarea
        value={callDetails} onChange={(e) => setCallDetails(e.target.value)}
        placeholder="Type call details, gating factors, next steps…"
        rows={3}
        className="lead-textarea"
        style={{ marginBottom: 16, borderColor: !callDetails.trim() && msg ? 'var(--danger)' : undefined }}
      />

      <div className="grid-fields-2" style={{ marginBottom: 16 }}>
        <div><label className="lead-field-label">Additional Phone</label>
          <input value={additionalPhone} onChange={(e) => setAdditionalPhone(e.target.value)} placeholder="Secondary / Mobile Phone" className="lead-input" /></div>
        <div><label className="lead-field-label">Email Address</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@practice.com" className="lead-input" /></div>
        <div><label className="lead-field-label">Concerned Person</label>
          <input value={concernedPerson} onChange={(e) => setConcernedPerson(e.target.value)} placeholder="e.g. Practice Administrator" className="lead-input" /></div>
        <div><label className="lead-field-label">Direct Line</label>
          <input value={directLine} onChange={(e) => setDirectLine(e.target.value)} placeholder="Direct Phone / Extension" className="lead-input" /></div>
      </div>

      <label className="lead-field-label">Follow-up / Callback</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className="lead-input" style={{ flex: 1, minWidth: 190 }} />
        <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="lead-select" style={{ width: 120 }}>
          {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {[['Today +1h', 60], ['Tomorrow 9:00', 60 * 24], ['Tomorrow 11:00', 60 * 26], ['Tomorrow 14:00', 60 * 29], ['Next Monday 10:00', 60 * 24 * 3]].map(([label, mins]) => (
          <button key={label as string} type="button" onClick={() => setQuick(mins as number)} className="lead-quickbtn">
            {label}
          </button>
        ))}
      </div>
      {!callbackAt && <p style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic', margin: '0 0 16px' }}>No callback scheduled — pick a date to create a reminder.</p>}

      <div className="grid-fields-2" style={{ marginBottom: 16 }}>
        <div>
          <label className="lead-field-label">Call Disposition</label>
          <select value={disposition} onChange={(e) => setDisposition(e.target.value)} className="lead-select">
            {DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <button onClick={save} disabled={saving} className="lead-save-btn">
        {saving ? 'Saving…' : 'Save Worksheet Details'}
      </button>
      {msg && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>{msg}</p>}
      {initial?.updatedByName && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          Last updated by {initial.updatedByName}{initial.updatedAt ? ` · ${new Date(initial.updatedAt).toLocaleString()}` : ''}
        </p>
      )}

      {/* Transfer to Closer */}
      <div className="lead-divider" style={{ marginTop: 18 }}>
        <span className="lead-subhead" style={{ fontSize: 11, borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 12, display: 'block' }}>Qualified Lead Transfer</span>
        <div className="grid-fields-2">
          <select value={closerId} onChange={(e) => setCloserId(e.target.value)} className="lead-select">
            <option value="">-- Choose Closer --</option>
            {closers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
          </select>
          <select value={handoffStatus} onChange={(e) => setHandoffStatus(e.target.value)} className="lead-select">
            <option value="">Handoff status…</option>
            {HANDOFF_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={doTransfer} className="lead-transfer-btn" style={{ marginTop: 10 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={14} height={14}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
          Transfer
        </button>
        {transferMsg && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{transferMsg}</p>}
      </div>

      {/* Close the sale */}
      <div className="lead-divider" style={{ marginTop: 18, borderTop: '2px solid var(--ok)' }}>
        <span className="lead-subhead" style={{ fontSize: 11, color: 'var(--ok)', marginBottom: 10, display: 'block' }}>Close the sale</span>
        <div className="grid-fields-2">
          <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Service sold (e.g. RCM)" className="lead-input" />
          <input type="number" value={contractValue} onChange={(e) => setContractValue(e.target.value)} placeholder="Contract value" className="lead-input" />
          <input type="number" value={mrr} onChange={(e) => setMrr(e.target.value)} placeholder="MRR" className="lead-input" />
          <input value={saleNote} onChange={(e) => setSaleNote(e.target.value)} placeholder="Note (optional)" className="lead-input" />
        </div>
        <button onClick={doSale} className="lead-sold-btn" style={{ marginTop: 10 }}>
          Mark as SOLD
        </button>
        {saleMsg && <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{saleMsg}</p>}
      </div>
    </div>
  )
}
