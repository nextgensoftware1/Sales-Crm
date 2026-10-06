'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Building2, ClipboardList, Pencil, X } from 'lucide-react'
import { saveWorksheet } from '../worksheet-actions'
import { DISPOSITIONS, TIMEZONES, US_PHONE_RE, US_PHONE_EXT_RE, EMAIL_RE, NAME_RE } from '../Worksheet'
import type { WorksheetReportRow } from '../worksheet-reports-actions'

// Same field rules as the practice-page worksheet (app/Worksheet.tsx).
const phoneOk = (v: string) => !v.trim() || US_PHONE_RE.test(v.trim())
const phoneExtOk = (v: string) => !v.trim() || US_PHONE_EXT_RE.test(v.trim())
const emailOk = (v: string) => !v.trim() || EMAIL_RE.test(v.trim())
const nameOk = (v: string) => !v.trim() || NAME_RE.test(v.trim())

function fmt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** ISO timestamp -> value for <input type="datetime-local"> in the viewer's time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Freeze the page behind the popup. The scrollbar's width is kept as padding so
// the page doesn't jump sideways; everything is restored exactly on close.
// Counted, so two popups at once can't unlock the page too early.
let scrollLocks = 0
let savedStyles: { htmlOverflow: string; bodyOverflow: string; bodyPaddingRight: string } | null = null
function lockPageScroll() {
  if (scrollLocks++ > 0) return
  const html = document.documentElement, body = document.body
  const scrollbar = window.innerWidth - html.clientWidth
  savedStyles = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow, bodyPaddingRight: body.style.paddingRight }
  html.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  if (scrollbar > 0) body.style.paddingRight = `${(parseFloat(getComputedStyle(body).paddingRight) || 0) + scrollbar}px`
}
function unlockPageScroll() {
  if (--scrollLocks > 0 || !savedStyles) return
  const html = document.documentElement, body = document.body
  html.style.overflow = savedStyles.htmlOverflow
  body.style.overflow = savedStyles.bodyOverflow
  body.style.paddingRight = savedStyles.bodyPaddingRight
  savedStyles = null
}
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const initials = (name: string) => name.split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?'

type Form = {
  disposition: string; callbackAt: string; timezone: string; concernedPerson: string
  directLine: string; additionalPhone: string; email: string; callDetails: string
}
const formFrom = (r: WorksheetReportRow): Form => ({
  disposition: r.disposition ?? '', callbackAt: toLocalInput(r.callbackAt), timezone: r.timezone ?? '',
  concernedPerson: r.concernedPerson ?? '', directLine: r.directLine ?? '', additionalPhone: r.additionalPhone ?? '',
  email: r.email ?? '', callDetails: r.callDetails ?? '',
})

/**
 * Popup with a worksheet's full details. "Edit" switches to a form that saves
 * through the same saveWorksheet action as the practice page (permission,
 * transfer-lock and required call details are all checked on the server).
 * `canEdit` is false for another company's worksheet: saving always writes the
 * worksheet for the signed-in user's own company.
 */
