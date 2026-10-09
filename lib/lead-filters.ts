// Lead Pool filtering, sorting and summary counts.
//
// Moved verbatim from app/PracticesTable.tsx so the same rules can run in the
// browser (legacy mode) and on the server (server-paged mode, where only the
// visible page of leads is sent to the browser). Do not change behaviour here
// without updating the equivalence tests in tests/performance.test.cjs.

export type LeadRow = {
  practiceCode: string
  name: string
  state: string | null
  specialty: string | null
  ccm: boolean
  pcm: boolean
  awv: boolean
  tcm: boolean
  bhi: boolean
  rpm: boolean
  rcmFit: boolean
  npiFound?: boolean
  entityType?: string | null
  enumerationDate?: string | null
  lastUpdated?: string | null
  mips?: Record<number, string> | null
  mipsByYear?: Record<number, string> | null
  allocatedOn?: string | null
  status?: string | null
  source?: string | null
  allocatedTo?: string | null
  allocatedCompanies?: { id: string; name: string }[]
  sex?: string | null
  orgName?: string | null
  risk?: string | null
  paymentAdj?: string | null
  lastDialed?: string | null
  assignedAwayTo?: { name: string; role: string } | null
}

export type ZoneKey = 'EST' | 'CST' | 'MST' | 'PST' | 'Other'
export const ZONE_KEYS = ['EST', 'CST', 'MST', 'PST', 'Other'] as const

// Deterministic state -> US timezone-zone mapping (same lookup used on the
// single-practice page), so these counts reflect the real practices in view.
export const ZONE_BY_STATE: Record<string, ZoneKey> = {
  CT: 'EST', DE: 'EST', FL: 'EST', GA: 'EST', ME: 'EST', MD: 'EST', MA: 'EST', NH: 'EST',
  NJ: 'EST', NY: 'EST', NC: 'EST', OH: 'EST', PA: 'EST', RI: 'EST', SC: 'EST', VT: 'EST',
  VA: 'EST', WV: 'EST', DC: 'EST', MI: 'EST', IN: 'EST', KY: 'EST',
  AL: 'CST', AR: 'CST', IL: 'CST', IA: 'CST', KS: 'CST', LA: 'CST', MN: 'CST', MS: 'CST',
  MO: 'CST', NE: 'CST', ND: 'CST', OK: 'CST', SD: 'CST', TN: 'CST', TX: 'CST', WI: 'CST',
  AZ: 'MST', CO: 'MST', ID: 'MST', MT: 'MST', NM: 'MST', UT: 'MST', WY: 'MST',
  CA: 'PST', NV: 'PST', OR: 'PST', WA: 'PST',
  AK: 'Other', HI: 'Other',
}

// Compare the stored calendar date directly to avoid timezone shifts.
export function isWithinDateRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true
  if (!value) return false
  const date = value.trim().slice(0, 10)
  return (!from || date >= from) && (!to || date <= to)
}

/** Calendar date (YYYY-MM-DD) of a timestamp in the browser's own time zone. */
export function toLocalCalendarDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Same as toLocalCalendarDate, but for a named time zone (the browser's zone,
 * sent to the server), so "Assigned on" matches what the browser would show.
 */
export function calendarDateIn(timeZone: string | null | undefined): (value: string | null | undefined) => string {
  let format: Intl.DateTimeFormat | null = null
  try {
    if (timeZone) format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    format = null
  }
  if (!format) return toLocalCalendarDate
  return (value) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const parts = format!.formatToParts(date)
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  }
}

export const hasRealMips = (p: LeadRow) => {
  const v = (p.mipsByYear?.[2026] ?? '').toString().trim().toLowerCase()
  if (!v) return false
  // Real MIPS participation = the row mentions Individual or Group (or MIPS APM),
  // even if "Excluded" also appears (e.g. "Individual + Group / Excluded - low volume").
  if (v.includes('individual')) return true
  if (v.includes('group')) return true
  if (v.includes('apm')) return true
  // Otherwise it's purely No record / Excluded → not real participation.
  return false
}

