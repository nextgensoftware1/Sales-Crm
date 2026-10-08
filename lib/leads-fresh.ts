// ← ADDED (new file) — tells the Leads page to load fresh data on its next
// render instead of opening instantly from the recent snapshot. Called just
// before router.refresh() after this user changes leads (allocate, delete,
// assign, upload), so their own change is always visible immediately.
// The cookie lasts 20 seconds — long enough for that one refresh.
export function markLeadsChanged() {
  if (typeof document === 'undefined') return
  document.cookie = 'crm_leads_fresh=1; path=/; max-age=20; samesite=lax'
}
