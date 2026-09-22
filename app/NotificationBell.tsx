'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { getReminders, type Reminder } from './reminders-actions'

// Keep the bell quiet after its first successful load. A full browser reload
// starts a fresh cache, while route changes reuse this in-memory result.
let reminderCache: { reminders: Reminder[] } | null = null
let reminderRequest: Promise<Reminder[] | null> | null = null

function primeReminderCache(reminders: Reminder[]) {
  reminderCache = { reminders }
}

async function getCachedReminders(): Promise<Reminder[] | null> {
  if (reminderCache) return reminderCache.reminders
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
  const boxRef = useRef<HTMLDivElement>(null)
  const loadingRef = useRef<Promise<void> | null>(null)

  const load = async () => {
    if (loadingRef.current) return loadingRef.current
    loadingRef.current = (async () => {
      const nextReminders = await getCachedReminders()
      if (nextReminders) setReminders(nextReminders)
      setLoaded(true)
    })().finally(() => { loadingRef.current = null })
    return loadingRef.current
  }

  useEffect(() => {
    if (initialReminders !== undefined) primeReminderCache(initialReminders)
  }, [initialReminders])

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const now = new Date()
  const active = reminders.filter((r) => !r.done)
  const overdue = active.filter((r) => new Date(r.remindAt) < now).sort((a, b) => +new Date(a.remindAt) - +new Date(b.remindAt))
  const upcoming = active.filter((r) => new Date(r.remindAt) >= now).sort((a, b) => +new Date(a.remindAt) - +new Date(b.remindAt))
  const preview = [...overdue, ...upcoming].slice(0, 6)
  const badgeCount = overdue.length

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="topbar-bell"
        onClick={() => { setOpen((v) => !v); if (!loaded) load() }}
        aria-label={badgeCount > 0 ? `${badgeCount} overdue reminder${badgeCount === 1 ? '' : 's'}` : 'Reminders'}
        title="Reminders"
        type="button"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {badgeCount > 0 && <span className="topbar-bell-badge">{badgeCount > 9 ? '9+' : badgeCount}</span>}
      </button>

      {open && (
        <div className="topbar-bell-panel">
          <div className="topbar-bell-panel-head">
            Reminders
            {overdue.length > 0 && <span className="badge badge-red">{overdue.length} overdue</span>}
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
    </div>
  )
}