// Each signal pill has a key (for toggle state) and a test(p) => boolean.
// Booleans (CCM/PCM/…) test their flag; MIPS tests for real MIPS data.
export const SIGNALS: { key: string; label: string; test: (p: LeadRow) => boolean }[] = [
  { key: 'ccm',    label: 'CCM',     test: (p) => !!p.ccm },
  { key: 'pcm',    label: 'PCM',     test: (p) => !!p.pcm },
  { key: 'awv',    label: 'AWV',     test: (p) => !!p.awv },
  { key: 'tcm',    label: 'TCM',     test: (p) => !!p.tcm },
  { key: 'bhi',    label: 'BHI',     test: (p) => !!p.bhi },
  { key: 'rpm',    label: 'RPM',     test: (p) => !!p.rpm },
  { key: 'rcmFit', label: 'RCM Fit', test: (p) => !!p.rcmFit },
  { key: 'mips',   label: 'MIPS',    test: (p) => hasRealMips(p) },
]

export type LeadFilters = {
  search: string
  stateFilter: string
  zoneFilter: ZoneKey | ''
  /** Chosen specialties (any of them matches); empty = all specialties. */
  specialtyFilter: string[]
  dispositionFilter: string
  activeSignals: string[]
  catTab: string
  sourceTab: 'All' | 'Allocated' | 'Uploaded'
  poolTab: string
  assignedView: 'all' | 'mine'
  companyFilter: string
  enumTypeFilter: string
  lastUpdatedFrom: string
  lastUpdatedTo: string
  enumDateFrom: string
  enumDateTo: string
  assignedDateFilter: string
}

export const DEFAULT_LEAD_FILTERS: LeadFilters = {
  search: '', stateFilter: '', zoneFilter: '', specialtyFilter: [], dispositionFilter: '',
  activeSignals: [], catTab: 'All Categories', sourceTab: 'All', poolTab: 'All Leads',
  assignedView: 'all', companyFilter: '', enumTypeFilter: '', lastUpdatedFrom: '',
  lastUpdatedTo: '', enumDateFrom: '', enumDateTo: '', assignedDateFilter: '',
}

/**
 * Specialty filter as a clean list: accepts a list or (older saved filters,
 * older clients) a single value. Max 200 specialties, 200 characters each.
 */
export function toSpecialtyList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const clean = items.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.slice(0, 200))
  return Array.from(new Set(clean)).slice(0, 200)
}

/** Accept only well-formed filter values (they arrive from the browser). */
export function sanitizeLeadFilters(input: unknown): LeadFilters {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const str = (key: keyof LeadFilters) => (typeof raw[key] === 'string' ? (raw[key] as string).slice(0, 200) : DEFAULT_LEAD_FILTERS[key] as string)
  const zone = str('zoneFilter')
  const source = str('sourceTab')
  const view = str('assignedView')
  return {
    search: str('search'),
    stateFilter: str('stateFilter'),
    zoneFilter: zone === '' || (ZONE_KEYS as readonly string[]).includes(zone) ? zone as ZoneKey | '' : '',
    specialtyFilter: toSpecialtyList(raw.specialtyFilter),
    dispositionFilter: str('dispositionFilter'),
    activeSignals: Array.isArray(raw.activeSignals)
      ? (raw.activeSignals as unknown[]).filter((v): v is string => typeof v === 'string' && SIGNALS.some((s) => s.key === v))
      : [],
    catTab: str('catTab'),
    sourceTab: source === 'Allocated' || source === 'Uploaded' ? source : 'All',
    poolTab: str('poolTab'),
    assignedView: view === 'mine' ? 'mine' : 'all',
    companyFilter: str('companyFilter'),
    enumTypeFilter: str('enumTypeFilter'),
    lastUpdatedFrom: str('lastUpdatedFrom'),
    lastUpdatedTo: str('lastUpdatedTo'),
    enumDateFrom: str('enumDateFrom'),
    enumDateTo: str('enumDateTo'),
    assignedDateFilter: /^\d{4}-\d{2}-\d{2}$/.test(str('assignedDateFilter')) ? str('assignedDateFilter') : '',
  }
}

