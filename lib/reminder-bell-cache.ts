// ← ADDED (new file) — "is the reminder bell currently showing a reminder for
// this lead?", read from the bell's saved copy in this browser. No server call.
//
// Used after a worksheet is saved WITHOUT a callback: the database then closes
// that lead's open reminder, so the bell should reload once — but only when
// it is actually showing one for that lead.
//
// Works with either version of the bell: if the bell keeps no saved copy
// (the 'hbs-reminder-bell' key is missing), the answer is simply "no".

const BELL_STORAGE_KEY = 'hbs-reminder-bell'

export function bellHasReminderFor(practiceCode: string | null | undefined): boolean {
  if (!practiceCode || typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(BELL_STORAGE_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw) as { reminders?: { practiceCode?: string | null; done?: boolean }[] }
    return Array.isArray(saved?.reminders) && saved.reminders.some((r) => !r?.done && r?.practiceCode === practiceCode)
  } catch {
    return false
  }
}
