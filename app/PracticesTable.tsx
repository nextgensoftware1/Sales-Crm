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

type Company = { slug: string; name: string }

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

// The 7 boolean signal COLUMNS shown in the table (MIPS has its own column).
const COLUMN_SIGNALS: { key: keyof Practice; label: string }[] = [
  { key: 'ccm', label: 'CCM' },
  { key: 'pcm', label: 'PCM' },
  { key: 'awv', label: 'AWV' },
  { key: 'tcm', label: 'TCM' },
  { key: 'bhi', label: 'BHI' },
  { key: 'rpm', label: 'RPM' },
  { key: 'rcmFit', label: 'RCM Fit' },
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

export default function PracticesTable({ practices, companies: initialCompanies = [], isSuperAdmin = false, currentUser, canAssign = false, myAgents: initialAgents = [], myAssignedCodes = [], newLeadCodes = [], workedLeadCodes = [], lazyOptions = false }: Props) {
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

  // ---- REAL filter state ----
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [specialtyFilter, setSpecialtyFilter] = useState('')
  const [dispositionFilter, setDispositionFilter] = useState('')
  const [allocationFilter, setAllocationFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const allocatedCompanies = useMemo(() => {
    const companies = new Map<string, string>()
    for (const practice of practices) {
      for (const company of practice.allocatedCompanies ?? []) companies.set(company.id, company.name)
    }
    return Array.from(companies, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [practices])
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

  const toggleSignal = (key: string) => {
    setActiveSignals((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const filtered = useMemo(() => {
    const rows = practices.filter((p) => {
      if (isSuperAdmin) {
        const allocated = p.source === 'Allocated'
        if (allocationFilter === 'assigned' && !allocated) return false
        if (allocationFilter === 'unassigned' && allocated) return false
        if (companyFilter && !p.allocatedCompanies?.some(company => company.id === companyFilter)) return false
      }
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.practiceCode.toLowerCase().includes(search.toLowerCase())) return false
      if (stateFilter && p.state !== stateFilter) return false
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
  }, [practices, search, stateFilter, specialtyFilter, dispositionFilter, activeSignals, catTab, sourceTab, poolTab, newLeadSet, workedLeadSet, assignedView, prioritySet, hasPriority, isSuperAdmin, allocationFilter, companyFilter])

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
  useEffect(() => { setPage(1) }, [search, stateFilter, specialtyFilter, dispositionFilter, activeSignals, catTab, sourceTab, poolTab, assignedView, allocationFilter, companyFilter])

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
      next.has(code) ? next.delete(code) : next.add(code)
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
    setAllocationFilter(''); setCompanyFilter('')
    setSearch(''); setStateFilter(''); setSpecialtyFilter(''); setDispositionFilter(''); setActiveSignals(new Set()); setCatTab('All Categories'); setSourceTab('All')
  }

  return (
    <div style={{ color: C.text, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* ---- Distribution Console (placeholder) ---- */}
      <section style={{ ...panel, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Leads Distribution Console</h2>
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
          {ZONE_KEYS.map((z) => (
            <div key={z} style={{ border: `1px solid ${C.line}`, borderRadius: 0, padding: 12, background: C.panelAlt, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.dim }}>
                <span style={{ letterSpacing: 0.5 }}>{z} ZONE</span>
                <span style={{ color: C.amber }}>{zoneCounts[z]}</span>
              </div>
              <input disabled value={zoneCounts[z]} style={{ ...input, width: '100%', minWidth: 0, boxSizing: 'border-box', marginTop: 8, textAlign: 'center' }} />
            </div>
          ))}
        </div>
        <div className="grid-console">
          {!isSuperAdmin && (
            <LabeledSelect label="TARGET AGENT" options={['— Select Agent / Closer —']} />
          )}
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 0, padding: '6px 12px', background: C.panelAlt }}>
            <div style={{ fontSize: 10, color: C.faint, letterSpacing: 0.5 }}>SPECIALTY</div>
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
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 0, padding: '8px 12px', background: C.panelAlt }}>
            <div style={{ fontSize: 10, color: C.faint, letterSpacing: 0.5 }}>PRACTICE SIZE</div>
            <div style={{ fontSize: 13, marginTop: 4, color: C.dim }}>
              {filtered.length === 0 ? '0' : `${pageStart + 1} to ${Math.min(pageStart + pageSize, filtered.length)}`}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Lead Pool bar ---- */}
      <section style={{ ...panel, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Lead Pool <span style={{ color: C.dim, fontWeight: 400 }}>({filtered.length} leads)</span></h2>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>Explore and manage your lead pool</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['All Leads', 'New Leads', 'Worked Leads'] as const).map((t) => {
            let count: number | null = null
            if (t === 'New Leads')    count = newLeadSet.size
            if (t === 'Worked Leads') count = workedLeadSet.size
            return (
              <span key={t} onClick={() => setPoolTab(t)} style={{ ...pill(poolTab === t), cursor: 'pointer' }}>
                {t}{count !== null ? ` (${count})` : ''}
              </span>
            )
          })}
        </div>
        {hasPriority && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              onClick={() => setAssignedView('mine')}
              style={{ ...pill(assignedView === 'mine'), cursor: 'pointer', borderColor: C.amber, color: assignedView === 'mine' ? C.text : C.amber }}
            >
              ★ My assigned ({prioritySet.size})
            </span>
            <span
              onClick={() => setAssignedView('all')}
              style={{ ...pill(assignedView === 'all'), cursor: 'pointer' }}
            >
              All company
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['All', 'Allocated', 'Uploaded'] as const).map((t) => (
            <span key={t} onClick={() => setSourceTab(t)}
              style={{
                ...pill(sourceTab === t), cursor: 'pointer',
                borderColor: sourceTab === t ? (t === 'Allocated' ? 'var(--purple)' : t === 'Uploaded' ? 'var(--c-transfers)' : C.blue) : C.line,
              }}>
              {t === 'All' ? 'All Sources' : t}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['All Categories', 'MIPS', 'RCM', 'CCM'].map((t) => (
            <span key={t} onClick={() => setCatTab(t)} style={{ ...pill(catTab === t), cursor: 'pointer' }}>{t}</span>
          ))}
        </div>
      </section>

      {/* ---- Filter bar (real: search, state, signals) ---- */}
      <section style={{ ...panel, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Practice name or ID…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...input, minWidth: 220 }} />
          {isSuperAdmin && <>
            <label style={{ fontSize: 12, color: C.dim }}>Company assignment{' '}
              <select aria-label="Company assignment status" value={allocationFilter} style={input} onChange={e => {
                setAllocationFilter(e.target.value); setSourceTab('All'); setSelected(new Set())
                if (e.target.value === 'unassigned') setCompanyFilter('')
              }}>
                <option value="">All leads</option>
                <option value="assigned">Assigned to a company</option>
                <option value="unassigned">Not assigned to a company</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: C.dim }}>Assigned company{' '}
              <select aria-label="Filter by assigned company" value={companyFilter} style={input} onChange={e => {
                setCompanyFilter(e.target.value); setSourceTab('All'); setSelected(new Set())
                if (e.target.value) setAllocationFilter('assigned')
              }}>
                <option value="">All companies</option>
                {allocatedCompanies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </label>
          </>}
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={input}>
            <option value="">All States</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select disabled style={{ ...input, opacity: 0.6 }}><option>MIPS Year 2026</option></select>
          <select value={dispositionFilter} onChange={(e) => setDispositionFilter(e.target.value)} style={input}>
            <option value="">All Dispositions</option>
            {dispositions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select disabled style={{ ...input, opacity: 0.6 }}><option>Any Enrichment</option></select>
          <button onClick={resetFilters} style={btnGhost}>Reset</button>
          <SampleTag note="MIPS year / enrichment filters not wired" />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.dim }}>Filter by signal:</span>
          {SIGNALS.map((s) => (
            <span key={s.key as string} onClick={() => toggleSignal(s.key)}
              style={pill(activeSignals.has(s.key))}>
              {s.label}
            </span>
          ))}
        </div>
      </section>

      {/* ---- Allocation bar (real, Super Admin) ---- */}
      {isSuperAdmin && (
        <section style={{ ...panel, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderColor: C.blue }}>
          <strong style={{ fontSize: 14 }}>{selected.size} selected</strong>
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
        <section style={{ ...panel, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', borderColor: C.green }}>
          <strong style={{ fontSize: 14 }}>{selected.size} selected</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.dim }}>
            <span>Range</span>
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
                <td style={{ ...tdLeft, fontSize: 12 }}>{sourceBadge(p.source, p.allocatedTo)}</td>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: C.dim }}>
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
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 0, padding: '6px 12px', background: C.panelAlt }}>
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
function sourceBadge(source?: string | null, allocatedTo?: string | null) {
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
      {isAllocated && allocatedTo && (
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>→ {allocatedTo}</span>
      )}
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
    <span title={note} style={{ fontSize: 9, color: 'var(--muted-2)', border: '1px solid var(--border-dim)', borderRadius: 0, padding: '2px 6px', alignSelf: 'center' }}>
      sample
    </span>
  )
}

// ---- shared styles ----
const panel: React.CSSProperties = { background: C.panel, borderWidth: 1, borderStyle: 'solid', borderColor: C.line, borderRadius: 0, padding: 18 }
const input: React.CSSProperties = { background: C.panelAlt, color: C.text, borderWidth: 1, borderStyle: 'solid', borderColor: C.line, borderRadius: 0, padding: '8px 12px', fontSize: 13 }
const btnPrimary: React.CSSProperties = { background: C.blue, color: '#fff', borderWidth: 0, borderStyle: 'none', borderColor: 'transparent', borderRadius: 0, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }
const btnGhost: React.CSSProperties = { background: 'transparent', color: C.text, borderWidth: 1, borderStyle: 'solid', borderColor: C.line, borderRadius: 0, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
const th: React.CSSProperties = { padding: '14px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.6, whiteSpace: 'nowrap' }
const thLeft: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '16px', textAlign: 'center' }
const tdLeft: React.CSSProperties = { padding: '16px', textAlign: 'left' }

function pill(active: boolean): React.CSSProperties {
  return {
    fontSize: 12, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', userSelect: 'none',
    borderWidth: 1, borderStyle: 'solid', borderColor: active ? C.blue : C.line,
    background: active ? 'rgba(var(--accent-rgb),0.15)' : 'transparent',
    color: active ? C.text : C.dim,
  }
}
