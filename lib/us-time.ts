// ← ADDED (new file) — callback times in US practice time zones.
//
// An agent types a callback time as the PRACTICE'S local clock ("call at
// 10:00 AM EST") and picks the zone. These helpers turn that into one exact
// moment (stored in UTC), so every role, on every computer, sees the same
// reminder at the same moment — no matter where the agent's PC or the server
// is. Daylight saving is handled automatically (10:00 AM EST in July means
// 10:00 on New York clocks).
//
// Runs the same in the browser and on the server (uses only Intl).

export type UsZone = 'Eastern' | 'Central' | 'Mountain' | 'Arizona' | 'Pacific'

export const US_ZONES: { value: UsZone; label: string; name: string; iana: string }[] = [
  { value: 'Eastern', label: 'EST', name: 'EST — Eastern', iana: 'America/New_York' },
  { value: 'Central', label: 'CST', name: 'CST — Central', iana: 'America/Chicago' },
  { value: 'Mountain', label: 'MST', name: 'MST — Mountain', iana: 'America/Denver' },
  // Arizona stays on MST all year (no daylight saving), so it needs its own entry.
  { value: 'Arizona', label: 'MST', name: 'MST — Arizona', iana: 'America/Phoenix' },
  { value: 'Pacific', label: 'PST', name: 'PST — Pacific', iana: 'America/Los_Angeles' },
]

const BY_VALUE = new Map(US_ZONES.map((z) => [z.value.toLowerCase(), z]))
// Old/other spellings that may already be saved on worksheets.
const ALIASES: Record<string, UsZone> = {
  est: 'Eastern', edt: 'Eastern', et: 'Eastern',
  cst: 'Central', cdt: 'Central', ct: 'Central',
  mst: 'Mountain', mdt: 'Mountain', mt: 'Mountain',
  pst: 'Pacific', pdt: 'Pacific', pt: 'Pacific',
}

/** A known zone value, or null (e.g. old "Other" / empty). */
export function normalizeZone(value: string | null | undefined): UsZone | null {
  const key = (value ?? '').trim().toLowerCase()
  if (!key) return null
  return BY_VALUE.get(key)?.value ?? ALIASES[key] ?? null
}

/** Zone info for a value; unknown values fall back to Eastern. */
export function zoneInfo(value: string | null | undefined) {
  return BY_VALUE.get((normalizeZone(value) ?? 'Eastern').toLowerCase())!
}

const STATE_ZONE: Record<string, UsZone> = {}
for (const s of ['CT', 'DE', 'FL', 'GA', 'ME', 'MD', 'MA', 'NH', 'NJ', 'NY', 'NC', 'OH', 'PA', 'RI', 'SC', 'VT', 'VA', 'WV', 'DC', 'MI', 'IN', 'KY']) STATE_ZONE[s] = 'Eastern'
for (const s of ['AL', 'AR', 'IL', 'IA', 'KS', 'LA', 'MN', 'MS', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'TX', 'WI']) STATE_ZONE[s] = 'Central'
for (const s of ['CO', 'ID', 'MT', 'NM', 'UT', 'WY']) STATE_ZONE[s] = 'Mountain'
STATE_ZONE.AZ = 'Arizona'
for (const s of ['CA', 'NV', 'OR', 'WA']) STATE_ZONE[s] = 'Pacific'

/** The practice's zone from its state (same map as the Leads Engine zones); Eastern if unknown. */
export function zoneForState(state: string | null | undefined): UsZone {
  return STATE_ZONE[(state ?? '').trim().toUpperCase()] ?? 'Eastern'
}

type Parts = { y: number; m: number; d: number; h: number; min: number; weekday: number }
const formatters = new Map<string, Intl.DateTimeFormat>()
function partsIn(ms: number, iana: string): Parts {
  let f = formatters.get(iana)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: iana, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formatters.set(iana, f)
  }
  const get: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(ms))) get[p.type] = p.value
  return {
    y: +get.year, m: +get.month, d: +get.day, h: +get.hour % 24, min: +get.minute,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get.weekday),
  }
}
/** Zone offset from UTC in ms at a given moment (negative for the US). */
function offsetMs(ms: number, iana: string): number {
  const p = partsIn(ms, iana)
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min)
  return asUtc - Math.floor(ms / 60000) * 60000
}

const pad = (n: number) => String(n).padStart(2, '0')
const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/**
 * "2026-10-24T10:00" typed in a zone → exact moment as an ISO string (UTC).
 * Returns null for text that isn't a date/time.
 */
export function zonedWallTimeToUtcIso(wall: string, zone: string | null | undefined): string | null {
  const m = WALL_RE.exec((wall ?? '').trim())
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const iana = zoneInfo(zone).iana
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  let t = guess - offsetMs(guess, iana)
  const second = offsetMs(t, iana)
  if (guess - second !== t) t = guess - second // crossed a daylight-saving change
  const date = new Date(t)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Exact moment → "YYYY-MM-DDTHH:mm" on that zone's clock (for <input type="datetime-local">). */
export function utcToZonedWallTime(iso: string | null | undefined, zone: string | null | undefined): string {
  if (!iso) return ''
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return ''
  const p = partsIn(ms, zoneInfo(zone).iana)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`
}

/** Exact moment → "24/10/2026, 10:00 AM EST" on that zone's clock. */
export function formatInZone(iso: string | null | undefined, zone: string | null | undefined): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return '—'
  const info = zoneInfo(zone)
  const p = partsIn(ms, info.iana)
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12
  return `${pad(p.d)}/${pad(p.m)}/${p.y}, ${h12}:${pad(p.min)} ${p.h < 12 ? 'AM' : 'PM'} ${info.label}`
}

/** Quick picks, all on the chosen zone's clock. */
export function quickWallTime(kind: 'plus1h' | 'tomorrow9' | 'tomorrow11' | 'tomorrow14' | 'nextMonday10', zone: string | null | undefined, nowMs = Date.now()): string {
  const iana = zoneInfo(zone).iana
  if (kind === 'plus1h') {
    const p = partsIn(nowMs + 60 * 60000, iana)
    return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`
  }
  const today = partsIn(nowMs, iana)
  let addDays = 1
  if (kind === 'nextMonday10') addDays = ((8 - today.weekday) % 7) || 7 // the coming Monday, never today
  const day = new Date(Date.UTC(today.y, today.m - 1, today.d + addDays))
  const hour = { tomorrow9: 9, tomorrow11: 11, tomorrow14: 14, nextMonday10: 10 }[kind]
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${pad(hour)}:00`
}
