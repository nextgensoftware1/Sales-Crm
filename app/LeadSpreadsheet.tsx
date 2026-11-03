'use client'

// ← ADDED (new file) — Leads Engine spreadsheet view for Agents and Closers.
//
// Every lead on the current page is one row. The agent types the worksheet
// straight into the row (call details, disposition, callback, contact
// fields) and presses Save (or Ctrl+Enter). Saving uses the SAME server
// actions as the practice page — saveWorksheet for call leads and
// saveEmailWorksheet for Email leads — so permissions, reminders, claims,
// Active Call and Active Email all work exactly as before. A saved lead
// leaves the queue straight away (the existing rule), and the next lead
// moves up into the page.
//
// Unsaved rows are kept in memory while paging or switching views, so typing
// is never lost by moving around; the browser warns before closing the tab.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import styles from './LeadSpreadsheet.module.css'
import { saveWorksheet } from './worksheet-actions'
import { saveEmailWorksheet } from './email-worksheet-actions'
import { getSheetDetails, forgetSavedLeads, type SheetDetail } from './sheet-actions'
import { US_PHONE_RE, US_PHONE_EXT_RE, EMAIL_RE, NAME_RE } from './Worksheet'
import { bellHasReminderFor } from '../lib/reminder-bell-cache' // ← CHANGED: standalone helper (works with the old or new bell)
import { DISPOSITIONS } from '../lib/dispositions'
import { EMAIL_RESPONSES, EMAIL_REQUIRED_FOR, EMAIL_RE as EMAIL_LEAD_RE } from '../lib/email-leads'
import { US_ZONES, normalizeZone, zoneForState, utcToZonedWallTime, zonedWallTimeToUtcIso, formatInZone } from '../lib/us-time'
import { npiLabel } from '../lib/npi-label'
import type { LeadOverview } from '../lib/lead-filters'

export type SheetLead = { practiceCode: string; name: string; state?: string | null; specialty?: string | null; isEmailLead?: boolean }

type Draft = {
  callDetails: string; disposition: string; callbackAt: string; timezone: string
  concernedPerson: string; directLine: string; additionalPhone: string; email: string
  response: string; note: string
}
type RowState = { saving?: boolean; message?: string }

// ---- kept for the browser session, per signed-in user ----
const DETAIL_TTL_MS = 10 * 60 * 1000
const sessionStore = new Map<string, {
  drafts: Map<string, Draft>; baselines: Map<string, string>; details: Map<string, { at: number; detail: SheetDetail | null }>
}>()
function storeFor(userId: string) {
  let s = sessionStore.get(userId)
  if (!s) { s = { drafts: new Map(), baselines: new Map(), details: new Map() }; sessionStore.set(userId, s) }
  return s
}

function initialDraft(lead: SheetLead, d: SheetDetail): Draft {
  const zone = normalizeZone(d.worksheet?.timezone) ?? zoneForState(lead.state)
  return {
    callDetails: d.worksheet?.callDetails ?? '',
    disposition: d.worksheet?.disposition || 'New',
    callbackAt: utcToZonedWallTime(d.worksheet?.callbackAt ?? null, zone),
    timezone: zone,
    concernedPerson: d.worksheet?.concernedPerson ?? '',
    directLine: d.worksheet?.directLine ?? '',
    additionalPhone: d.worksheet?.additionalPhone ?? '',
    email: d.isEmailLead ? (d.emailWorksheet?.email ?? '') : (d.worksheet?.email ?? ''),
    response: d.emailWorksheet?.response ?? '',
    note: d.emailWorksheet?.note ?? '',
  }
}

