'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getBellReminders, type Reminder } from './reminders-actions' // ← CHANGED: once-a-day, windowed list
import { classifyReminderAttention, getReminderNotificationSlot } from '../lib/reminder-utils'
import { leadHref } from '../lib/lead-return'

// ← CHANGED (free-plan egress saver): the bell now asks the database ONCE A
// DAY instead of every 5 minutes. The list (reminders due from 24h ago to 24h
// ahead) is kept in this browser's localStorage, so page changes and reloads
// reuse it. It reloads early only when a reminder is saved or marked done
// (the 'reminders:changed' event). Countdown pop-ups run off the browser
// clock and need no database calls. The saved copy is cleared on sign-in and
// sign-out (see lib/reset-saved-filters.ts).
const STORAGE_KEY = 'hbs-reminder-bell'
const DAY_MS = 24 * 60 * 60 * 1000
const RETRY_AFTER_FAIL_MS = 30 * 60 * 1000 // don't hammer the DB if a load fails

type StoredReminders = { savedAt: number; reminders: Reminder[] }

let reminderCache: StoredReminders | null = null
let reminderRequest: Promise<Reminder[] | null> | null = null
let lastFailedAt = 0

function readStored(): StoredReminders | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as StoredReminders
    if (typeof v?.savedAt !== 'number' || !Array.isArray(v.reminders)) return null
    return v
  } catch { return null }
}

function primeReminderCache(reminders: Reminder[]) {
  reminderCache = { savedAt: Date.now(), reminders }
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reminderCache)) } catch { /* storage full/blocked: memory copy still works */ }
}

function isFresh(c: StoredReminders | null) {
  return !!c && Date.now() - c.savedAt < DAY_MS
}

async function getCachedReminders(force = false): Promise<Reminder[] | null> {
  if (!force) {
    if (!reminderCache) reminderCache = readStored()
    if (isFresh(reminderCache)) return reminderCache!.reminders
    if (Date.now() - lastFailedAt < RETRY_AFTER_FAIL_MS) return reminderCache?.reminders ?? null
  }
  if (reminderRequest) return reminderRequest

  const now = Date.now()
  reminderRequest = getBellReminders(new Date(now - DAY_MS).toISOString(), new Date(now + DAY_MS).toISOString())
    .then((res) => {
      if (!res.ok) { lastFailedAt = Date.now(); return reminderCache?.reminders ?? null }
      const reminders = res.reminders ?? []
      primeReminderCache(reminders)
      return reminders
    })
    .catch(() => { lastFailedAt = Date.now(); return reminderCache?.reminders ?? null })
    .finally(() => { reminderRequest = null })

  return reminderRequest
}

function fmtWhen(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function NotificationBell({ initialReminders }: { initialReminders?: Reminder[] }) {
  const [reminders, setReminders] = useState<Reminder[]>(initialReminders ?? [])
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(initialReminders !== undefined)
  const [clock, setClock] = useState(() => Date.now())
  const [toast, setToast] = useState<{ reminder: Reminder; slot: string } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef<Promise<void> | null>(null)

  const load = async (force = false) => {
    if (loadingRef.current) return loadingRef.current
    loadingRef.current = (async () => {
      const nextReminders = await getCachedReminders(force)
      if (nextReminders) setReminders(nextReminders)
      setLoaded(true)
    })().finally(() => { loadingRef.current = null })
    return loadingRef.current
  }

  useEffect(() => {
    if (initialReminders !== undefined) primeReminderCache(initialReminders)
  }, [initialReminders])

  // ← CHANGED: load once (from the saved daily copy when it exists), no
  // 5-minute polling. The 30-second tick only moves the local clock, and
  // fetches again only if the saved copy is over a day old (tab left open).
  useEffect(() => {
    if (initialReminders === undefined) void load()
    const tick = window.setInterval(() => {
      setClock(Date.now())
      if (!isFresh(reminderCache)) void load()
    }, 30 * 1000)
    const refresh = () => { void load(true) }
    window.addEventListener('reminders:changed', refresh)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('reminders:changed', refresh)
    }
    // The loader is stable for this mounted header; interval cleanup happens
    // when the shell unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const now = new Date(clock)
  const { overdue, upcoming, nearDue } = useMemo(() => classifyReminderAttention(reminders, clock), [clock, reminders])
  const preview = [...overdue, ...upcoming].slice(0, 6)
  const badgeCount = overdue.length + nearDue.length

  useEffect(() => {
    const next = nearDue[0]
    if (!next) return
    const slot = getReminderNotificationSlot(next.remindAt, clock)
    if (!slot) return
    const key = `reminder-notified:${next.id}:${next.remindAt}:${slot}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    const show = window.setTimeout(() => setToast({ reminder: next, slot }), 0)
    const close = window.setTimeout(() => setToast(null), 12000)
    return () => { window.clearTimeout(show); window.clearTimeout(close) }
  }, [nearDue, clock])

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="topbar-bell"
        onClick={() => { setOpen((v) => !v); if (!loaded) load() }}
        aria-label={badgeCount > 0 ? `${badgeCount} reminder${badgeCount === 1 ? '' : 's'} due soon or overdue` : 'Reminders'}
        title="Reminders"
        type="button"
      >
        <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {badgeCount > 0 && <span className="topbar-bell-badge">{badgeCount > 9 ? '9+' : badgeCount}</span>}
      </button>

      {open && (
        <div className="topbar-bell-panel">
          <div className="topbar-bell-panel-head">
            Reminders
            <span style={{ display: 'flex', gap: 5 }}>
              {nearDue.length > 0 && <span className="badge badge-amber">{nearDue.length} due soon</span>}
              {overdue.length > 0 && <span className="badge badge-red">{overdue.length} overdue</span>}
            </span>
          </div>
          {preview.length === 0 ? (
            <p className="subtle" style={{ padding: '12px 14px', margin: 0 }}>Nothing scheduled.</p>
          ) : (
            <div>
              {preview.map((r) => {
                const isOverdue = new Date(r.remindAt) < now
                return (
                  <Link prefetch={false} 
                    key={r.id}
                    href={r.practiceDeleted ? '#' : leadHref(r.practiceCode, 'reminders')}
                    className="topbar-bell-row"
                    onClick={(e) => { if (r.practiceDeleted) e.preventDefault(); setOpen(false) }}
                  >
                    <span className={isOverdue ? 'topbar-bell-dot overdue' : 'topbar-bell-dot'} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.practiceName}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>
                        {fmtWhen(r.remindAt)}{r.agentName ? ` · ${r.agentName}` : ''}
                      </span>
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
          <Link prefetch={false} href="/reminders" className="topbar-bell-viewall" onClick={() => setOpen(false)}>
            View all reminders →
          </Link>
        </div>
      )}
      {toast && (
        <div className="reminder-toast" role="status" aria-live="polite">
          <button type="button" className="reminder-toast-close" onClick={() => setToast(null)} aria-label="Dismiss reminder">×</button>
          <strong>{toast.slot === 'due-now' ? 'Reminder due now' : `Reminder due in ${toast.slot.replace('hour-', '')} hour${toast.slot === 'hour-1' ? '' : 's'}`}</strong>
          <span>{toast.reminder.practiceName}</span>
          <small>{fmtWhen(toast.reminder.remindAt)}{toast.reminder.note ? ` · ${toast.reminder.note}` : ''}</small>
          {!toast.reminder.practiceDeleted && <Link prefetch={false} href={leadHref(toast.reminder.practiceCode, 'reminders')} onClick={() => setToast(null)}>Open lead →</Link>}
        </div>
      )}
    </div>
  )
}
