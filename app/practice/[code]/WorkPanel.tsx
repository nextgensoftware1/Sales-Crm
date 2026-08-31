'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { logActivity, setReminder, getClosers, transferToCloser, markAsSold } from '../../actions'

const DISPOSITIONS = [
  'No Answer', 'Voicemail', 'Interested', 'Not Interested',
  'Callback', 'Qualified', 'DNC',
]

export default function WorkPanel({ practiceCode }: { practiceCode: string }) {
  const router = useRouter()

  // Disposition + note
  const [disposition, setDisposition] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  // Reminder
  const [remindAt, setRemindAt] = useState('')
  const [remindNote, setRemindNote] = useState('')
  const [remindMsg, setRemindMsg] = useState('')

  // Transfer
  const [closers, setClosers] = useState<{ id: string; name: string; email: string }[]>([])
  const [closerId, setCloserId] = useState('')
  const [transferNote, setTransferNote] = useState('')
  const [transferMsg, setTransferMsg] = useState('')

  // Sale
  const [service, setService] = useState('')
  const [contractValue, setContractValue] = useState('')
  const [mrr, setMrr] = useState('')
  const [saleNote, setSaleNote] = useState('')
  const [saleMsg, setSaleMsg] = useState('')

  useEffect(() => {
    getClosers().then(setClosers)
  }, [])

  const save = async () => {
    if (!disposition && !note.trim()) { setMsg('Pick a disposition or write a note.'); return }
    setSaving(true)
    const res = await logActivity(practiceCode, disposition, note.trim())
    setSaving(false)
    setMsg(res.message)
    if (res.ok) {
      setNote('')
      setDisposition('')
      router.refresh()
    }
  }

  const saveReminder = async () => {
    if (!remindAt) { setRemindMsg('Pick a date/time for the reminder.'); return }
    const res = await setReminder(practiceCode, new Date(remindAt).toISOString(), remindNote.trim())
    setRemindMsg(res.message)
    if (res.ok) {
      setRemindAt('')
      setRemindNote('')
      router.refresh()
    }
  }

  const doTransfer = async () => {
    if (!closerId) { setTransferMsg('Pick a closer.'); return }
    const res = await transferToCloser(practiceCode, closerId, transferNote.trim())
    setTransferMsg(res.message)
    if (res.ok) {
      setTransferNote('')
      setCloserId('')
      router.refresh()
    }
  }

  const doSale = async () => {
    if (!service.trim()) { setSaleMsg('Enter the service sold.'); return }
    const res = await markAsSold(practiceCode, service.trim(), contractValue, mrr, saleNote.trim())
    setSaleMsg(res.message)
    if (res.ok) {
      setService(''); setContractValue(''); setMrr(''); setSaleNote('')
      router.refresh()
    }
  }

  const box = { border: '1px solid #ddd', borderRadius: 8, padding: 20, marginBottom: 20, maxWidth: 700 }

  return (
    <div style={box}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Work this lead</h2>

      {/* Disposition */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>Disposition (call outcome)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {DISPOSITIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDisposition(d)}
              style={{
                padding: '6px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                background: disposition === d ? '#2563eb' : '#f2f2f2',
                color: disposition === d ? '#fff' : '#333',
                border: '1px solid ' + (disposition === d ? '#2563eb' : '#ddd'),
              }}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Note */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>Note</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What was discussed…"
          style={{ width: '100%', minHeight: 70, padding: 10, border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box', color: '#000' }}
        />
      </div>

      <button
        onClick={save}
        disabled={saving}
        style={{ padding: '10px 18px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 14, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
      >
        {saving ? 'Saving…' : 'Log activity'}
      </button>
      {msg && <span style={{ marginLeft: 12, fontSize: 13, color: '#000' }}>{msg}</span>}

      {/* Reminder / follow-up */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee' }}>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>Set a follow-up / callback</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="datetime-local"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, color: '#000' }}
          />
          <input
            type="text"
            value={remindNote}
            onChange={(e) => setRemindNote(e.target.value)}
            placeholder="Reminder note (optional)"
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, minWidth: 220, color: '#000' }}
          />
          <button
            onClick={saveReminder}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#d97706', color: '#fff', fontSize: 14, cursor: 'pointer' }}
          >
            Set reminder
          </button>
          {remindMsg && <span style={{ fontSize: 13, color: '#000' }}>{remindMsg}</span>}
        </div>
      </div>

      {/* Transfer to Closer */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #eee' }}>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>Transfer to Closer (for qualified leads)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={closerId}
            onChange={(e) => setCloserId(e.target.value)}
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, color: '#000' }}
          >
            <option value="">Choose closer…</option>
            {closers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
          </select>
          <input
            type="text"
            value={transferNote}
            onChange={(e) => setTransferNote(e.target.value)}
            placeholder="Handoff note (optional)"
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, minWidth: 220, color: '#000' }}
          />
          <button
            onClick={doTransfer}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', fontSize: 14, cursor: 'pointer' }}
          >
            Transfer to Closer
          </button>
          {transferMsg && <span style={{ fontSize: 13, color: '#000' }}>{transferMsg}</span>}
        </div>
      </div>

      {/* Close the sale  ← ADDED: this whole section was missing */}
      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '2px solid #16a34a' }}>
        <div style={{ fontSize: 14, color: '#16a34a', fontWeight: 600, marginBottom: 8 }}>Close the sale 🎉</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="text" value={service} onChange={(e) => setService(e.target.value)}
            placeholder="Service sold (e.g. RCM)"
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, color: '#000', minWidth: 150 }} />
          <input type="number" value={contractValue} onChange={(e) => setContractValue(e.target.value)}
            placeholder="Contract value"
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, color: '#000', width: 130 }} />
          <input type="number" value={mrr} onChange={(e) => setMrr(e.target.value)}
            placeholder="MRR"
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, color: '#000', width: 100 }} />
          <input type="text" value={saleNote} onChange={(e) => setSaleNote(e.target.value)}
            placeholder="Note (optional)"
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14, color: '#000', minWidth: 160 }} />
          <button onClick={doSale}
            style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#16a34a', color: '#fff', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}>
            Mark as SOLD
          </button>
          {saleMsg && <span style={{ fontSize: 13, color: '#000' }}>{saleMsg}</span>}
        </div>
      </div>
    </div>
  )
}