export default function WorksheetDetailModal({ row, canEdit, readOnlyReason, onClose }: {
  row: WorksheetReportRow
  canEdit: boolean
  readOnlyReason?: string
  onClose: () => void
}) {
  const router = useRouter()
  const [current, setCurrent] = useState(row)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>(() => formFrom(row))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const dirty = editing && JSON.stringify(form) !== JSON.stringify(formFrom(current))
  const requestClose = () => {
    if (saving) return
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    onClose()
  }

  // While open: freeze the page behind, move focus into the popup, and give
  // focus back to whatever opened it (the eye button) when it closes.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    lockPageScroll()
    setMounted(true)
    return () => { unlockPageScroll(); opener?.focus?.() }
  }, [])
  useEffect(() => { if (mounted) dialogRef.current?.focus() }, [mounted])
  // Escape closes (with the latest unsaved-changes check); Tab stays inside.
  const closeRef = useRef(requestClose)
  useEffect(() => { closeRef.current = requestClose })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) return
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const errors = {
    additionalPhone: phoneOk(form.additionalPhone) ? '' : 'Enter a valid US phone number (e.g. (555) 123-4567).',
    email: emailOk(form.email) ? '' : 'Enter a valid email address.',
    concernedPerson: nameOk(form.concernedPerson) ? '' : 'Letters and spaces only.',
    directLine: phoneExtOk(form.directLine) ? '' : 'Enter a valid US phone number, optionally with an extension (e.g. (555) 123-4567 x12).',
    callDetails: form.callDetails.trim() ? '' : 'Call details are required before saving.',
  }
  const hasErrors = Object.values(errors).some(Boolean)

  const save = async () => {
    if (hasErrors || saving) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await saveWorksheet(current.practiceCode, {
        callDetails: form.callDetails, additionalPhone: form.additionalPhone, email: form.email,
        concernedPerson: form.concernedPerson, directLine: form.directLine,
        callbackAt: form.callbackAt ? new Date(form.callbackAt).toISOString() : '',
        timezone: form.timezone, disposition: form.disposition,
      })
      setMessage({ ok: res.ok, text: res.message })
      if (res.ok) {
        // Show the saved values right away; refresh the report from the server.
        setCurrent((r) => ({
          ...r, disposition: form.disposition || 'New',
          callbackAt: form.callbackAt ? new Date(form.callbackAt).toISOString() : null,
          timezone: form.timezone || null, concernedPerson: form.concernedPerson || null,
          directLine: form.directLine || null, additionalPhone: form.additionalPhone || null,
          email: form.email || null, callDetails: form.callDetails.trim(), lastUpdatedAt: new Date().toISOString(),
        }))
        setEditing(false)
        router.refresh()
      }
    } catch {
      setMessage({ ok: false, text: 'Could not save the worksheet. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const r = current
  const title = r.providerName ?? r.practiceName
  const field = (label: string, value: React.ReactNode, wide = false) => (
    <div className={'wsm-field' + (wide ? ' wsm-wide' : '')}><span>{label}</span><div>{value || '—'}</div></div>
  )
  const input = (label: string, key: keyof Form, props: Record<string, unknown> = {}, wide = false) => (
    <label className={'wsm-field' + (wide ? ' wsm-wide' : '')}>
      <span>{label}</span>
      {key === 'callDetails'
        ? <textarea className="input" rows={5} value={form[key]} onChange={set(key)} aria-invalid={!!errors.callDetails} />
        : <input className="input" value={form[key]} onChange={set(key)} aria-invalid={!!(errors as Record<string, string>)[key]} {...props} />}
      {(errors as Record<string, string>)[key] && <small className="wsm-error">{(errors as Record<string, string>)[key]}</small>}
    </label>
  )

  if (!mounted) return null
  return createPortal(
    <div className="wsm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose() }}>
      <div className={'wsm-dialog' + (editing ? ' is-editing' : '')} role="dialog" aria-modal="true" aria-labelledby="wsm-title" tabIndex={-1} ref={dialogRef}>
        <header className="wsm-head">
          <div className="wsm-avatar" aria-hidden="true">{initials(title)}</div>
          <div className="wsm-head-text">
            <span className="wsm-kicker">{editing ? 'Edit worksheet' : 'Worksheet details'}</span>
            <h2 id="wsm-title">{title}</h2>
            <div className="wsm-chips">
              <span className="wsm-chip mono">{r.practiceCode}</span>
              {r.companyName && <span className="wsm-chip">{r.companyName}</span>}
              {r.disposition && <span className="badge badge-blue">{r.disposition}</span>}
            </div>
          </div>
          <button type="button" className="wsm-icon-btn" onClick={requestClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="wsm-body">
          {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'wsm-ok' : 'wsm-error-box'}>{message.text}</p>}

          <section className="wsm-section">
            <h3><Building2 size={14} aria-hidden="true" /> Lead</h3>
            <div className="wsm-grid">
              {field('Practice', r.practiceName)}
              {field('State', r.state)}
              {field('Specialty', r.specialty)}
              {field('Company', r.companyName)}
              {field('Filled by', r.filledBy)}
              {field('Closer', r.assignedCloser)}
            </div>
          </section>

          <section className="wsm-section">
            <h3><ClipboardList size={14} aria-hidden="true" /> Worksheet</h3>
            {!editing ? (
              <div className="wsm-grid">
                {field('Disposition', r.disposition ? <span className="badge badge-blue">{r.disposition}</span> : null)}
                {field('Callback', r.callbackAt ? `${fmt(r.callbackAt)}${r.timezone ? ` · ${r.timezone}` : ''}` : null)}
                {field('Concerned person', r.concernedPerson)}
                {field('Direct line', r.directLine)}
                {field('Additional phone', r.additionalPhone)}
                {field('Email', r.email)}
                {field('Call details', r.callDetails ? <p className="wsm-notes">{r.callDetails}</p> : null, true)}
              </div>
            ) : (
              <div className="wsm-grid">
                <label className="wsm-field"><span>Disposition</span>
                  <select className="input" value={form.disposition} onChange={set('disposition')}>
                    <option value="">— Select —</option>
                    {/* Keep an older/imported value selectable even if it isn't in today's list. */}
                    {form.disposition && !DISPOSITIONS.includes(form.disposition) && <option value={form.disposition}>{form.disposition}</option>}
                    {DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <label className="wsm-field"><span>Time zone</span>
                  <select className="input" value={form.timezone} onChange={set('timezone')}>
                    <option value="">— Select —</option>
                    {form.timezone && !TIMEZONES.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
                    {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                {input('Callback', 'callbackAt', { type: 'datetime-local' })}
                {input('Concerned person', 'concernedPerson', { placeholder: 'Name' })}
                {input('Direct line', 'directLine', { placeholder: 'Direct Phone / Extension' })}
                {input('Additional phone', 'additionalPhone', { placeholder: '(555) 123-4567' })}
                {input('Email', 'email', { type: 'email', placeholder: 'name@practice.com' }, true)}
                {input('Call details *', 'callDetails', {}, true)}
              </div>
            )}
          </section>
          {!canEdit && readOnlyReason && <p className="wsm-note">{readOnlyReason}</p>}
        </div>

        <footer className="wsm-foot">
          <span className="wsm-foot-meta">Last updated {fmt(r.lastUpdatedAt)}{r.lastUpdatedBy ? ` · by ${r.lastUpdatedBy}` : ''}</span>
          <div className="wsm-foot-actions">
            {!editing ? (
              <>
                <button type="button" className="btn" onClick={requestClose}>Close</button>
                {canEdit && <button type="button" className="btn btn-primary" onClick={() => { setForm(formFrom(current)); setMessage(null); setEditing(true) }}>
                  <Pencil size={14} style={{ marginRight: 6, verticalAlign: '-2px' }} />Edit
                </button>}
              </>
            ) : (
              <>
                <button type="button" className="btn" disabled={saving} onClick={() => { setEditing(false); setForm(formFrom(current)); setMessage(null) }}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={saving || hasErrors || !dirty} onClick={save}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