export type LeadContext = {
  isSuperAdmin: boolean
  prioritySet: Set<string>
  newLeadSet: Set<string>
  workedLeadSet: Set<string>
  /**
   * Extra search matches found on the server (phone numbers, email, city,
   * ZIP, contact person — details that are not part of the list rows).
   * A lead also matches the search box when its code is in this set.
   */
  searchExtraCodes?: Set<string>
}

/**
 * Search box match on everything a lead row carries: name, NPI / lead code,
 * state, specialty, org name, status, assigned company and assigned person.
 */
export function leadMatchesSearch(p: LeadRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    p.name, p.practiceCode, p.state, p.specialty, p.orgName, p.status, p.entityType,
    p.allocatedTo, p.assignedAwayTo?.name, ...(p.allocatedCompanies ?? []).map((c) => c.name),
  ]
  return haystack.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))
}

/** The Lead Pool filter + priority sort (unchanged from PracticesTable). */
export function filterLeads<T extends LeadRow>(
  practices: T[],
  f: LeadFilters,
  { isSuperAdmin, prioritySet, newLeadSet, workedLeadSet, searchExtraCodes }: LeadContext,
  toCalendarDate: (value: string | null | undefined) => string = toLocalCalendarDate,
): T[] {
  const { search, stateFilter, zoneFilter, specialtyFilter, dispositionFilter, catTab, sourceTab, poolTab,
    assignedView, companyFilter, enumTypeFilter, lastUpdatedFrom, lastUpdatedTo, enumDateFrom, enumDateTo,
    assignedDateFilter } = f
  // Any of the chosen specialties matches (a single legacy value works too).
  const specialties = new Set(toSpecialtyList(specialtyFilter))
  const activeSignals = new Set(f.activeSignals)
  const hasPriority = prioritySet.size > 0

  const rows = practices.filter((p) => {
    if (isSuperAdmin) {
      if (companyFilter === '__unassigned__' && (p.allocatedCompanies?.length ?? 0) > 0) return false
      if (companyFilter && companyFilter !== '__unassigned__'
        && !p.allocatedCompanies?.some(company => company.id === companyFilter)) return false
    }
    if (search && !leadMatchesSearch(p, search) && !searchExtraCodes?.has(p.practiceCode)) return false
    if (stateFilter && p.state !== stateFilter) return false
    if (zoneFilter) {
      const practiceZone = p.state ? (ZONE_BY_STATE[p.state] ?? 'Other') : 'Other'
      if (practiceZone !== zoneFilter) return false
    }
    if (specialties.size && !specialties.has(p.specialty ?? '')) return false

    // Category tab filter (All / MIPS / RCM / CCM / Credentialing)
    if (catTab === 'MIPS' && !hasRealMips(p)) return false
    if (catTab === 'RCM' && !p.rcmFit) return false
    if (catTab === 'CCM' && !p.ccm) return false
    if (catTab === 'Credentialing' && !p.npiFound) return false
    // Credentialing sub-filters — only applied once Credentialing itself
    // is selected, since these fields only mean anything for NPPES data.
    if (catTab === 'Credentialing') {
      if (enumTypeFilter && (p.entityType ?? '') !== enumTypeFilter) return false
      if (!isWithinDateRange(p.lastUpdated, lastUpdatedFrom, lastUpdatedTo)) return false
      if (!isWithinDateRange(p.enumerationDate, enumDateFrom, enumDateTo)) return false
    }
    if (dispositionFilter && p.status !== dispositionFilter) return false

    // Signal pills (CCM/PCM/…/MIPS) — each active pill must pass (AND logic).
    for (const key of activeSignals) {
      const sig = SIGNALS.find((s) => s.key === key)
      if (sig && !sig.test(p)) return false
    }

    // Source filter: All / Allocated (from Super Admin) / Uploaded (own)
    if (sourceTab !== 'All') {
      const src = (p.source ?? '').toLowerCase()
      const isAllocated = src.includes('alloc')
      if (sourceTab === 'Allocated' && !isAllocated) return false
      if (sourceTab === 'Uploaded' && isAllocated) return false
    }

    // Pool tab filter (All Leads / New Leads / Worked Leads)
    if (poolTab === 'New Leads' && !newLeadSet.has(p.practiceCode)) return false
    if (poolTab === 'Worked Leads' && !workedLeadSet.has(p.practiceCode)) return false

    // "My assigned" view: only leads assigned to me (priority).
    if (assignedView === 'mine' && !prioritySet.has(p.practiceCode)) return false
    if (assignedDateFilter && toCalendarDate(p.allocatedOn) !== assignedDateFilter) return false

    return true
  })

  // Priority leads (assigned to me) float to the top; otherwise keep name order.
  if (hasPriority && assignedView === 'all') {
    rows.sort((a, b) => {
      const pa = prioritySet.has(a.practiceCode) ? 0 : 1
      const pb = prioritySet.has(b.practiceCode) ? 0 : 1
      if (pa !== pb) return pa - pb
      return a.name.localeCompare(b.name)
    })
  }
  return rows
}

