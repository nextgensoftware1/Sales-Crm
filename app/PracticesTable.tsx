'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Inbox, Search, Sparkles, TimerReset } from 'lucide-react'
import { allocatePractices, softDeleteLeads } from './actions'
import { assignLeadsToAgent } from './assign-actions'
import { unpackRows, type PackedRows } from '../lib/lead-pack'
import { queryLeadPage, refreshLeadSnapshot } from './leads-page-actions' // ← CHANGED: + refreshLeadSnapshot
import { markLeadsChanged } from '../lib/leads-fresh' // ← ADDED
import { formatCalendarDate } from '../lib/assigned-dates'
import MultiSelectFilter from './MultiSelectFilter'
import WorkspacePanelToggle, { useWorkspacePanel } from './WorkspacePanelToggle'
import {
  SIGNALS, ZONE_KEYS, DEFAULT_LEAD_FILTERS, toSpecialtyList, filterLeads, leadOverview,
  type LeadRow, type LeadFilters, type LeadOverview, type ZoneKey,
} from '../lib/lead-filters'

type Practice = LeadRow

type Company = { id: string; slug: string; name: string }

type Props = {
  lazyOptions?: boolean
  practices?: Practice[]
  // Same rows, sent with each field name once (see lib/lead-pack.ts).
  packedPractices?: PackedRows
  // Server-paged mode: only the visible page is sent; other pages and filter
  // results come from app/leads-page-actions.ts (see lib/lead-snapshots.ts).
  serverPaging?: {
    snapshotId: string
    overview: LeadOverview
    rows: Practice[]
    codes?: string[]
    pageSize: number
    stale?: boolean // ← ADDED: opened from a recent snapshot; refresh in the background
  }
  companies?: Company[]
  isSuperAdmin?: boolean
  currentUser?: { full_name: string; role: string; company: string } | null
  viewerUserId?: string
  canAssign?: boolean
  myAgents?: { id: string; full_name: string; role: string }[]
  myAssignedCodes?: string[]
  newLeadCodes?: string[]      // practices from the most recent upload batch
  workedLeadCodes?: string[]   // practices with any lead_activity entries
  viewerRole?: string
  completedWorksheetCount?: number
}
const CATEGORY_SIGNAL_KEYS = new Set(['ccm', 'rcmFit', 'mips'])
const ADVANCED_SIGNALS = SIGNALS.filter((signal) => !CATEGORY_SIGNAL_KEYS.has(signal.key))
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

// Signals, zones, date helpers, filtering and summary counts live in
// lib/lead-filters.ts so the server can apply the exact same rules.

type PersistedLeadFilters = {
  search: string
  stateFilter: string
  specialtyFilter: string[] | string   // a list now; older saved filters held one value
  dispositionFilter: string
  companyFilter: string
  zoneFilter: ZoneKey | ''
  activeSignals: string[]
  assignedView: 'all' | 'mine'
  poolTab: string
  sourceTab: 'All' | 'Allocated' | 'Uploaded'
  catTab: string
  enumTypeFilter: string
  lastUpdatedFrom: string
  lastUpdatedTo: string
  enumDateFrom: string
  enumDateTo: string
  assignedDateFilter: string
}

const LEAD_FILTERS_STORAGE_KEY = 'lead-management-filters-v1'