// Same rules as the practice-page worksheets.
function rowErrors(draft: Draft, isEmail: boolean): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {}
  const v = (s: string) => s.trim()
  if (isEmail) {
    if (!draft.response) e.response = 'Choose a response.'
    if (!v(draft.email) && (EMAIL_REQUIRED_FOR as readonly string[]).includes(draft.response)) e.email = `Email needed for "${draft.response}".`
    if (v(draft.email) && !EMAIL_LEAD_RE.test(v(draft.email))) e.email = 'Enter a valid email.'
    return e
  }
  if (!v(draft.callDetails)) e.callDetails = 'Call details are required.'
  if (v(draft.additionalPhone) && !US_PHONE_RE.test(v(draft.additionalPhone))) e.additionalPhone = 'Enter a valid US phone.'
  if (v(draft.directLine) && !US_PHONE_EXT_RE.test(v(draft.directLine))) e.directLine = 'Enter a valid US phone / ext.'
  if (v(draft.email) && !EMAIL_RE.test(v(draft.email))) e.email = 'Enter a valid email.'
  if (v(draft.concernedPerson) && !NAME_RE.test(v(draft.concernedPerson))) e.concernedPerson = 'Letters, spaces and . , \' - only.'
  if (draft.callbackAt && !zonedWallTimeToUtcIso(draft.callbackAt, draft.timezone)) e.callbackAt = 'Choose a valid date and time.'
  return e
}

const zoneShort = (value: string, label: string) => (value === 'Arizona' ? 'MST-AZ' : label)

