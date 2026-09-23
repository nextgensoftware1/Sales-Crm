'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { allocatePractices, softDeleteLeads } from './actions'
import { assignLeadsToAgent } from './assign-actions'

type Practice = {
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

type Company = { id: string; slug: string; name: string }

type Props = {
  lazyOptions?: boolean
  practices: Practice[]
  companies?: Company[]
  isSuperAdmin?: boolean
  currentUser?: { full_name: string; role: string; company: string } | null
  canAssign?: boolean
  myAgents?: { id: string; full_name: string; role: string }[]
  myAssignedCodes?: string[]
  newLeadCodes?: string[]      // practices from the most recent upload batch
  workedLeadCodes?: string[]   // practices with any lead_activity entries
}

// ---- palette (dark, matches the sample) ----
const C = {
  bg: 'var(--bg)',
  panel: 'var(--surface)',
  panelAlt: 'var(--surface-2)',
  line: 'var(--border-dim)',
  text: 'var(--ink-strong)',
  dim: 'var(--muted)',
  faint: 'var(--muted-2)',
  blue: 'var(--accent)',
  cyan: 'var(--c-transfers)',
  green: 'var(--ok)',
  amber: 'var(--warn)',
  violet: 'var(--purple)',
}

// Each signal pill has a key (for toggle state) and a test(p) => boolean.
// Booleans (CCM/PCM/…) test their flag; MIPS tests for real MIPS data.
const hasRealMips = (p: Practice) => {
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

const SIGNALS: { key: string; label: string; test: (p: Practice) => boolean }[] = [
  { key: 'ccm',    label: 'CCM',     test: (p) => !!p.ccm },
  { key: 'pcm',    label: 'PCM',     test: (p) => !!p.pcm },
  { key: 'awv',    label: 'AWV',     test: (p) => !!p.awv },
  { key: 'tcm',    label: 'TCM',     test: (p) => !!p.tcm },
  { key: 'bhi',    label: 'BHI',     test: (p) => !!p.bhi },
  { key: 'rpm',    label: 'RPM',     test: (p) => !!p.rpm },
  { key: 'rcmFit', label: 'RCM Fit', test: (p) => !!p.rcmFit },
  { key: 'mips',   label: 'MIPS',    test: (p) => hasRealMips(p) },
]

// Deterministic state -> US timezone-zone mapping (same lookup used on the
// single-practice page), so these counts reflect the real practices in view.
const ZONE_BY_STATE: Record<string, 'EST' | 'CST' | 'MST' | 'PST' | 'Other'> = {
  CT: 'EST', DE: 'EST', FL: 'EST', GA: 'EST', ME: 'EST', MD: 'EST', MA: 'EST', NH: 'EST',
  NJ: 'EST', NY: 'EST', NC: 'EST', OH: 'EST', PA: 'EST', RI: 'EST', SC: 'EST', VT: 'EST',
  VA: 'EST', WV: 'EST', DC: 'EST', MI: 'EST', IN: 'EST', KY: 'EST',
  AL: 'CST', AR: 'CST', IL: 'CST', IA: 'CST', KS: 'CST', LA: 'CST', MN: 'CST', MS: 'CST',
  MO: 'CST', NE: 'CST', ND: 'CST', OK: 'CST', SD: 'CST', TN: 'CST', TX: 'CST', WI: 'CST',
  AZ: 'MST', CO: 'MST', ID: 'MST', MT: 'MST', NM: 'MST', UT: 'MST', WY: 'MST',
  CA: 'PST', NV: 'PST', OR: 'PST', WA: 'PST',
  AK: 'Other', HI: 'Other',
}
const ZONE_KEYS = ['EST', 'CST', 'MST', 'PST', 'Other'] as const
type ZoneKey = typeof ZONE_KEYS[number]

export default function PracticesTable({ practices, companies: initialCompanies = [], isSuperAdmin = false, canAssign = false, myAgents: initialAgents = [], myAssignedCodes = [], newLeadCodes = [], workedLeadCodes = [], lazyOptions = false }: Props) {
  const router = useRouter()
  const [companies, setCompanies] = useState(initialCompanies)
  const [myAgents, setMyAgents] = useState(initialAgents)
  const [optionsLoaded, setOptionsLoaded] = useState(!lazyOptions)
  const [optionsBusy, setOptionsBusy] = useState(false)
  const [optionsError, setOptionsError] = useState('')
  const optionsRequest = useRef(false)
  const loadOptions = async () => {
    if (optionsLoaded || optionsRequest.current || (!canAssign && !isSuperAdmin)) return
    optionsRequest.current = true
    setOptionsBusy(true)
    setOptionsError('')
    try {
      const response = await fetch('/api/lead-options', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || 'Could not load options.')
      setCompanies(data.companies)
      setMyAgents(data.agents)
      setOptionsLoaded(true)
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : 'Could not load options. Please retry.')
    } finally {
      optionsRequest.current = false
      setOptionsBusy(false)
    }
  }
  // Populate the company-wise filter in the background so its first opening
  // already contains every registered company. The main lead request remains
  // independent of this smaller options request.
  useEffect(() => {
    if (isSuperAdmin) void loadOptions()
    // loadOptions deliberately runs once for the role present at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin])

  // ---- REAL filter state ----
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [specialtyFilter, setSpecialtyFilter] = useState('')
  const [dispositionFilter, setDispositionFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [zoneFilter, setZoneFilter] = useState<ZoneKey | ''>('')
  const companyFilterOptions = useMemo(() => {
    const registered = new Map<string, string>()
    for (const company of companies) registered.set(company.id, company.name)
    // Keep allocated companies available while the lazy registered-company
    // request is loading, and tolerate historical allocations whose company
    // has since been deactivated or removed from the normal company list.
    for (const practice of practices) {
      for (const company of practice.allocatedCompanies ?? []) registered.set(company.id, company.name)
    }
    return Array.from(registered, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [companies, practices])
  const [activeSignals, setActiveSignals] = useState<Set<string>>(new Set())

  // ---- REAL allocation state ----
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targetCompany, setTargetCompany] = useState('')
  const [allocMsg, setAllocMsg] = useState('')

  // ---- REAL delete state (Super Admin only) ----
  const [deleteMsg, setDeleteMsg] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  // ---- REAL assign state (company_admin / manager / team_lead) ----
  const [targetAgent, setTargetAgent] = useState('')
  const [assignMsg, setAssignMsg] = useState('')

  // ---- range-select state (pick rows N..M of the filtered list) ----
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')

  // Priority = leads assigned to me by my boss. Toggle between showing only
  // those ("My assigned") and the whole company pool ("All company").
  const prioritySet = useMemo(() => new Set(myAssignedCodes), [myAssignedCodes])
  const hasPriority = prioritySet.size > 0
  const [assignedView, setAssignedView] = useState<'all' | 'mine'>('all')

  // Lookup sets for the Lead Pool tabs.
  const newLeadSet    = useMemo(() => new Set(newLeadCodes),    [newLeadCodes])
  const workedLeadSet = useMemo(() => new Set(workedLeadCodes), [workedLeadCodes])

  // ---- placeholder-only UI state (sample) ----
  const [poolTab, setPoolTab] = useState('All Leads')
  const [sourceTab, setSourceTab] = useState<'All' | 'Allocated' | 'Uploaded'>('All')
  const [catTab, setCatTab] = useState('All Categories')

  const states = useMemo(
    () => Array.from(new Set(practices.map((p) => p.state).filter(Boolean))).sort() as string[],
    [practices]
  )

  const specialties = useMemo(
    () => Array.from(new Set(practices.map((p) => p.specialty).filter(Boolean))).sort() as string[],
    [practices]
  )

  const dispositions = useMemo(
    () => Array.from(new Set(practices.map((p) => p.status).filter(Boolean))).sort() as string[],
    [practices]
  )

  // Real zone counts, derived from each practice's state — same lookup used
  // on the single-practice page's zone badge.
  const zoneCounts = useMemo(() => {
    const counts: Record<string, number> = { EST: 0, CST: 0, MST: 0, PST: 0, Other: 0 }
    for (const p of practices) {
      const zone = p.state ? (ZONE_BY_STATE[p.state] ?? 'Other') : 'Other'
      counts[zone] = (counts[zone] ?? 0) + 1
    }
    return counts
  }, [practices])

  const summaryCounts = useMemo(() => ({
    total: practices.length,
    unassigned: practices.filter((p) => isSuperAdmin
      ? (p.allocatedCompanies?.length ?? 0) === 0
      : !p.assignedAwayTo).length,
    assigned: practices.filter((p) => isSuperAdmin
      ? (p.allocatedCompanies?.length ?? 0) > 0
      : !!p.assignedAwayTo).length,
    worked: practices.filter((p) => workedLeadSet.has(p.practiceCode)).length,
    qualified: practices.filter((p) => (p.status ?? '').toLowerCase().includes('qualif')).length,
  }), [practices, isSuperAdmin, workedLeadSet])

  const toggleSignal = (key: string) => {
    setActiveSignals((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const filtered = useMemo(() => {
    const rows = practices.filter((p) => {
      if (isSuperAdmin) {
        if (companyFilter === '__unassigned__' && (p.allocatedCompanies?.length ?? 0) > 0) return false
        if (companyFilter && companyFilter !== '__unassigned__'
          && !p.allocatedCompanies?.some(company => company.id === companyFilter)) return false
      }
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.practiceCode.toLowerCase().includes(search.toLowerCase())) return false
      if (stateFilter && p.state !== stateFilter) return false
      if (zoneFilter) {
        const practiceZone = p.state ? (ZONE_BY_STATE[p.state] ?? 'Other') : 'Other'
        if (practiceZone !== zoneFilter) return false
      }
      if (specialtyFilter && p.specialty !== specialtyFilter) return false

      // Category tab filter (All / MIPS / RCM / CCM)
      if (catTab === 'MIPS' && !hasRealMips(p)) return false
      if (catTab === 'RCM' && !p.rcmFit) return false
      if (catTab === 'CCM' && !p.ccm) return false
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
  }, [practices, search, stateFilter, zoneFilter, specialtyFilter, dispositionFilter, activeSignals, catTab, sourceTab, poolTab, newLeadSet, workedLeadSet, assignedView, prioritySet, hasPriority, isSuperAdmin, companyFilter])

  // Real client-side pagination over the already-fetched/filtered array —
  // no new queries, same `filtered` rows, just windowed into pages instead
  // of rendering the entire result set at once.
  const [pageSize, setPageSize] = useState(isSuperAdmin ? 20 : 8)
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageRows = filtered.slice(pageStart, pageStart + pageSize)
  // Any change to the filtered set (search, a filter, a tab) should land
  // back on page 1 rather than leaving the user stranded past the end.
  useEffect(() => { setPage(1) }, [search, stateFilter, zoneFilter, specialtyFilter, dispositionFilter, activeSignals, catTab, sourceTab, poolTab, assignedView, companyFilter])

  function getPageNumbers(current: number, total: number): (number | '…')[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    let end = Math.min(total, Math.max(current + 2, 5))
    const start = Math.max(1, end - 4)
    end = Math.min(total, start + 4)
    const pages: (number | '…')[] = []
    for (let i = start; i <= end; i++) pages.push(i)
    if (end < total - 1) pages.push('…')
    if (end < total) pages.push(total)
    return pages
  }

  const toggleSelect = (code: string) => {
    void loadOptions()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  // Select-all: reflects the currently FILTERED rows.
  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.practiceCode))
  const toggleSelectAll = () => {
    void loadOptions()
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const p of filtered) next.delete(p.practiceCode)   // clear filtered
      } else {
        for (const p of filtered) next.add(p.practiceCode)      // select all filtered
      }
      return next
    })
  }

  // Select rows N..M (1-based, inclusive) of the currently filtered list.
  const applyRange = () => {
    void loadOptions()
    const total = filtered.length
    let from = parseInt(rangeFrom, 10)
    let to = parseInt(rangeTo, 10)
    if (isNaN(from)) from = 1
    if (isNaN(to)) to = total
    from = Math.max(1, from)
    to = Math.min(total, to)
    if (from > to) { const t = from; from = to; to = t } // swap if reversed
    setSelected((prev) => {
      const next = new Set(prev)
      for (let i = from - 1; i <= to - 1; i++) {
        if (filtered[i]) next.add(filtered[i].practiceCode)
      }
      return next
    })
  }

  const handleAllocate = async () => {
    if (selected.size === 0) { setAllocMsg('Select at least one practice.'); return }
    if (!targetCompany) { setAllocMsg('Pick a company.'); return }
    const res = await allocatePractices(Array.from(selected), targetCompany)
    setAllocMsg(res.message)
    if (res.ok) {
      setSelected(new Set())
      router.refresh()
    }
  }

  const handleSoftDelete = async () => {
    if (selected.size === 0) { setDeleteMsg('Select at least one lead.'); return }
    const confirmed = window.confirm(
      `Move ${selected.size} lead(s) to Deleted Leads?\n\n` +
      `They will be hidden from the main pool but stay visible to any company ` +
      `that already has them allocated. You can restore or permanently delete ` +
      `them later from the Deleted Leads page.`
    )
    if (!confirmed) return
    setIsDeleting(true)
    const res = await softDeleteLeads(Array.from(selected))
    setDeleteMsg(res.message)
    setIsDeleting(false)
    if (res.ok) {
      setSelected(new Set())
      router.refresh()
    }
  }

  const handleAssign = async () => {
    if (selected.size === 0) { setAssignMsg('Select at least one lead.'); return }
    if (!targetAgent) { setAssignMsg('Pick an agent.'); return }
    const res = await assignLeadsToAgent(Array.from(selected), targetAgent)
    setAssignMsg(res.message)
    if (res.ok) {
      setSelected(new Set())
      router.refresh()
    }
  }

  const resetFilters = () => {
    setCompanyFilter('')
    setSearch(''); setStateFilter(''); setZoneFilter(''); setSpecialtyFilter(''); setDispositionFilter(''); setActiveSignals(new Set()); setCatTab('All Categories'); setSourceTab('All'); setPoolTab('All Leads'); setAssignedView('all')
  }

  const activeFilterCount = [
    search, stateFilter, zoneFilter, specialtyFilter, dispositionFilter, companyFilter,
    catTab !== 'All Categories' ? catTab : '', sourceTab !== 'All' ? sourceTab : '',
    poolTab !== 'All Leads' ? poolTab : '', assignedView !== 'all' ? assignedView : '',
  ].filter(Boolean).length + activeSignals.size

  return (
    <div className="leads-engine" style={{ color: C.text, fontFamily: 'var(--font-sans), ui-sans-serif, system-ui, sans-serif' }}>
      <section className="lead-summary-grid" aria-label="Lead pool summary">
        {[
          { label: 'Total Leads', value: summaryCounts.total, tone: 'blue' },
          { label: 'Unassigned', value: summaryCounts.unassigned, tone: 'amber' },
          { label: 'Assigned', value: summaryCounts.assigned, tone: 'purple' },
          { label: 'Worked', value: summaryCounts.worked, tone: 'cyan' },
          { label: 'Qualified', value: summaryCounts.qualified, tone: 'green' },
        ].map((item) => (
          <div className={`lead-summary-card tone-${item.tone}`} key={item.label}>
            <span className="lead-summary-icon" aria-hidden="true" />
            <span>
              <strong>{item.value}</strong>
              <small>{item.label}</small>
            </span>
          </div>
        ))}
      </section>

      {/* ---- Distribution Console ---- */}
      <section style={{ ...panel, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="leads-section-title">Leads Distribution Console</h2>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>Select an agent/closer and timezone counts to assign and export leads from the main pool.</div>
          </div>
          {/* <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['All Leads', 'MIPS Leads', 'RCM Leads', 'CCM Leads'].map((t) => (
              <span key={t} style={pill(t === 'All Leads')}>{t}</span>
            ))}
            <SampleTag />
          </div> */}
        </div>
        <div className="grid-zones" style={{ marginBottom: 14 }}>
          {ZONE_KEYS.map((z) => {
            const active = zoneFilter === z
            const empty = zoneCounts[z] === 0
            return (
            <button
              key={z}
              type="button"
              className={`zone-filter-card${active ? ' active' : ''}`}
              aria-pressed={active}
              aria-label={`${active ? 'Clear' : 'Filter by'} ${z} zone, ${zoneCounts[z]} lead${zoneCounts[z] === 1 ? '' : 's'}`}
              disabled={empty && !active}
              onClick={() => setZoneFilter(active ? '' : z)}
            >
              <span className="zone-filter-head">
                <span style={{ letterSpacing: 0.5, fontWeight: 700 }}>{z} ZONE</span>
                <span className="zone-filter-count">{zoneCounts[z]}</span>
              </span>
              <span className="zone-filter-value">{zoneCounts[z]}</span>
            </button>
          )})}
        </div>
        <div className="grid-console">
          {!isSuperAdmin && (
            <LabeledSelect label="TARGET AGENT" options={['— Select Agent / Closer —']} />
          )}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', background: C.panelAlt }}>
            <div style={{ fontSize: 10, color: C.faint, letterSpacing: 0.5, fontWeight: 700 }}>SPECIALTY</div>
            <select
              value={specialtyFilter}
              onChange={(e) => setSpecialtyFilter(e.target.value)}
              style={{ ...input, border: 'none', background: 'transparent', padding: '4px 0', width: '100%' }}
            >
              <option value="">— All Specialties —</option>
              {specialties.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: '8px 12px', background: C.panelAlt }}>
            <div style={{ fontSize: 10, color: C.faint, letterSpacing: 0.5, fontWeight: 700 }}>PRACTICE SIZE</div>
            <div style={{ fontSize: 13, marginTop: 4, color: C.text, fontWeight: 700 }}>
              {filtered.length === 0 ? '0' : `${pageStart + 1} to ${Math.min(pageStart + pageSize, filtered.length)}`}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Lead Pool bar ---- */}
      <section style={{ ...panel, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 className="leads-section-title">Lead Pool <span className="leads-section-count">({filtered.length} leads)</span></h2>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>Explore and manage your lead pool</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['All Leads', 'New Leads', 'Worked Leads'] as const).map((t) => {
            let count: number | null = null
            if (t === 'New Leads')    count = newLeadSet.size
            if (t === 'Worked Leads') count = workedLeadSet.size
            return (
              <button type="button" aria-pressed={poolTab === t} key={t} onClick={() => setPoolTab(t)} style={{ ...pill(poolTab === t), cursor: 'pointer' }}>
                {t}{count !== null ? ` (${count})` : ''}
              </button>
            )
          })}
        </div>
        {hasPriority && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button"
              aria-pressed={assignedView === 'mine'}
              onClick={() => setAssignedView('mine')}
              style={{ ...pill(assignedView === 'mine'), cursor: 'pointer', borderColor: C.amber, color: assignedView === 'mine' ? C.text : C.amber }}
            >
              ★ My assigned ({prioritySet.size})
            </button>
            <button type="button"
              aria-pressed={assignedView === 'all'}
              onClick={() => setAssignedView('all')}
              style={{ ...pill(assignedView === 'all'), cursor: 'pointer' }}
            >
              All company
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['All', 'Allocated', 'Uploaded'] as const).map((t) => (
            <button type="button" aria-pressed={sourceTab === t} key={t} onClick={() => setSourceTab(t)}
              style={{
                ...pill(sourceTab === t), cursor: 'pointer',
                borderColor: sourceTab === t ? (t === 'Allocated' ? 'var(--purple)' : t === 'Uploaded' ? 'var(--c-transfers)' : C.blue) : C.line,
              }}>
              {t === 'All' ? 'All Sources' : t}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['All Categories', 'MIPS', 'RCM', 'CCM'].map((t) => (
            <button type="button" aria-pressed={catTab === t} key={t} onClick={() => setCatTab(t)} style={{ ...pill(catTab === t), cursor: 'pointer' }}>{t}</button>
          ))}
        </div>
      </section>

      {/* ---- Quick and advanced filters ---- */}
      <section style={{ ...panel, marginBottom: 14 }}>
        <div className="filter-section-head">
          <div>
            <h2 className="leads-section-title">Find Leads</h2>
            <p>Search the pool and narrow results with the most-used filters.</p>
          </div>
          <span className="filter-result-count">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="filter-control filter-search"><span>Search</span><input aria-label="Search practices" placeholder="Practice name or ID…" value={search} onChange={(e) => setSearch(e.target.value)} style={input} /></label>
          <label className="filter-control"><span>State</span><select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={input}>
            <option value="">All States</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
          <label className="filter-control"><span>Specialty</span><select value={specialtyFilter} onChange={(e) => setSpecialtyFilter(e.target.value)} style={input}>
            <option value="">All Specialties</option>
            {specialties.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
          <label className="filter-control"><span>Disposition</span><select value={dispositionFilter} onChange={(e) => setDispositionFilter(e.target.value)} style={input}>
            <option value="">All Dispositions</option>
            {dispositions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select></label>
        </div>

        <details className="advanced-lead-tools">
          <summary>Advanced filters <span>{activeFilterCount > 0 ? `${activeFilterCount} active` : 'Optional'}</span></summary>
          <div className="advanced-filter-grid">
            {isSuperAdmin && <label className="filter-control"><span>Assigned company</span>
              <select aria-label="Filter by assigned company" value={companyFilter} style={input}
                onFocus={() => void loadOptions()} onPointerEnter={() => void loadOptions()}
                onChange={e => { setCompanyFilter(e.target.value); setSourceTab('All'); setSelected(new Set()) }}>
                <option value="">{optionsBusy ? 'Loading companies…' : 'All registered companies'}</option>
                <option value="__unassigned__">Not assigned</option>
                {companyFilterOptions.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>}
            <label className="filter-control"><span>MIPS year</span><select disabled style={{ ...input, opacity: 0.6 }}><option>MIPS Year 2026</option></select></label>
            <label className="filter-control"><span>Enrichment</span><select disabled style={{ ...input, opacity: 0.6 }}><option>Any Enrichment</option></select></label>
          </div>
          <div className="signal-filter-row">
            <strong>Signals</strong>
            {SIGNALS.map((s) => (
              <button type="button" aria-pressed={activeSignals.has(s.key)} key={s.key} onClick={() => toggleSignal(s.key)} style={pill(activeSignals.has(s.key))}>{s.label}</button>
            ))}
            <SampleTag note="MIPS year / enrichment filters are display-only" />
          </div>
        </details>

        {activeFilterCount > 0 && (
          <div className="active-filter-row">
            <strong>Active filters</strong>
            {search && <button onClick={() => setSearch('')}>Search: {search} ×</button>}
            {zoneFilter && <button onClick={() => setZoneFilter('')}>{zoneFilter} Zone ×</button>}
            {stateFilter && <button onClick={() => setStateFilter('')}>{stateFilter} ×</button>}
            {specialtyFilter && <button onClick={() => setSpecialtyFilter('')}>{specialtyFilter} ×</button>}
            {dispositionFilter && <button onClick={() => setDispositionFilter('')}>{dispositionFilter} ×</button>}
            {companyFilter && <button onClick={() => setCompanyFilter('')}>{companyFilter === '__unassigned__' ? 'Not assigned' : companyFilterOptions.find((c) => c.id === companyFilter)?.name ?? 'Company'} ×</button>}
            {poolTab !== 'All Leads' && <button onClick={() => setPoolTab('All Leads')}>{poolTab} ×</button>}
            {sourceTab !== 'All' && <button onClick={() => setSourceTab('All')}>{sourceTab} source ×</button>}
            {catTab !== 'All Categories' && <button onClick={() => setCatTab('All Categories')}>{catTab} ×</button>}
            {assignedView === 'mine' && <button onClick={() => setAssignedView('all')}>My assigned ×</button>}
            {Array.from(activeSignals).map((key) => <button key={key} onClick={() => toggleSignal(key)}>{SIGNALS.find((s) => s.key === key)?.label ?? key} ×</button>)}
            <button className="clear-all-filters" onClick={resetFilters}>Clear all</button>
          </div>
        )}
      </section>

      {/* ---- Allocation bar (real, Super Admin) ---- */}
      {isSuperAdmin && (
        <section className="bulk-action-bar" style={{ ...panel, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderColor: C.blue }}>
          <strong className="leads-selected-count">{selected.size} selected</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.dim }}>
            <strong style={{ color: C.text }}>Range</strong>
            <input
              aria-label="Select range from"
              type="number" min={1} placeholder="from"
              value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)}
              style={{ ...input, width: 74, padding: '6px 8px' }}
            />
            <span>to</span>
            <input
              aria-label="Select range to"
              type="number" min={1} placeholder="to"
              value={rangeTo} onChange={(e) => setRangeTo(e.target.value)}
              style={{ ...input, width: 74, padding: '6px 8px' }}
            />
            <button onClick={applyRange} style={btnGhost}>Select range</button>
            <span style={{ fontSize: 11, color: C.faint }}>of {filtered.length}</span>
          </div>
          <select aria-label="Company" onFocus={() => void loadOptions()} onPointerEnter={() => void loadOptions()} value={targetCompany} onChange={(e) => setTargetCompany(e.target.value)} style={input}>
            <option value="">{optionsBusy ? 'Loading companies…' : 'Choose company…'}</option>
            {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <button onClick={handleAllocate} style={btnPrimary}>Allocate Selected</button>
          <button
            onClick={handleSoftDelete}
            disabled={isDeleting}
            style={{ ...btnPrimary, background: 'var(--danger, #c0392b)', opacity: isDeleting ? 0.6 : 1 }}
            title="Move selected leads to Deleted Leads (soft delete)"
          >
            {isDeleting ? 'Deleting…' : 'Delete Selected'}
          </button>
          {allocMsg && <span style={{ fontSize: 13, color: C.dim }}>{allocMsg}</span>}
          {deleteMsg && <span style={{ fontSize: 13, color: C.dim }}>{deleteMsg}</span>}
        </section>
      )}

      {/* ---- Assign bar (Company Admin / Manager / Team Lead) ---- */}
      {canAssign && (
        <section className="bulk-action-bar" style={{ ...panel, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderColor: C.green }}>
          <strong className="leads-selected-count">{selected.size} selected</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.dim }}>
            <strong style={{ color: C.text }}>Range</strong>
            <input
              type="number" min={1} placeholder="from"
              value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)}
              style={{ ...input, width: 74, padding: '6px 8px' }}
            />
            <span>to</span>
            <input
              type="number" min={1} placeholder="to"
              value={rangeTo} onChange={(e) => setRangeTo(e.target.value)}
              style={{ ...input, width: 74, padding: '6px 8px' }}
            />
            <button onClick={applyRange} style={btnGhost}>Select range</button>
            <span style={{ fontSize: 11, color: C.faint }}>of {filtered.length}</span>
          </div>
          <select aria-label="Assign to team member" onFocus={() => void loadOptions()} onPointerEnter={() => void loadOptions()} value={targetAgent} onChange={(e) => setTargetAgent(e.target.value)} style={input}>
            <option value="">{optionsBusy ? 'Loading team…' : 'Assign to…'}</option>
            {myAgents.map((a) => <option key={a.id} value={a.id}>{a.full_name} · {a.role}</option>)}
          </select>
          <button onClick={handleAssign} style={{ ...btnPrimary, background: C.green }}>Assign Selected</button>
          {optionsLoaded && myAgents.length === 0 && <span style={{ fontSize: 13, color: C.faint }}>No direct reports to assign to.</span>}
          {assignMsg && <span style={{ fontSize: 13, color: C.dim }}>{assignMsg}</span>}
        </section>
      )}

      {optionsError && <p role="alert">{optionsError} <button type="button" onClick={() => void loadOptions()} disabled={optionsBusy}>Retry</button></p>}
      {/* ---- Table ---- */}
      <section className="tbl-wrap" style={{ ...panel, padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.line}` }}>
              {(isSuperAdmin || canAssign) && (
                <th style={th}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    title={allSelected ? 'Clear all' : 'Select all'}
                  />
                </th>
              )}
              <th style={{ ...thLeft, minWidth: 240 }}>Practice</th>
              <th style={th}>State</th>
              <th style={thLeft}>Specialty</th>
              <th style={th}>Sex</th>
              <th style={thLeft}>Org Name</th>
              <th style={th}>Risk</th>
              <th style={th}>Payment Adj %</th>
              <th style={thLeft}>Source</th>
              {isSuperAdmin && <th style={thLeft}>Assigned Company</th>}
              <th style={thLeft}>Last Dialed</th>
              <th style={thLeft}>Assigned On</th>
              <th style={thLeft}>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p) => (
              <tr key={p.practiceCode} className="leads-row" style={{ borderBottom: `1px solid ${C.line}` }}>
                {(isSuperAdmin || canAssign) && (
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={selected.has(p.practiceCode)}
                      onChange={() => toggleSelect(p.practiceCode)}
                      disabled={!!p.assignedAwayTo}
                      title={p.assignedAwayTo ? `Already assigned to ${p.assignedAwayTo.name} — can't be re-assigned from here` : undefined}
                    />
                  </td>
                )}
                <td style={{ ...tdLeft, minWidth: 240 }}>
                  {prioritySet.has(p.practiceCode) && (
                    <span title="Assigned to you" style={{ color: C.amber, marginRight: 6 }}>★</span>
                  )}
                  <Link prefetch={false} href={`/practice/${p.practiceCode}`} style={{ color: C.cyan, textDecoration: 'none', fontWeight: 700, fontSize: 13.5, lineHeight: 1.2 }}>{p.name}</Link>
                  <div style={{ fontSize: 10, color: C.faint, fontFamily: 'ui-monospace, monospace', fontWeight: 600, letterSpacing: 0.3, marginTop: 3, lineHeight: 1 }}>{p.practiceCode}</div>
                  {p.assignedAwayTo && (
                    <div style={{ fontSize: 11, color: C.violet, fontWeight: 700, marginTop: 4 }}>
                      → {p.assignedAwayTo.name} <span style={{ color: C.dim, fontWeight: 500 }}>({p.assignedAwayTo.role})</span>
                    </div>
                  )}
                </td>
                <td style={{ ...td, color: C.text, fontWeight: 700, fontSize: 13 }}>{p.state ?? '—'}</td>
                <td style={{ ...tdLeft, color: C.dim, fontSize: 13 }}>{p.specialty ?? '—'}</td>
                <td style={{ ...td, color: C.dim, fontSize: 13 }}>{p.sex ?? '—'}</td>
                <td style={{ ...tdLeft, color: C.dim, fontSize: 12 }}>{p.orgName ?? '—'}</td>
                <td style={{ ...td, color: p.risk ? C.text : C.faint, fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{p.risk ?? '—'}</td>
                <td style={{ ...td, color: p.paymentAdj ? C.text : C.faint, fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{p.paymentAdj ?? '—'}</td>
                <td style={{ ...tdLeft, fontSize: 12 }}>{sourceBadge(p.source)}</td>
                {isSuperAdmin && (
                  <td style={{ ...tdLeft, fontSize: 12, minWidth: 170 }}>
                    {p.allocatedTo
                      ? <span className="leads-company-name">{p.allocatedTo}</span>
                      : <span className="leads-unassigned">Unassigned</span>}
                  </td>
                )}
                <td style={{ ...tdLeft, color: C.dim, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{fmtDateTime(p.lastDialed)}</td>
                <td style={{ ...tdLeft, color: C.dim, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{fmtDateTime(p.allocatedOn)}</td>
                <td style={{ ...tdLeft, fontSize: 12 }}>{statusBadge(p.status)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={15} style={{ ...tdLeft, color: C.faint, padding: 24 }}>No leads match these filters. Clear them to see the full pool.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 13, color: C.dim, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>
            {filtered.length === 0 ? 'Showing 0 leads' : `Showing ${pageStart + 1}-${Math.min(pageStart + pageSize, filtered.length)} of ${filtered.length} leads`}
          </span>
          {isSuperAdmin && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.text, fontWeight: 700 }}>
              Rows per page
              <select
                aria-label="Rows per page"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
                style={{ ...input, padding: '6px 28px 6px 9px' }}
              >
                {[20, 50, 100, 200].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            style={{ ...btnGhost, opacity: safePage <= 1 ? 0.5 : 1 }}
          >
            Previous
          </button>
          {getPageNumbers(safePage, totalPages).map((n, i) =>
            n === '…' ? (
              <span key={`ellipsis-${i}`} style={{ padding: '0 4px', color: C.faint }}>…</span>
            ) : (
              <button
                key={n}
                onClick={() => setPage(n)}
                style={{
                  ...btnGhost,
                  minWidth: 32,
                  padding: '6px 0',
                  ...(n === safePage
                    ? { background: C.green, color: '#fff', borderColor: C.green, fontWeight: 700 }
                    : {}),
                }}
              >
                {n}
              </button>
            )
          )}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            style={{ ...btnGhost, opacity: safePage >= totalPages ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )

  // ---- small components ----
  function LabeledSelect({ label, options }: { label: string; options: string[] }) {
    return (
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, padding: '6px 12px', background: C.panelAlt }}>
        <div style={{ fontSize: 10, color: C.faint, letterSpacing: 0.5 }}>{label}</div>
        <select disabled style={{ ...input, border: 'none', background: 'transparent', padding: '4px 0', width: '100%' }}>
          {options.map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>
    )
  }
}

// Format an ISO timestamp as "12 Sep 2026, 3:04 PM" (blank if none).
function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

// Source badge: where the lead came from — Allocated (Super Admin) or Uploaded (company).
function sourceBadge(source?: string | null) {
  const s = (source ?? '').trim()
  if (!s) return <span style={{ color: 'var(--muted-2)' }}>—</span>
  const isAllocated = s.toLowerCase().includes('alloc')
  const color = isAllocated ? 'var(--purple)' : 'var(--c-transfers)' // violet vs cyan
  const label = isAllocated ? 'Allocated' : 'Uploaded'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
        color, border: `1px solid ${color}`, borderRadius: 999,
        padding: '4px 12px', background: `color-mix(in srgb, ${color} 15%, transparent)`, lineHeight: 1,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        {label}
      </span>
    </span>
  )
}

// Colored status badge. Maps the agent's chosen action to a colored pill.
function statusBadge(status?: string | null) {
  const s = (status ?? '').trim()
  if (!s) return <span style={{ color: 'var(--muted-2)' }}>—</span>
  const key = s.toLowerCase()
  let color = 'var(--muted)' // default grey
  if (key.includes('sold')) color = 'var(--ok)'
  else if (key.includes('clos')) color = 'var(--accent)'
  else if (key.includes('follow')) color = 'var(--warn)'
  else if (key.includes('interest')) color = 'var(--c-transfers)'
  else if (key.includes('not interest') || key.includes('dnc')) color = 'var(--danger)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
      color, border: `1px solid ${color}`, borderRadius: 999,
      padding: '4px 12px', background: `color-mix(in srgb, ${color} 15%, transparent)`, lineHeight: 1,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {s}
    </span>
  )
}

function SampleTag({ note }: { note?: string }) {
  return (
    <span title={note} style={{ fontSize: 9, color: 'var(--muted-2)', border: '1px solid var(--border-dim)', borderRadius: 4, padding: '2px 6px', alignSelf: 'center' }}>
      sample
    </span>
  )
}

// ---- shared styles ----
const panel: React.CSSProperties = { background: C.panel, borderWidth: 1, borderStyle: 'solid', borderColor: C.line, borderRadius: 8, padding: 18 }
const input: React.CSSProperties = { background: C.panelAlt, color: C.text, borderWidth: 1, borderStyle: 'solid', borderColor: C.line, borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: 500 }
const btnPrimary: React.CSSProperties = { background: C.blue, color: '#fff', borderWidth: 0, borderStyle: 'none', borderColor: 'transparent', borderRadius: 6, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const btnGhost: React.CSSProperties = { background: 'transparent', color: C.text, borderWidth: 1, borderStyle: 'solid', borderColor: C.line, borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 650, cursor: 'pointer' }
const th: React.CSSProperties = { padding: '14px 16px', textAlign: 'center', fontSize: 11, fontWeight: 800, color: C.text, textTransform: 'uppercase', letterSpacing: 0.7, whiteSpace: 'nowrap' }
const thLeft: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '16px', textAlign: 'center' }
const tdLeft: React.CSSProperties = { padding: '16px', textAlign: 'left' }

function pill(active: boolean): React.CSSProperties {
  return {
    fontSize: 12, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', userSelect: 'none',
    borderWidth: 1, borderStyle: 'solid', borderColor: active ? C.blue : C.line,
    background: active ? 'rgba(var(--accent-rgb),0.15)' : 'transparent',
    color: active ? C.text : C.dim,
    fontWeight: active ? 700 : 500,
  }
}