export default function PracticesTable({ practices: practicesProp, packedPractices, serverPaging, companies: initialCompanies = [], isSuperAdmin = false, canAssign = false, myAgents: initialAgents = [], myAssignedCodes = [], newLeadCodes = [], workedLeadCodes = [], lazyOptions = false, viewerRole = '', completedWorksheetCount, viewerUserId }: Props) {
  const router = useRouter()
  const [panelOpen, togglePanel] = useWorkspacePanel()
  const practices = useMemo<Practice[]>(
    () => (serverPaging ? [] : packedPractices ? unpackRows<Practice>(packedPractices) : practicesProp ?? []),
    [serverPaging, packedPractices, practicesProp],
  )
  // Server-paged mode state (unused in legacy mode).
  const [serverSnapshotId, setServerSnapshotId] = useState(serverPaging?.snapshotId ?? '')
  const [serverOverview, setServerOverview] = useState<LeadOverview | null>(serverPaging?.overview ?? null)
  const canFilterAssignedDate = ['company_admin', 'manager', 'team_lead', 'agent', 'closer'].includes(viewerRole)
  const filtersStorageKey = `${LEAD_FILTERS_STORAGE_KEY}:${viewerUserId ?? 'unknown'}`
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
  const [specialtyFilter, setSpecialtyFilter] = useState<string[]>([])   // several at once
  const [dispositionFilter, setDispositionFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [zoneFilter, setZoneFilter] = useState<ZoneKey | ''>('')
  const companyFilterOptions = useMemo(() => {
    const registered = new Map<string, string>()
    for (const company of companies) registered.set(company.id, company.name)
    // Keep allocated companies available while the lazy registered-company
    // request is loading, and tolerate historical allocations whose company
    // has since been deactivated or removed from the normal company list.
    const leadCompanies = serverPaging
      ? serverOverview?.leadCompanies ?? []
      : practices.flatMap((practice) => practice.allocatedCompanies ?? [])
    for (const company of leadCompanies) registered.set(company.id, company.name)
    return Array.from(registered, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [companies, practices, serverPaging, serverOverview])
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
  // Only meaningful — and only shown — when catTab === 'Credentialing'.
  const [enumTypeFilter, setEnumTypeFilter] = useState('')
  const [lastUpdatedFrom, setLastUpdatedFrom] = useState('')
  const [lastUpdatedTo, setLastUpdatedTo] = useState('')
  const [enumDateFrom, setEnumDateFrom] = useState('')
  const [enumDateTo, setEnumDateTo] = useState('')
  const [assignedDateFilter, setAssignedDateFilter] = useState('')
  const [filtersRestored, setFiltersRestored] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(filtersStorageKey)
      if (stored) {
        const filters = JSON.parse(stored) as Partial<PersistedLeadFilters>
        if (typeof filters.search === 'string') setSearch(filters.search)
        if (typeof filters.stateFilter === 'string') setStateFilter(filters.stateFilter)
        if (filters.specialtyFilter !== undefined) setSpecialtyFilter(toSpecialtyList(filters.specialtyFilter))
        if (typeof filters.dispositionFilter === 'string') setDispositionFilter(filters.dispositionFilter)
        if (typeof filters.companyFilter === 'string') setCompanyFilter(filters.companyFilter)
        if (filters.zoneFilter !== undefined && (filters.zoneFilter === '' || ZONE_KEYS.includes(filters.zoneFilter))) setZoneFilter(filters.zoneFilter)
        if (Array.isArray(filters.activeSignals)) {
         setActiveSignals(new Set(filters.activeSignals.filter(value => ADVANCED_SIGNALS.some(signal => signal.key === value))))
        }
        if (filters.assignedView === 'all' || filters.assignedView === 'mine') setAssignedView(filters.assignedView)
        if (typeof filters.poolTab === 'string') setPoolTab(filters.poolTab)
        if (filters.sourceTab === 'All' || filters.sourceTab === 'Allocated' || filters.sourceTab === 'Uploaded') setSourceTab(filters.sourceTab)
        if (typeof filters.catTab === 'string') setCatTab(filters.catTab)
        if (typeof filters.enumTypeFilter === 'string') setEnumTypeFilter(filters.enumTypeFilter)
        if (typeof filters.lastUpdatedFrom === 'string') setLastUpdatedFrom(filters.lastUpdatedFrom)
        if (typeof filters.lastUpdatedTo === 'string') setLastUpdatedTo(filters.lastUpdatedTo)
        if (typeof filters.enumDateFrom === 'string') setEnumDateFrom(filters.enumDateFrom)
        if (typeof filters.enumDateTo === 'string') setEnumDateTo(filters.enumDateTo)
        if (typeof filters.assignedDateFilter === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(filters.assignedDateFilter)) setAssignedDateFilter(filters.assignedDateFilter)
      }
    } catch {
    } finally {
      setFiltersRestored(true)
    }
  }, [filtersStorageKey])

  useEffect(() => {
    if (!filtersRestored) return
    const filters: PersistedLeadFilters = {
      search, stateFilter, specialtyFilter, dispositionFilter, companyFilter, zoneFilter,
      activeSignals: Array.from(activeSignals), assignedView, poolTab, sourceTab, catTab,
      enumTypeFilter, lastUpdatedFrom, lastUpdatedTo, enumDateFrom, enumDateTo, assignedDateFilter,
    }
    try {
      localStorage.setItem(filtersStorageKey, JSON.stringify(filters))
    } catch {
      // Keep filtering usable when browser storage is unavailable.
    }
  }, [filtersRestored, filtersStorageKey, search, stateFilter, specialtyFilter, dispositionFilter, companyFilter, zoneFilter, activeSignals, assignedView, poolTab, sourceTab, catTab, enumTypeFilter, lastUpdatedFrom, lastUpdatedTo, enumDateFrom, enumDateTo, assignedDateFilter])

  // Dropdown options and summary-card numbers: computed here in legacy mode,
  // computed on the server (same function) in server-paged mode.
  const localOverview = useMemo(
    () => (serverPaging ? null : leadOverview(practices, { isSuperAdmin, newLeadSet, workedLeadSet, completedWorksheetCount })),
    [serverPaging, practices, isSuperAdmin, newLeadSet, workedLeadSet, completedWorksheetCount],
  )
  const overview = (localOverview ?? serverOverview)!
  const { states, specialties, dispositions, zoneCounts, summaryCounts } = overview

  const summaryCards = useMemo(() => {
    if (isSuperAdmin) return [
      { label: 'Platform Leads', value: summaryCounts.total, tone: 'blue' },
      { label: 'Unallocated', value: summaryCounts.unassigned, tone: 'amber' },
      { label: 'Allocated', value: summaryCounts.assigned, tone: 'purple' },
      { label: 'Worked', value: summaryCounts.worked, tone: 'cyan' },
      { label: 'Qualified', value: summaryCounts.qualified, tone: 'green' },
    ]
    if (viewerRole === 'agent' || viewerRole === 'closer') return [
      { label: viewerRole === 'closer' ? 'My Closer Queue' : 'My Lead Queue', value: summaryCounts.total, tone: 'blue' },
      { label: 'New Leads', value: summaryCounts.new, tone: 'amber' },
      { label: 'Worked', value: summaryCounts.worked, tone: 'purple' },
      { label: 'Follow-ups', value: summaryCounts.followUp, tone: 'cyan' },
      { label: 'Qualified', value: summaryCounts.qualified, tone: 'green' },
    ]
    return [
      { label: 'Company Leads', value: summaryCounts.total, tone: 'blue' },
      { label: 'Ready to Assign', value: summaryCounts.unassigned, tone: 'amber' },
      { label: 'Assigned by Me', value: summaryCounts.assigned, tone: 'purple' },
      { label: 'Worked', value: summaryCounts.worked, tone: 'cyan' },
      { label: 'Qualified', value: summaryCounts.qualified, tone: 'green' },
    ]
  }, [isSuperAdmin, summaryCounts, viewerRole])

  const toggleSignal = (key: string) => {
    setActiveSignals((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Current filters as one object (same values the browser filtered by before).
  const filters = useMemo<LeadFilters>(() => ({
    ...DEFAULT_LEAD_FILTERS,
    search, stateFilter, zoneFilter, specialtyFilter, dispositionFilter,
    activeSignals: Array.from(activeSignals), catTab, sourceTab, poolTab, assignedView, companyFilter,
    enumTypeFilter, lastUpdatedFrom, lastUpdatedTo, enumDateFrom, enumDateTo, assignedDateFilter,
  }), [search, stateFilter, zoneFilter, specialtyFilter, dispositionFilter, activeSignals, catTab, sourceTab, poolTab, assignedView, companyFilter, enumTypeFilter, lastUpdatedFrom, lastUpdatedTo, enumDateFrom, enumDateTo, assignedDateFilter])
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters])

  // Legacy mode: filter the full list in the browser.
  const filtered = useMemo(
    () => (serverPaging ? [] : filterLeads(practices, filters, { isSuperAdmin, prioritySet, newLeadSet, workedLeadSet })),
    [serverPaging, practices, filters, isSuperAdmin, prioritySet, newLeadSet, workedLeadSet],
  )

  const tableColumnCount = 10 + ((isSuperAdmin || canAssign) ? 1 : 0) + (isSuperAdmin ? 1 : 0)

  // Real client-side pagination over the already-fetched/filtered array —
  // no new queries, same `filtered` rows, just windowed into pages instead
  // of rendering the entire result set at once.
  const [pageSize, setPageSize] = useState(serverPaging?.pageSize ?? (isSuperAdmin ? 20 : 8))
  const [page, setPage] = useState(1)

  // ---- server-paged mode: the visible page comes from the server ----
  // `codes` = every matching lead code in order (for counts, select-all and
  // range-select); `rows` = only the leads on the current page.
  const [serverView, setServerView] = useState(() => ({
    key: serverPaging ? JSON.stringify(DEFAULT_LEAD_FILTERS) : '',
    snapshotId: serverPaging?.snapshotId ?? '',
    codes: serverPaging?.codes ?? [],
    rows: serverPaging?.rows ?? [],
    page: 1,
    pageSize: serverPaging?.pageSize ?? 0,
  }))
  const [serverLoading, setServerLoading] = useState(false)
  const [serverError, setServerError] = useState('')
  const requestSeq = useRef(0)

  // ← ADDED: background refresh after an instant (snapshot) page open.
  // "Updating…" shows until the refresh for this page load has finished.
  const [refreshDoneFor, setRefreshDoneFor] = useState('')
  const refreshing = Boolean(serverPaging?.stale) && refreshDoneFor !== serverPaging?.snapshotId
  const refreshedFor = useRef('')
  useEffect(() => {
    const incoming = serverPaging?.snapshotId ?? ''
    if (!incoming || refreshedFor.current === incoming) return
    // Any newer page load (e.g. after allocating) makes an older background
    // refresh irrelevant — its result is ignored below.
    refreshedFor.current = incoming
    if (!serverPaging?.stale) return
    refreshLeadSnapshot().then((res) => {
      if (refreshedFor.current !== incoming) return // a newer page load replaced this one
      if (res.ok) {
        // A new snapshot id makes the effect below re-read the current
        // filters and page from the fresh data.
        setServerOverview(res.overview)
        setServerSnapshotId(res.snapshotId)
      }
    }).catch(() => { /* keep showing the recent data; a reload fetches fresh */ })
      .finally(() => setRefreshDoneFor(incoming))
    // Runs once per page load (StrictMode's second run is skipped by refreshedFor).
  }, [serverPaging?.snapshotId, serverPaging?.stale])

  // After an action calls router.refresh(), the page sends a new snapshot.
  const incomingSnapshotId = serverPaging?.snapshotId
  useEffect(() => {
    if (!serverPaging || serverPaging.snapshotId === serverSnapshotId) return
    setServerSnapshotId(serverPaging.snapshotId)
    setServerOverview(serverPaging.overview)
    setServerView({
      key: JSON.stringify(DEFAULT_LEAD_FILTERS), snapshotId: serverPaging.snapshotId,
      codes: serverPaging.codes ?? [], rows: serverPaging.rows, page: 1, pageSize: serverPaging.pageSize,
    })
    // Only a new snapshot id matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingSnapshotId])

  useEffect(() => {
    if (!serverPaging || !filtersRestored) return
    const wantCodes = serverView.key !== filtersKey || serverView.snapshotId !== serverSnapshotId
    if (!wantCodes && serverView.page === page && serverView.pageSize === pageSize) return
    const seq = ++requestSeq.current
    // Filter changes (e.g. typing in search) wait briefly; page changes don't.
    const timer = setTimeout(async () => {
      setServerLoading(true)
      try {
        const res = await queryLeadPage({
          snapshotId: serverSnapshotId, filters, page, pageSize, wantCodes,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
        if (seq !== requestSeq.current) return   // a newer request replaced this one
        if (!res.ok) { setServerError(res.message); return }
        if (res.overview) setServerOverview(res.overview)
        if (res.snapshotId !== serverSnapshotId) setServerSnapshotId(res.snapshotId)
        setServerView((prev) => ({
          key: filtersKey, snapshotId: res.snapshotId, codes: res.codes ?? prev.codes,
          rows: res.rows as Practice[], page: res.page, pageSize: res.pageSize,
        }))
        setServerError('')
        if (res.page !== page) setPage(res.page)
      } catch {
        if (seq === requestSeq.current) setServerError('Could not load leads. Please try again.')
      } finally {
        if (seq === requestSeq.current) setServerLoading(false)
      }
    }, wantCodes ? 200 : 0)
    return () => clearTimeout(timer)
  }, [serverPaging, filtersRestored, filters, filtersKey, page, pageSize, serverSnapshotId, serverView])

  const filteredCodes = useMemo(
    () => (serverPaging ? serverView.codes : filtered.map((p) => p.practiceCode)),
    [serverPaging, serverView.codes, filtered],
  )
  const filteredCount = filteredCodes.length
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageRows = serverPaging ? serverView.rows : filtered.slice(pageStart, pageStart + pageSize)
  // Any change to the filtered set (search, a filter, a tab) should land
  // back on page 1 rather than leaving the user stranded past the end.
  useEffect(() => { setPage(1) }, [search, stateFilter, zoneFilter, specialtyFilter, dispositionFilter, activeSignals, catTab, sourceTab, poolTab, assignedView, companyFilter, enumTypeFilter, lastUpdatedFrom, lastUpdatedTo, enumDateFrom, enumDateTo, assignedDateFilter])

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
  const allSelected = filteredCount > 0 && filteredCodes.every((code) => selected.has(code))
  const toggleSelectAll = () => {
    void loadOptions()
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const code of filteredCodes) next.delete(code)   // clear filtered
      } else {
        for (const code of filteredCodes) next.add(code)      // select all filtered
      }
      return next
    })
  }

  // Select rows N..M (1-based, inclusive) of the currently filtered list.
  const applyRange = () => {
    void loadOptions()
    const total = filteredCount
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
        if (filteredCodes[i]) next.add(filteredCodes[i])
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
      markLeadsChanged() // ← ADDED: show this change immediately (no instant snapshot)
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
      markLeadsChanged() // ← ADDED: show this change immediately (no instant snapshot)
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
      markLeadsChanged() // ← ADDED: show this change immediately (no instant snapshot)
      router.refresh()
    }
  }

  const resetFilters = () => {
    setCompanyFilter('')
    setSearch(''); setStateFilter(''); setZoneFilter(''); setSpecialtyFilter([]); setDispositionFilter(''); setActiveSignals(new Set()); setCatTab('All Categories'); setSourceTab('All'); setPoolTab('All Leads'); setAssignedView('all'); setEnumTypeFilter(''); setLastUpdatedFrom(''); setLastUpdatedTo(''); setEnumDateFrom(''); setEnumDateTo(''); setAssignedDateFilter('')
  }

  const activeFilterCount = [
    search, stateFilter, zoneFilter, specialtyFilter.length ? 'specialty' : '', dispositionFilter, companyFilter,
    enumTypeFilter, lastUpdatedFrom, lastUpdatedTo, enumDateFrom, enumDateTo, assignedDateFilter,
    catTab !== 'All Categories' ? catTab : '', sourceTab !== 'All' ? sourceTab : '',
    poolTab !== 'All Leads' ? poolTab : '', assignedView !== 'all' ? assignedView : '',
  ].filter(Boolean).length + activeSignals.size

  return (
    <div className="leads-engine" style={{ color: C.text, fontFamily: 'var(--font-sans), ui-sans-serif, system-ui, sans-serif' }}>
      <div className={'lead-engine-workspace' + (panelOpen ? '' : ' panel-collapsed')}>
        <aside id="lead-engine-panel" className="lead-engine-subnav" aria-label="Lead views and timezone filters">
          <WorkspacePanelToggle open={panelOpen} onToggle={togglePanel} panelId="lead-engine-panel" label="Leads" />
          <div className="lead-engine-subnav-head">
            <span className="lead-engine-subnav-kicker">Workspace</span>
            <h2>Leads</h2>
            <p>Find the right queue quickly.</p>
          </div>

          <label className="lead-engine-subnav-search">
            <Search size={15} strokeWidth={2} aria-hidden="true" />
            <input
              aria-label="Search leads from sidebar"
              placeholder="Name, NPI, phone, city…" title="Search by provider name, NPI / lead code, phone number, email, city, ZIP, specialty, state, status or contact person"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <div className="lead-engine-subnav-tabs" aria-label="Lead status views">
            {([
              { key: 'All Leads', label: 'All', count: summaryCounts.total, icon: Inbox },
              { key: 'New Leads', label: 'New', count: overview.newCount, icon: Sparkles },
              { key: 'Worked Leads', label: 'Worked', count: overview.workedCount, icon: TimerReset },
            ] as const).map((item) => {
              const Icon = item.icon
              const active = poolTab === item.key
              return (
                <button
                  type="button"
                  key={item.key}
                  className={active ? 'active' : ''}
                  aria-pressed={active}
                  onClick={() => setPoolTab(item.key)}
                >
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </button>
              )
            })}
          </div>

          <div className="lead-engine-subnav-section">
            <div className="lead-engine-subnav-label">
              <span>Timezone queues</span>
              {zoneFilter && <button type="button" onClick={() => setZoneFilter('')}>Clear</button>}
            </div>
            <div className="lead-engine-zone-list">
              {ZONE_KEYS.map((zone) => {
                const active = zoneFilter === zone
                const count = zoneCounts[zone]
                return (
                  <button
                    type="button"
                    key={zone}
                    className={active ? 'active' : ''}
                    aria-pressed={active}
                    disabled={count === 0 && !active}
                    onClick={() => setZoneFilter(active ? '' : zone)}
                  >
                    <span className="lead-engine-zone-dot" aria-hidden="true" />
                    <span>{zone === 'Other' ? 'Other zones' : `${zone} zone`}</span>
                    <strong>{count}</strong>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="lead-engine-subnav-tip">
            <strong>Quick tip</strong>
            <span>Choose a queue here, then refine it with the filters beside it.</span>
          </div>
        </aside>

        <div className="lead-engine-stage">
      <section className="lead-summary-grid" aria-label="Lead pool summary">
        {summaryCards.map((item) => (
          <div className={`lead-summary-card tone-${item.tone}`} key={item.label}>
            <span className="lead-summary-icon" aria-hidden="true" />
            <span>
              <strong>{item.value}</strong>
              <small>{item.label}</small>
            </span>
          </div>
        ))}
      </section>

      {/* ---- Lead Pool bar ---- */}
      <section style={{ ...panel, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 className="leads-section-title">Lead Pool <span className="leads-section-count">({filteredCount} leads)</span>
            {refreshing && <span role="status" className="leads-section-count" style={{ marginLeft: 8, fontSize: 12 }}>· Updating…</span>}{/* ← ADDED */}
          </h2>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>Explore and manage your lead pool</div>
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
          {['All Categories', 'MIPS', 'RCM', 'CCM', 'Credentialing'].map((t) => (
            <button type="button" aria-pressed={catTab === t} key={t} onClick={() => setCatTab(t)} style={{ ...pill(catTab === t), cursor: 'pointer' }}>{t}</button>
          ))}
        </div>
        {catTab === 'Credentialing' && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.line}` }}>
            <label className="filter-control"><span>Enumeration Type</span>
              <select value={enumTypeFilter} onChange={(e) => setEnumTypeFilter(e.target.value)} style={input}>
                <option value="">All Types</option>
                <option value="NPI-1">NPI-1</option>
                <option value="NPI-2">NPI-2</option>
              </select>
            </label>
            <label className="filter-control"><span>NPPES Last Updated</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input aria-label="NPPES Last Updated from" type="date" value={lastUpdatedFrom} onChange={(e) => setLastUpdatedFrom(e.target.value)} style={{ ...input, width: 145, minWidth: 0 }} />
                <span style={{ color: C.faint, fontSize: 11, textTransform: 'none' }}>to</span>
                <input aria-label="NPPES Last Updated to" type="date" value={lastUpdatedTo} onChange={(e) => setLastUpdatedTo(e.target.value)} style={{ ...input, width: 145, minWidth: 0 }} />
              </div>
            </label>
            <label className="filter-control"><span>NPPES Enumeration Date</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input aria-label="NPPES Enumeration Date from" type="date" value={enumDateFrom} onChange={(e) => setEnumDateFrom(e.target.value)} style={{ ...input, width: 145, minWidth: 0 }} />
                <span style={{ color: C.faint, fontSize: 11, textTransform: 'none' }}>to</span>
                <input aria-label="NPPES Enumeration Date to" type="date" value={enumDateTo} onChange={(e) => setEnumDateTo(e.target.value)} style={{ ...input, width: 145, minWidth: 0 }} />
              </div>
            </label>
          </div>
        )}
      </section>

      {/* ---- Quick and advanced filters ---- */}
      <section style={{ ...panel, marginBottom: 14 }}>
        <div className="filter-section-head">
          <div>
            <h2 className="leads-section-title">Refine Leads</h2>
            <p>Narrow the selected queue by state, specialty, disposition, or advanced criteria.</p>
          </div>
          <span className="filter-result-count">{filteredCount} result{filteredCount === 1 ? '' : 's'}{serverLoading ? ' · loading…' : ''}</span>
          {serverError && <span role="alert" style={{ color: 'var(--danger, #f66)', fontSize: 12 }}>{serverError}</span>}
        </div>
        <div className="quick-filter-row">
          <label className="filter-control"><span>State</span><select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={input}>
            <option value="">All States</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
          <div className="filter-control"><span>Specialty</span>
            <MultiSelectFilter label="Specialty" allLabel="All Specialties" options={specialties} selected={specialtyFilter}
              onChange={setSpecialtyFilter} style={input} searchPlaceholder="Search specialties…" />
          </div>
          <label className="filter-control"><span>Disposition</span><select value={dispositionFilter} onChange={(e) => setDispositionFilter(e.target.value)} style={input}>
            <option value="">All Dispositions</option>
            {dispositions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select></label>
          {canFilterAssignedDate && <label className="filter-control"><span>Assigned on</span>
            <input
              aria-label="Filter leads by assigned date"
              type="date"
              value={assignedDateFilter}
              onChange={event => setAssignedDateFilter(event.target.value)}
              style={{ ...input, minWidth: 145 }}
            />
          </label>}
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
  {/* <strong>Signals</strong> */}
  {ADVANCED_SIGNALS.map((s) => (
    <button type="button" aria-pressed={activeSignals.has(s.key)} key={s.key} onClick={() => toggleSignal(s.key)} style={pill(activeSignals.has(s.key))}>{s.label}</button>
  ))}
  {/* <SampleTag note="MIPS year / enrichment filters are display-only" /> */}
</div>
        </details>

        {activeFilterCount > 0 && (
          <div className="active-filter-row">
            <strong>Active filters</strong>
            {search && <button onClick={() => setSearch('')}>Search: {search} ×</button>}
            {zoneFilter && <button onClick={() => setZoneFilter('')}>{zoneFilter} Zone ×</button>}
            {stateFilter && <button onClick={() => setStateFilter('')}>{stateFilter} ×</button>}
            {specialtyFilter.map((value) => <button key={`specialty:${value}`} onClick={() => setSpecialtyFilter(specialtyFilter.filter((v) => v !== value))}>{value} ×</button>)}
            {dispositionFilter && <button onClick={() => setDispositionFilter('')}>{dispositionFilter} ×</button>}
            {companyFilter && <button onClick={() => setCompanyFilter('')}>{companyFilter === '__unassigned__' ? 'Not assigned' : companyFilterOptions.find((c) => c.id === companyFilter)?.name ?? 'Company'} ×</button>}
            {assignedDateFilter && <button onClick={() => setAssignedDateFilter('')}>Assigned on: {formatCalendarDate(assignedDateFilter)} ×</button>}
            {enumTypeFilter && <button onClick={() => setEnumTypeFilter('')}>Enumeration: {enumTypeFilter} ×</button>}
            {(lastUpdatedFrom || lastUpdatedTo) && <button onClick={() => { setLastUpdatedFrom(''); setLastUpdatedTo('') }}>Last updated: {lastUpdatedFrom || 'Any'} to {lastUpdatedTo || 'Any'} ×</button>}
            {(enumDateFrom || enumDateTo) && <button onClick={() => { setEnumDateFrom(''); setEnumDateTo('') }}>Enumeration date: {enumDateFrom || 'Any'} to {enumDateTo || 'Any'} ×</button>}
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
            <span style={{ fontSize: 11, color: C.faint }}>of {filteredCount}</span>
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
            <span style={{ fontSize: 11, color: C.faint }}>of {filteredCount}</span>
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
            {filteredCount === 0 && (
              <tr><td colSpan={tableColumnCount} style={{ ...tdLeft, color: C.faint, padding: 24 }}>No leads match these filters. Clear them to see the full pool.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 13, color: C.dim, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>
            {filteredCount === 0 ? 'Showing 0 leads' : `Showing ${pageStart + 1}-${Math.min(pageStart + pageSize, filteredCount)} of ${filteredCount} leads`}
          </span>
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
              {(isSuperAdmin ? [20, 50, 100, 200] : [8, 15, 50, 200]).map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
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
      </div>
    </div>
  )

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