export type LeadOverview = {
  states: string[]
  specialties: string[]
  dispositions: string[]
  zoneCounts: Record<string, number>
  summaryCounts: {
    total: number; unassigned: number; assigned: number; worked: number
    qualified: number; new: number; followUp: number
  }
  /** Companies found on the leads' allocations (for the company filter). */
  leadCompanies: { id: string; name: string }[]
  newCount: number
  workedCount: number
}

/** Dropdown options and summary-card numbers (unchanged from PracticesTable). */
export function leadOverview(
  practices: LeadRow[],
  { isSuperAdmin, newLeadSet, workedLeadSet, completedWorksheetCount }:
    Omit<LeadContext, 'prioritySet'> & { completedWorksheetCount?: number },
): LeadOverview {
  const zoneCounts: Record<string, number> = { EST: 0, CST: 0, MST: 0, PST: 0, Other: 0 }
  for (const p of practices) {
    const zone = p.state ? (ZONE_BY_STATE[p.state] ?? 'Other') : 'Other'
    zoneCounts[zone] = (zoneCounts[zone] ?? 0) + 1
  }
  const leadCompanies = new Map<string, string>()
  for (const practice of practices) {
    for (const company of practice.allocatedCompanies ?? []) leadCompanies.set(company.id, company.name)
  }
  return {
    states: Array.from(new Set(practices.map((p) => p.state).filter(Boolean))).sort() as string[],
    specialties: Array.from(new Set(practices.map((p) => p.specialty).filter(Boolean))).sort() as string[],
    dispositions: Array.from(new Set(practices.map((p) => p.status).filter(Boolean))).sort() as string[],
    zoneCounts,
    summaryCounts: {
      total: practices.length,
      unassigned: practices.filter((p) => isSuperAdmin
        ? (p.allocatedCompanies?.length ?? 0) === 0
        : !p.assignedAwayTo).length,
      assigned: practices.filter((p) => isSuperAdmin
        ? (p.allocatedCompanies?.length ?? 0) > 0
        : !!p.assignedAwayTo).length,
      worked: completedWorksheetCount ?? practices.filter((p) => workedLeadSet.has(p.practiceCode)).length,
      qualified: practices.filter((p) => (p.status ?? '').toLowerCase().includes('qualif')).length,
      new: practices.filter((p) => newLeadSet.has(p.practiceCode)).length,
      followUp: practices.filter((p) => {
        const status = (p.status ?? '').toLowerCase()
        return status.includes('follow') || status.includes('call back') || status.includes('callback')
      }).length,
    },
    leadCompanies: Array.from(leadCompanies, ([id, name]) => ({ id, name })),
    newCount: newLeadSet.size,
    workedCount: workedLeadSet.size,
  }
}
