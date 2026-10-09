'use client'

// Clears saved filters so a new sign-in always starts clean. Called when
// signing out and again after signing in (which also covers sessions that
// ended without pressing Sign Out). Preferences such as theme, sidebar and
// panel open/closed are kept — they are not filters.
const SAVED_FILTER_PREFIXES = ['lead-management-filters']

export function clearSavedFilters() {
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && SAVED_FILTER_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key)
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch { /* storage unavailable: nothing saved to clear */ }
  // Filters shared between parts of a page (KPI company, worksheet search).
  try { delete (window as unknown as { __hbsSharedValues?: unknown }).__hbsSharedValues } catch { /* ignore */ }
}
