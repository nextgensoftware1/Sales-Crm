'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getReminders, type Reminder } from './reminders-actions'
import { classifyReminderAttention, getReminderNotificationSlot } from '../lib/reminder-utils'

// Keep the bell quiet after its first successful load. A full browser reload
// starts a fresh cache, while route changes reuse this in-memory result.
let reminderCache: { reminders: Reminder[] } | null = null
let reminderRequest: Promise<Reminder[] | null> | null = null

function primeReminderCache(reminders: Reminder[]) {
  reminderCache = { reminders }
}

async function getCachedReminders(force = false): Promise<Reminder[] | null> {
  if (!force && reminderCache) return reminderCache.reminders
  if (reminderRequest) return reminderRequest

  reminderRequest = getReminders()
    .then((res) => {
      if (!res.ok) return null
      const reminders = res.reminders ?? []
      primeReminderCache(reminders)
      return reminders
    })
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

  // Load without waiting for the bell to be clicked, then refresh at a low
  // frequency so newly scheduled callbacks can notify an already-open app.
  useEffect(() => {
    if (initialReminders === undefined) void load()
    const poll = window.setInterval(() => { void load(true) }, 5 * 60 * 1000)
    const tick = window.setInterval(() => setClock(Date.now()), 30 * 1000)
    const refresh = () => { void load(true) }
    window.addEventListener('reminders:changed', refresh)
    return () => {
      window.clearInterval(poll)
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
                    href={r.practiceDeleted ? '#' : `/practice/${r.practiceCode}`}
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
          {!toast.reminder.practiceDeleted && <Link prefetch={false} href={`/practice/${toast.reminder.practiceCode}`} onClick={() => setToast(null)}>Open lead →</Link>}
        </div>
      )}
    </div>
  )
}
