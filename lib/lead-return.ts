// Where "Back" on a single lead page goes. Every page that opens a lead adds
// `?from=<page>` to the link; the lead page uses this to send you back to the
// same page (and keeps `from` on Previous / Next and related-practice links).
// Unknown values fall back to the Leads page.

export type LeadSource =
  | 'reminders' | 'transfers' | 'worksheet-reports' | 'clients' | 'sold-leads'
  | 'assignments' | 'agent-assigned' | 'role-view' | 'email-reports' | 'leads'

const SOURCES: Record<LeadSource, { path: string; label: string }> = {
  'reminders':         { path: '/reminders',         label: 'Back to My Reminders' },
  'transfers':         { path: '/transfers',         label: 'Back to transfers' },
  'worksheet-reports': { path: '/worksheet-reports', label: 'Back to Active Call' }, // renamed page
  'email-reports':     { path: '/email-reports',     label: 'Back to Active Email' },
  'clients':           { path: '/clients',           label: 'Back to Active Clients' },
  'sold-leads':        { path: '/clients?tab=sold',  label: 'Back to Sold leads' },
  'assignments':       { path: '/assignments',       label: 'Back to Assigned Leads' },
  'agent-assigned':    { path: '/agent-assigned',    label: 'Back to my assigned leads' },
  'role-view':         { path: '/admin/view',        label: 'Back to role view' },
  'leads':             { path: '/',                  label: 'Back to leads' },
}

/** Link to a lead that remembers which page opened it. */
export function leadHref(practiceCode: string | null | undefined, from: LeadSource | null = null): string {
  const base = `/practice/${encodeURIComponent(practiceCode ?? '')}`
  return from ? `${base}?from=${from}` : base
}

/**
 * Back link + the query to keep on further lead links (Previous / Next,
 * related practices), from the lead page's search params.
 */
export function leadReturn(sp: { from?: string; company?: string; view?: string; snapshot?: string; nav?: string; pool?: string; pos?: string }): { href: string; label: string; query: string } {
  // Only the listed pages (an own key — not inherited names like "__proto__").
  const from = (typeof sp.from === 'string' && Object.prototype.hasOwnProperty.call(SOURCES, sp.from) ? sp.from : null) as LeadSource | null
  if (!from) return { href: '/', label: 'Back to all practices', query: '' }
  if (from === 'worksheet-reports') {
    const company = typeof sp.company === 'string' ? sp.company : ''
    const view = sp.view === 'sheet' ? 'sheet' : 'reports'
    const keep = `company=${encodeURIComponent(company)}&view=${view}`
    return { href: `/worksheet-reports?${keep}`, label: SOURCES[from].label, query: `?from=worksheet-reports&${keep}` }
  }
  if (from === 'leads' && typeof sp.snapshot === 'string' && /^[0-9a-f-]{36}$/i.test(sp.snapshot)
      && typeof sp.nav === 'string' && /^[0-9a-f-]{36}$/i.test(sp.nav)) {
    const pool = ['all', 'new', 'worked', 'not-worked'].includes(sp.pool ?? '') ? sp.pool! : 'all'
    const position = /^\d{1,6}$/.test(sp.pos ?? '') ? sp.pos! : '0'
    const keep = `from=leads&snapshot=${encodeURIComponent(sp.snapshot)}&nav=${encodeURIComponent(sp.nav)}&pool=${pool}&pos=${position}`
    return { href: SOURCES[from].path, label: SOURCES[from].label, query: `?${keep}` }
  }
  return { href: SOURCES[from].path, label: SOURCES[from].label, query: `?from=${from}` }
}
