'use client'

// ← ADDED (new file) — Email worksheet on the practice page of an Email lead.
// The agent records the email address used and the response. Every save is
// kept as history (shown below the form) and the lead then appears on the
// Email Sheet Report page.

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { saveEmailWorksheet } from '../../email-worksheet-actions'
import { EMAIL_RESPONSES, EMAIL_REQUIRED_FOR, EMAIL_RE, emailResponseBadge } from '../../../lib/email-leads'

export type EmailWorksheetInitial = {
  email: string | null
  response: string | null
  note: string | null
  updatedAt: string | null
  updatedBy: string | null
}
export type EmailHistoryItem = { at: string; by: string | null; email: string | null; response: string; note: string | null }

export default function EmailWorksheet({ practiceId, initial, history, canSave, lockedMessage }: {
  practiceId: string
  initial: EmailWorksheetInitial | null
  history: EmailHistoryItem[]
  canSave: boolean
  lockedMessage?: string | null
}) {
  const router = useRouter()
  const [email, setEmail] = useState(initial?.email ?? '')
  const [response, setResponse] = useState(initial?.response ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const emailRequired = (EMAIL_REQUIRED_FOR as readonly string[]).includes(response)
  const emailInvalid = email.trim() !== '' && !EMAIL_RE.test(email.trim())
  const canSubmit = canSave && !saving && response !== '' && !emailInvalid && !(emailRequired && !email.trim())

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await saveEmailWorksheet({ practiceId, email, response, note })
      setMsg({ ok: res.ok, text: res.message })
      if (res.ok) { setNote(''); router.refresh() }
    } catch {
      setMsg({ ok: false, text: 'Save failed — check your connection and try again.' })
    } finally {
      setSaving(false)
    }
  }

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

  return (
    // ← CHANGED: stacked (form, then history) — it now sits in the right
    // column next to the practice profile.
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
      <div className="lead-card">
        <h4>Email Worksheet</h4>
        <div style={{ display: 'grid', gap: 14 }}>
          <label className="filter-control"><span>Email address{emailRequired ? ' *' : ''}</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="name@practice.com" disabled={!canSave} aria-invalid={emailInvalid || undefined} maxLength={254} />
          </label>
          {emailInvalid && <p style={{ margin: '-8px 0 0', fontSize: 12, color: 'var(--danger)' }}>Enter a valid email address.</p>}
          <label className="filter-control"><span>Response *</span>
            <select className="input" value={response} onChange={(e) => setResponse(e.target.value)} disabled={!canSave}>
              <option value="">— Choose a response —</option>
              {EMAIL_RESPONSES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          {emailRequired && !email.trim() && <p style={{ margin: '-8px 0 0', fontSize: 12, color: 'var(--muted)' }}>An email address is required for “{response}”.</p>}
          <label className="filter-control"><span>Note (optional)</span>
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={!canSave} maxLength={5000}
              placeholder="Anything worth remembering about this email" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
          </label>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!canSubmit}
            style={{ justifyContent: 'center', padding: '11px 16px', fontWeight: 700 }}>
            {saving ? 'Saving…' : 'Save Email Worksheet'}
          </button>
          {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, fontSize: 12.5, color: msg.ok ? 'var(--ok)' : 'var(--danger)' }}>{msg.text}</p>}
          {!canSave && lockedMessage && <p className="subtle" style={{ margin: 0, fontSize: 12 }}>{lockedMessage}</p>}
          {initial?.updatedAt && (
            <p className="subtle" style={{ margin: 0, fontSize: 12 }}>
              Last saved {initial.updatedBy ? `by ${initial.updatedBy} · ` : ''}{fmt(initial.updatedAt)}
              {initial.response && <> · <span className={emailResponseBadge(initial.response)}>{initial.response}</span></>}
            </p>
          )}
        </div>
      </div>

      <div className="lead-card">
        <h4>Email History</h4>
        {history.length === 0 ? <p className="lead-activity-empty">No email work saved yet.</p> : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
            {history.map((h, i) => (
              <li key={i} style={{ borderLeft: '3px solid var(--border, #d6dde3)', paddingLeft: 10, fontSize: 13 }}>
                <div><strong>{fmt(h.at)}</strong>{h.by ? ` · ${h.by}` : ''} · <span className={emailResponseBadge(h.response)}>{h.response}</span></div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{h.email || 'No email address'}</div>
                {h.note && <div style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>{h.note}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