export default function LeadSpreadsheet({ rows, viewerUserId, onSaved }: {
  rows: SheetLead[]
  viewerUserId: string
  /** A lead was saved: hide it, and (if given) show the new counts. */
  onSaved: (practiceCode: string, overview: LeadOverview | null) => void
}) {
  const store = storeFor(viewerUserId || 'anonymous')
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(store.drafts))
  const [details, setDetails] = useState<Record<string, SheetDetail | null>>(() => {
    const now = Date.now()
    return Object.fromEntries([...store.details].filter(([, v]) => now - v.at < DETAIL_TTL_MS).map(([k, v]) => [k, v.detail]))
  })
  const [rowState, setRowState] = useState<Record<string, RowState>>({})
  const [tried, setTried] = useState<Set<string>>(new Set()) // rows where Save was pressed (show "required")
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  // Clock for the "this time has passed" hint (no reading the clock while drawing).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60 * 1000)
    return () => window.clearInterval(t)
  }, [])

  const codesKey = rows.map((r) => r.practiceCode).join('|')

  // Load the page's extra details (phone, existing worksheet, lock) — only
  // for leads not already loaded in the last 10 minutes.
  useEffect(() => {
    const now = Date.now()
    const missing = rows.map((r) => r.practiceCode).filter((code) => {
      const cached = store.details.get(code)
      return !cached || now - cached.at >= DETAIL_TTL_MS
    })
    if (!missing.length) return
    let cancelled = false
    getSheetDetails(missing).then((res) => {
      if (cancelled) return
      if (!res.ok) { setLoadError(res.message ?? 'Could not load lead details.'); return }
      setLoadError('')
      const found = new Map((res.details ?? []).map((d) => [d.practiceCode, d]))
      const at = Date.now()
      const next: Record<string, SheetDetail | null> = {}
      for (const code of missing) {
        const d = found.get(code) ?? null
        store.details.set(code, { at, detail: d })
        next[code] = d
      }
      setDetails((prev) => ({ ...prev, ...next }))
      // Start each new row from the company's existing worksheet (if any),
      // unless the agent already typed something for it.
      setDrafts((prev) => {
        const out = { ...prev }
        for (const lead of rows) {
          const d = next[lead.practiceCode]
          if (!d || out[lead.practiceCode]) continue
          const draft = initialDraft(lead, d)
          out[lead.practiceCode] = draft
          store.drafts.set(lead.practiceCode, draft)
          store.baselines.set(lead.practiceCode, JSON.stringify(draft))
        }
        return out
      })
    }).catch(() => { if (!cancelled) setLoadError('Could not load lead details. Check your connection and try again.') })
    return () => { cancelled = true }
    // Only a different set of leads on the page needs new details.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey])

  // Rows that were already loaded earlier but have no draft yet.
  const draftFor = useCallback((lead: SheetLead): Draft | null => {
    const existing = drafts[lead.practiceCode]
    if (existing) return existing
    const d = details[lead.practiceCode]
    return d ? initialDraft(lead, d) : null
  }, [drafts, details])

  const isDirty = useCallback((code: string, draft: Draft | null) => {
    if (!draft) return false
    const base = store.baselines.get(code)
    return base !== undefined && base !== JSON.stringify(draft)
  }, [store])

  const setField = (lead: SheetLead, field: keyof Draft, value: string) => {
    const current = draftFor(lead)
    if (!current) return
    if (!store.baselines.has(lead.practiceCode)) store.baselines.set(lead.practiceCode, JSON.stringify(current))
    const next = { ...current, [field]: value }
    store.drafts.set(lead.practiceCode, next)
    setDrafts((prev) => ({ ...prev, [lead.practiceCode]: next }))
  }

  // Warn before closing the tab with unsaved rows.
  const anyDirty = useMemo(() => Object.entries(drafts).some(([code, d]) => isDirty(code, d)), [drafts, isDirty])
  useEffect(() => {
    if (!anyDirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [anyDirty])

  const saveRow = useCallback(async (lead: SheetLead): Promise<boolean> => {
    const code = lead.practiceCode
    const d = details[code]
    const draft = store.drafts.get(code) ?? (d ? initialDraft(lead, d) : null) // always the latest typing
    if (!d || !draft || d.locked) return false
    const isEmail = d.isEmailLead
    setTried((prev) => new Set(prev).add(code))
    if (Object.keys(rowErrors(draft, isEmail)).length) {
      setRowState((prev) => ({ ...prev, [code]: { message: 'Fix the highlighted cell(s).' } }))
      return false
    }
    setRowState((prev) => ({ ...prev, [code]: { saving: true } }))
    try {
      const res = isEmail
        ? await saveEmailWorksheet({ practiceId: d.practiceId, email: draft.email, response: draft.response, note: draft.note })
        : await saveWorksheet(code, {
            callDetails: draft.callDetails, additionalPhone: draft.additionalPhone, email: draft.email,
            concernedPerson: draft.concernedPerson, directLine: draft.directLine,
            callbackAt: draft.callbackAt, timezone: draft.timezone, disposition: draft.disposition,
          })
      if (!res.ok) {
        setRowState((prev) => ({ ...prev, [code]: { message: res.message } }))
        return false
      }
      // Same as the practice page: the bell reloads once when a reminder
      // was set, or when the database closed one this save completed.
      if (!isEmail && (draft.callbackAt || bellHasReminderFor(code))) window.dispatchEvent(new CustomEvent('reminders:changed'))
      store.drafts.delete(code); store.baselines.delete(code); store.details.delete(code)
      setRowState((prev) => { const next = { ...prev }; delete next[code]; return next })
      setDrafts((prev) => { const next = { ...prev }; delete next[code]; return next })
      const forget = await forgetSavedLeads([code]).catch(() => ({ ok: false, overview: null }))
      onSaved(code, forget.overview)
      setFlash({ ok: true, text: `Saved ${lead.name} — moved to ${isEmail ? 'Active Email' : 'Active Call'}.` })
      return true
    } catch {
      setRowState((prev) => ({ ...prev, [code]: { message: 'Could not save. Check your connection and try again.' } }))
      return false
    }
  }, [details, onSaved, store])

  const pageLeads = rows.filter((lead) => details[lead.practiceCode] !== null)
  const dirtyOnPage = pageLeads.filter((lead) => {
    const d = details[lead.practiceCode]
    return d && !d.locked && isDirty(lead.practiceCode, draftFor(lead))
  })

  const saveAll = async () => {
    if (bulkBusy || !dirtyOnPage.length) return
    setBulkBusy(true); setFlash(null)
    let saved = 0, failed = 0
    for (const lead of dirtyOnPage) {
      // One at a time, in order — each save is a normal worksheet save.
      if (await saveRow(lead)) saved++; else failed++
    }
    setBulkBusy(false)
    setFlash(failed
      ? { ok: false, text: `Saved ${saved} lead${saved === 1 ? '' : 's'}; ${failed} need${failed === 1 ? 's' : ''} fixing (see the red notes).` }
      : { ok: true, text: `Saved ${saved} lead${saved === 1 ? '' : 's'} — moved to Active Call / Active Email.` })
  }

  const onRowKeyDown = (lead: SheetLead) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveRow(lead) }
  }

  if (!rows.length) return <div className={styles.empty}>No leads match these filters. Clear them to see the full pool.</div>

  return (
    <div>
      <div className={styles.toolbar}>
        <span>Type straight into a row, then <strong>Save</strong> (or <span className={styles.kbd}>Ctrl</span>+<span className={styles.kbd}>Enter</span>). Saved leads leave your queue.</span>
        {flash && <span className={flash.ok ? styles.flash : styles.flashError} role="status">{flash.text}</span>}
        {loadError && <span className={styles.flashError} role="alert">{loadError}</span>}
        <span className={styles.toolbarSpacer} />
        <button type="button" className={styles.saveBtn} style={{ width: 'auto', padding: '8px 14px' }}
          disabled={bulkBusy || !dirtyOnPage.length} onClick={saveAll}>
          {bulkBusy ? 'Saving…' : `Save all changed (${dirtyOnPage.length})`}
        </button>
      </div>
      <div className={styles.scroller}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={`${styles.stickyLeft} ${styles.practice}`}>Practice</th>
              <th>Phone</th>
              <th>Call details * / Note</th>
              <th>Disposition / Response</th>
              <th>Callback (practice time)</th>
              <th>Concerned person</th>
              <th>Direct line</th>
              <th>Additional phone</th>
              <th>Email</th>
              <th className={styles.stickyRight}>Save</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((lead) => {
              const code = lead.practiceCode
              const d = details[code]
              const loading = d === undefined
              const draft = draftFor(lead)
              const isEmail = d?.isEmailLead ?? !!lead.isEmailLead
              const locked = !!d?.locked
              const disabled = loading || !d || locked || !!rowState[code]?.saving || bulkBusy
              const dirty = isDirty(code, draft)
              const errors = draft ? rowErrors(draft, isEmail) : {}
              // Show an error once the cell has a value, or after Save was pressed.
              const showErr = (f: keyof Draft) => errors[f] && (tried.has(code) || (draft?.[f] ?? '').trim() !== '') ? errors[f] : ''
              const cls = (f: keyof Draft, w: string) => `${styles.cell} ${w} ${showErr(f) ? styles.cellInvalid : ''}`
              const callbackIso = draft?.callbackAt ? zonedWallTimeToUtcIso(draft.callbackAt, draft.timezone) : null
              const msg = rowState[code]?.message
              return (
                <tr key={code} className={`${dirty ? styles.dirty : ''} ${locked ? styles.lockedRow : ''}`} onKeyDown={onRowKeyDown(lead)}>
                  <td className={`${styles.stickyLeft} ${styles.practice}`}>
                    <Link prefetch={false} href={`/practice/${code}`} className={styles.practiceName}>{lead.name}</Link>
                    <div className={styles.practiceMeta}>
                      {npiLabel(code)} · {lead.state ?? '—'}
                      {isEmail && <span className={styles.emailTag}>EMAIL</span>}
                      {dirty && <span className={styles.unsaved} title="Unsaved changes">● unsaved</span>}
                    </div>
                    {lead.specialty && <div className={styles.practiceMeta} style={{ fontFamily: 'inherit' }}>{lead.specialty}</div>}
                    {locked && <div className={styles.fieldError}>Transferred — only the receiving closer can edit.</div>}
                    {!loading && !d && <div className={styles.fieldError}>This lead is no longer available.</div>}
                  </td>
                  <td className={styles.wPhone}>
                    {loading ? <span className={styles.na}>…</span>
                      : d?.phone ? <a className={styles.phone} href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}>{d.phone}</a>
                      : <span className={styles.na}>—</span>}
                  </td>
                  {/* Call details (call lead) or Note (Email lead) */}
                  <td className={styles.wDetails}>
                    {isEmail ? (
                      <textarea aria-label={`Note for ${lead.name}`} className={cls('note', styles.wDetails)} rows={2} maxLength={5000}
                        placeholder="Note" disabled={disabled} value={draft?.note ?? ''} onChange={(e) => setField(lead, 'note', e.target.value)} />
                    ) : (<>
                      <textarea aria-label={`Call details for ${lead.name}`} className={cls('callDetails', styles.wDetails)} rows={2}
                        placeholder={loading ? 'Loading…' : 'What happened on the call?'} disabled={disabled}
                        value={draft?.callDetails ?? ''} onChange={(e) => setField(lead, 'callDetails', e.target.value)} />
                      {showErr('callDetails') && <div className={styles.fieldError}>{showErr('callDetails')}</div>}
                    </>)}
                  </td>
                  {/* Disposition (call lead) or Response (Email lead) */}
                  <td className={styles.wDispo}>
                    {isEmail ? (<>
                      <select aria-label={`Response for ${lead.name}`} className={cls('response', styles.wDispo)} disabled={disabled}
                        value={draft?.response ?? ''} onChange={(e) => setField(lead, 'response', e.target.value)}>
                        <option value="">— Response —</option>
                        {EMAIL_RESPONSES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      {showErr('response') && <div className={styles.fieldError}>{showErr('response')}</div>}
                    </>) : (
                      <select aria-label={`Disposition for ${lead.name}`} className={cls('disposition', styles.wDispo)} disabled={disabled}
                        value={draft?.disposition ?? 'New'} onChange={(e) => setField(lead, 'disposition', e.target.value)}>
                        {DISPOSITIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    )}
                  </td>
                  {/* Callback — practice clock in the chosen zone (call leads only) */}
                  <td className={styles.wCallback}>
                    {isEmail ? <span className={styles.na}>—</span> : (<>
                      <div className={styles.callbackRow}>
                        <input type="datetime-local" aria-label={`Callback for ${lead.name}`} className={cls('callbackAt', '')} disabled={disabled}
                          value={draft?.callbackAt ?? ''} onChange={(e) => setField(lead, 'callbackAt', e.target.value)} />
                        <select aria-label={`Callback time zone for ${lead.name}`} className={`${styles.cell} ${styles.zone}`} disabled={disabled}
                          value={draft?.timezone ?? 'Eastern'} onChange={(e) => setField(lead, 'timezone', e.target.value)}>
                          {US_ZONES.map((z) => <option key={z.value} value={z.value} title={z.name}>{zoneShort(z.value, z.label)}</option>)}
                        </select>
                      </div>
                      {callbackIso && (
                        <div className={`${styles.hint} ${new Date(callbackIso).getTime() < nowMs ? styles.hintPast : ''}`}>
                          {formatInZone(callbackIso, draft?.timezone)} = {new Date(callbackIso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} your time
                        </div>
                      )}
                    </>)}
                  </td>
                  <td className={styles.wText}>
                    {isEmail ? <span className={styles.na}>—</span> : (<>
                      <input aria-label={`Concerned person for ${lead.name}`} className={cls('concernedPerson', styles.wText)} placeholder="e.g. Practice Administrator"
                        disabled={disabled} value={draft?.concernedPerson ?? ''} onChange={(e) => setField(lead, 'concernedPerson', e.target.value)} />
                      {showErr('concernedPerson') && <div className={styles.fieldError}>{showErr('concernedPerson')}</div>}
                    </>)}
                  </td>
                  <td className={styles.wText}>
                    {isEmail ? <span className={styles.na}>—</span> : (<>
                      <input type="tel" aria-label={`Direct line for ${lead.name}`} className={cls('directLine', styles.wText)} placeholder="Phone / ext."
                        disabled={disabled} value={draft?.directLine ?? ''} onChange={(e) => setField(lead, 'directLine', e.target.value)} />
                      {showErr('directLine') && <div className={styles.fieldError}>{showErr('directLine')}</div>}
                    </>)}
                  </td>
                  <td className={styles.wText}>
                    {isEmail ? <span className={styles.na}>—</span> : (<>
                      <input type="tel" aria-label={`Additional phone for ${lead.name}`} className={cls('additionalPhone', styles.wText)} placeholder="Secondary / mobile"
                        disabled={disabled} value={draft?.additionalPhone ?? ''} onChange={(e) => setField(lead, 'additionalPhone', e.target.value)} />
                      {showErr('additionalPhone') && <div className={styles.fieldError}>{showErr('additionalPhone')}</div>}
                    </>)}
                  </td>
                  <td className={styles.wEmail}>
                    <input type="email" aria-label={`Email for ${lead.name}`} className={cls('email', styles.wEmail)} placeholder="billing@practice.com"
                      disabled={disabled} value={draft?.email ?? ''} onChange={(e) => setField(lead, 'email', e.target.value)} />
                    {showErr('email') && <div className={styles.fieldError}>{showErr('email')}</div>}
                  </td>
                  <td className={`${styles.stickyRight} ${styles.wAction}`}>
                    <button type="button" className={styles.saveBtn} disabled={disabled} onClick={() => void saveRow(lead)}>
                      {rowState[code]?.saving ? 'Saving…' : 'Save'}
                    </button>
                    {msg && <div className={styles.rowMsg} role="alert">{msg}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
