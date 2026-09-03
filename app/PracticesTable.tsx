// 'use client'

// import { useState } from 'react'
// import { useRouter } from 'next/navigation'
// import { createSupabaseBrowser } from '../lib/supabase-browser'
// import { allocatePractices } from './actions'          // ← CHANGED: removed old supabase-client import; kept this

// type Practice = {
//   practiceCode: string
//   allocatedOn: string | null
//   status: string | null
//   name: string
//   state: string | null
//   specialty: string | null
//   ccm: boolean
//   pcm: boolean
//   awv: boolean
//   tcm: boolean
//   bhi: boolean
//   rpm: boolean
//   rcmFit: boolean
//   mipsByYear: Record<number, string>
// }

// type CurrentUser = { full_name: string; role: string; company: string } | null
// type Company = { slug: string; name: string }

// const SIGNALS: { key: keyof Practice; label: string }[] = [
//   { key: 'ccm', label: 'CCM' },
//   { key: 'pcm', label: 'PCM' },
//   { key: 'awv', label: 'AWV' },
//   { key: 'tcm', label: 'TCM' },
//   { key: 'bhi', label: 'BHI' },
//   { key: 'rpm', label: 'RPM' },
//   { key: 'rcmFit', label: 'RCM Fit' },
// ]
// const STATUS_COLORS: Record<string, string> = {
//   'New': '#6b7280',
//   'Interested': '#16a34a',
//   'Qualified': '#2563eb',
//   'Callback': '#d97706',
//   'No Answer': '#9ca3af',
//   'Voicemail': '#9ca3af',
//   'Not Interested': '#dc2626',
//   'DNC': '#dc2626',
// }
// export default function PracticesTable({
//   practices,
//   currentUser,
//   isSuperAdmin = false,
//   companies = [],
// }: {
//   practices: Practice[]
//   currentUser: CurrentUser
//   isSuperAdmin?: boolean
//   companies?: Company[]
// }) {
//   const router = useRouter()
//   const [stateFilter, setStateFilter] = useState('')
//   const [search, setSearch] = useState('')
//   const [year, setYear] = useState('2026')
//   const [activeSignals, setActiveSignals] = useState<Record<string, boolean>>({})

//   // ← CHANGED: allocation state (selection, target company, message)
//   const [selected, setSelected] = useState<Set<string>>(new Set())
//   const [targetCompany, setTargetCompany] = useState('')
//   const [allocMsg, setAllocMsg] = useState('')

//   const handleLogout = async () => {
//     const supabase = createSupabaseBrowser()
//     await supabase.auth.signOut()
//     router.push('/login')
//     router.refresh()
//   }

//   // ← CHANGED: toggle a practice's checkbox
//   const toggleSelect = (code: string) => {
//     setSelected((prev) => {
//       const next = new Set(prev)
//       if (next.has(code)) next.delete(code)
//       else next.add(code)
//       return next
//     })
//   }

//   // ← CHANGED: allocate handler (writes to DB via the server action)
//   const handleAllocate = async () => {
//     setAllocMsg('')
//     if (selected.size === 0) { setAllocMsg('Select at least one practice.'); return }
//     if (!targetCompany) { setAllocMsg('Pick a company.'); return }
//     const res = await allocatePractices(Array.from(selected), targetCompany)
//     setAllocMsg(res.message)
//     if (res.ok) {
//       setSelected(new Set())
//       router.refresh()
//     }
//   }

//   const states = Array.from(
//     new Set(practices.map((p) => p.state).filter(Boolean))
//   ).sort() as string[]

//   const visible = practices.filter((p) => {
//     if (stateFilter && p.state !== stateFilter) return false
//     if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
//     for (const s of SIGNALS) {
//       if (activeSignals[s.key] && !p[s.key]) return false
//     }
//     return true
//   })

//   const toggleSignal = (key: string) =>
//     setActiveSignals((prev) => ({ ...prev, [key]: !prev[key] }))

//   const resetAll = () => {
//     setStateFilter('')
//     setSearch('')
//     setActiveSignals({})
//   }

//   const inputStyle = { padding: '8px 10px', border: '1px solid #ccc', borderRadius: 6, fontSize: 14 }
//   const cell = { padding: 8, border: '1px solid #ddd', fontSize: 13, textAlign: 'center' as const }
//   const cellLeft = { ...cell, textAlign: 'left' as const }

//   return (
//     <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
//       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
//         <h1 style={{ fontSize: 28 }}>Master Practices</h1>
//         <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
//           {/* ← CHANGED: use isSuperAdmin flag for the Admin link */}
//           {isSuperAdmin && (
//             <a href="/admin" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
//               Admin
//             </a>  
//           )}
//           <a href="/dashboard" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
//             Dashboard
//           </a>
//           <a href="/reminders" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
//             My Reminders
//           </a>
//           <a href="/clients" style={{ fontSize: 13, color: '#2563eb', textDecoration: 'none' }}>
//             My Clients
//           </a>
//           {currentUser && (
//             <span style={{ fontSize: 13, color: '#555' }}>
//               {currentUser.full_name} · <strong>{currentUser.role}</strong> · {currentUser.company}
//             </span>
//           )}
//           <button
//             onClick={handleLogout}
//             style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #ccc', background: '#f2f2f2', color: '#000', cursor: 'pointer', fontSize: 14 }}
//           >
//             Log out
//           </button>
//         </div>
//       </div>

//       {/* ← CHANGED: allocation bar, only for Super Admin */}
//       {isSuperAdmin && (
//         <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, padding: 12, border: '1px solid #2563eb', borderRadius: 8, background: '#eff6ff', flexWrap: 'wrap' }}>
//           <strong style={{ fontSize: 14, color: '#000' }}>{selected.size} selected</strong>
//           <select value={targetCompany} onChange={(e) => setTargetCompany(e.target.value)} style={{ ...inputStyle, color: '#000' }}>
//             <option value="">Choose company…</option>
//             {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
//           </select>
//           <button onClick={handleAllocate} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontSize: 14 }}>
//             Allocate Selected
//           </button>
//           {allocMsg && <span style={{ fontSize: 13, color: '#000' }}>{allocMsg}</span>}
//         </div>
//       )}

//       <p style={{ color: '#666', marginBottom: 16 }}>
//         Showing {visible.length} of {practices.length} practices
//       </p>

//       <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
//         <input
//           type="text"
//           placeholder="Search practice name..."
//           value={search}
//           onChange={(e) => setSearch(e.target.value)}
//           style={{ ...inputStyle, minWidth: 220 }}
//         />
//         <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={inputStyle}>
//           <option value="">All States</option>
//           {states.map((s) => <option key={s} value={s}>{s}</option>)}
//         </select>
//         <select value={year} onChange={(e) => setYear(e.target.value)} style={inputStyle}>
//           {['2022', '2023', '2024', '2025', '2026'].map((y) => (
//             <option key={y} value={y}>MIPS Year {y}</option>
//           ))}
//         </select>
//         <button onClick={resetAll} style={{ ...inputStyle, cursor: 'pointer', background: '#f2f2f2', color: '#000' }}>
//           Reset
//         </button>
//       </div>

//       <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
//         <span style={{ color: '#666', fontSize: 13, alignSelf: 'center' }}>Filter by signal:</span>
//         {SIGNALS.map((s) => (
//           <button
//             key={s.key}
//             onClick={() => toggleSignal(s.key)}
//             style={{
//               padding: '6px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
//               background: activeSignals[s.key] ? '#2563eb' : '#f2f2f2',
//               color: activeSignals[s.key] ? '#fff' : '#333',
//               border: '1px solid ' + (activeSignals[s.key] ? '#2563eb' : '#ddd'),
//             }}
//           >
//             {s.label}
//           </button>
//         ))}
//       </div>

//       <div style={{ overflowX: 'auto' }}>
//         <table style={{ borderCollapse: 'collapse', width: '100%' }}>
//           <thead>
//             <tr style={{ background: '#f2f2f2', color: '#000' }}>
//               {/* ← CHANGED: checkbox header column for Super Admin */}
//               {isSuperAdmin && <th style={cell}></th>}
//               <th style={cellLeft}>Practice</th>
//               <th style={cell}>State</th>
//               <th style={cellLeft}>Specialty</th>
//               {SIGNALS.map((s) => <th key={s.key} style={cell}>{s.label}</th>)}
//               <th style={cellLeft}>MIPS {year}</th>
//               {!isSuperAdmin && <th style={cell}>Status</th>}
//               {!isSuperAdmin && <th style={cellLeft}>Allocated On</th>}
//             </tr>
//           </thead>
//           <tbody>
//             {visible.map((p, i) => (
//               <tr key={i}>
//                 {/* ← CHANGED: checkbox cell for Super Admin */}
//                 {isSuperAdmin && (
//                   <td style={cell}>
//                     <input
//                       type="checkbox"
//                       checked={selected.has(p.practiceCode)}
//                       onChange={() => toggleSelect(p.practiceCode)}
//                     />
//                   </td>
//                 )}
//                 <td style={cellLeft}>
//                   <a href={`/practice/${p.practiceCode}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
//                     {p.name}
//                   </a>
//                 </td>
//                 <td style={cell}>{p.state}</td>
//                 <td style={cellLeft}>{p.specialty}</td>
//                 {SIGNALS.map((s) => (
//                   <td key={s.key} style={cell}>{p[s.key] ? '✅' : '—'}</td>
//                 ))}
//                 <td style={{ ...cellLeft, fontSize: 12, color: '#555', maxWidth: 260 }}>
//                   {p.mipsByYear[Number(year)] || '—'}
//                 </td>
//                 {!isSuperAdmin && (
//                   <td style={cell}>
//                     {p.status ? (
//                       <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 12, color: '#fff',
//                         background: STATUS_COLORS[p.status] ?? '#6b7280', }}>
//                         {p.status}
//                       </span>
//                     ) : '—'}
                    
//                   </td>
//                 )}
//                 {!isSuperAdmin && (
//                   <td style={{ ...cellLeft, fontSize: 12, color: '#555' }}></td>
//                 )}
//               </tr>
//             ))}
//           </tbody>
//         </table>
//       </div>
//     </div>
//   )
// }
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { allocatePractices } from './actions'
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
}

type Company = { slug: string; name: string }

type Props = {
  practices: Practice[]
  companies?: Company[]
  isSuperAdmin?: boolean
  currentUser?: { full_name: string; role: string; company: string } | null
  canAssign?: boolean
  myAgents?: { id: string; full_name: string; role: string }[]
  myAssignedCodes?: string[]
}

// ---- palette (dark, matches the sample) ----
const C = {
  bg: '#0a0e14',
  panel: '#0f1620',
  panelAlt: '#0b1119',
  line: '#1c2836',
  text: '#e6edf3',
  dim: '#8a99a8',
  faint: '#566472',
  blue: '#3b82f6',
  cyan: '#22d3ee',
  green: '#22c55e',
  amber: '#f59e0b',
  violet: '#8b5cf6',
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

// placeholder timezone buckets — no zone data wired yet
const ZONES = [
  { key: 'EST', count: 0 },
  { key: 'CST', count: 0 },
  { key: 'MST', count: 0 },
  { key: 'PST', count: 0 },
  { key: 'Other', count: 0 },
]

export default function PracticesTable({ practices, companies = [], isSuperAdmin = false, currentUser, canAssign = false, myAgents = [], myAssignedCodes = [] }: Props) {
  const router = useRouter()

  // ---- REAL filter state ----
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [activeSignals, setActiveSignals] = useState<Set<string>>(new Set())

  // ---- REAL allocation state ----
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targetCompany, setTargetCompany] = useState('')
  const [allocMsg, setAllocMsg] = useState('')

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

  // ---- placeholder-only UI state (sample) ----
  const [poolTab, setPoolTab] = useState('All Leads')
  const [catTab, setCatTab] = useState('All Categories')

  const states = useMemo(
    () => Array.from(new Set(practices.map((p) => p.state).filter(Boolean))).sort() as string[],
    [practices]
  )

  const toggleSignal = (key: string) => {
    setActiveSignals((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const filtered = useMemo(() => {
    const rows = practices.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
      if (stateFilter && p.state !== stateFilter) return false

      // Signal pills (CCM/PCM/…/MIPS) — each active pill must pass (AND logic).
      for (const key of activeSignals) {
        const sig = SIGNALS.find((s) => s.key === key)
        if (sig && !sig.test(p)) return false
      }

      // Category tab filter (All / MIPS / RCM / CCM)
      if (catTab === 'MIPS' && !hasRealMips(p)) return false
      if (catTab === 'RCM' && !p.rcmFit) return false
      if (catTab === 'CCM' && !p.ccm) return false

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
  }, [practices, search, stateFilter, activeSignals, catTab, assignedView, prioritySet, hasPriority])

  const toggleSelect = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  // Select-all: reflects the currently FILTERED rows.
  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.practiceCode))
  const toggleSelectAll = () => {
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
    setSearch(''); setStateFilter(''); setActiveSignals(new Set()); setCatTab('All Categories')
  }

  return (
    <div style={{ color: C.text, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* ---- Distribution Console (placeholder) ---- */}
      <section style={{ ...panel, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Leads Distribution Console</h2>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>Select an agent/closer and timezone counts to assign and export leads from the main pool.</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['All Leads', 'MIPS Leads', 'RCM Leads', 'CCM Leads'].map((t) => (
              <span key={t} style={pill(t === 'All Leads')}>{t}</span>
            ))}
            <SampleTag />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
          {ZONES.map((z) => (
            <div key={z.key} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: 12, background: C.panelAlt }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.dim }}>
                <span style={{ letterSpacing: 0.5 }}>{z.key} ZONE</span>
                <span style={{ color: C.amber }}>{z.count}</span>
              </div>
              <input disabled value={0} style={{ ...input, marginTop: 8, textAlign: 'center' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr', gap: 10 }}>
          <LabeledSelect label="TARGET AGENT" options={['— Select Agent / Closer —']} />
          <LabeledSelect label="SPECIALTY" options={['— All Specialties —']} />
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 12px', background: C.panelAlt }}>
            <div style={{ fontSize: 10, color: C.faint, letterSpacing: 0.5 }}>PRACTICE SIZE</div>
            <div style={{ fontSize: 13, marginTop: 4, color: C.dim }}>1 &nbsp;to&nbsp; 15</div>
          </div>
        </div>
      </section>

      {/* ---- Lead Pool bar ---- */}
      <section style={{ ...panel, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Lead Pool <span style={{ color: C.dim, fontWeight: 400 }}>({filtered.length} leads)</span></h2>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>Explore and manage unassigned master records</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['All Leads', 'New Leads', 'Worked Leads'].map((t) => (
            <span key={t} onClick={() => setPoolTab(t)} style={{ ...pill(poolTab === t), cursor: 'pointer' }}>{t}</span>
          ))}
        </div>
        {hasPriority && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
        <div style={{ display: 'flex', gap: 6 }}>
          {['All Categories', 'MIPS', 'RCM', 'CCM'].map((t) => (
            <span key={t} onClick={() => setCatTab(t)} style={{ ...pill(catTab === t), cursor: 'pointer' }}>{t}</span>
          ))}
        </div>
      </section>

      {/* ---- Filter bar (real: search, state, signals) ---- */}
      <section style={{ ...panel, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input placeholder="Practice name…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...input, minWidth: 220 }} />
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} style={input}>
            <option value="">All States</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select disabled style={{ ...input, opacity: 0.6 }}><option>MIPS Year 2026</option></select>
          <select disabled style={{ ...input, opacity: 0.6 }}><option>All Dispositions</option></select>
          <select disabled style={{ ...input, opacity: 0.6 }}><option>Any Enrichment</option></select>
          <button onClick={resetFilters} style={btnGhost}>Reset</button>
          <SampleTag note="dispositions / enrichment / dates not wired" />
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
        <section style={{ ...panel, marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center', borderColor: C.blue }}>
          <strong style={{ fontSize: 14 }}>{selected.size} selected</strong>
          <select value={targetCompany} onChange={(e) => setTargetCompany(e.target.value)} style={input}>
            <option value="">Choose company…</option>
            {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <button onClick={handleAllocate} style={btnPrimary}>Allocate Selected</button>
          {allocMsg && <span style={{ fontSize: 13, color: C.dim }}>{allocMsg}</span>}
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
          <select value={targetAgent} onChange={(e) => setTargetAgent(e.target.value)} style={input}>
            <option value="">Assign to…</option>
            {myAgents.map((a) => <option key={a.id} value={a.id}>{a.full_name} · {a.role}</option>)}
          </select>
          <button onClick={handleAssign} style={{ ...btnPrimary, background: C.green }}>Assign Selected</button>
          {myAgents.length === 0 && <span style={{ fontSize: 13, color: C.faint }}>No direct reports to assign to.</span>}
          {assignMsg && <span style={{ fontSize: 13, color: C.dim }}>{assignMsg}</span>}
        </section>
      )}

      {/* ---- Table ---- */}
      <section style={{ ...panel, padding: 0, overflowX: 'auto' }}>
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
              <th style={thLeft}>Practice</th>
              <th style={th}>State</th>
              <th style={thLeft}>Specialty</th>
              {COLUMN_SIGNALS.map((s) => <th key={s.key as string} style={th}>{s.label}</th>)}
              <th style={thLeft}>MIPS 2026</th>
              <th style={thLeft}>Source</th>
              <th style={thLeft}>Assigned On</th>
              <th style={thLeft}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.practiceCode} style={{ borderBottom: `1px solid ${C.line}` }}>
                {(isSuperAdmin || canAssign) && (
                  <td style={td}>
                    <input type="checkbox" checked={selected.has(p.practiceCode)} onChange={() => toggleSelect(p.practiceCode)} />
                  </td>
                )}
                <td style={tdLeft}>
                  {prioritySet.has(p.practiceCode) && (
                    <span title="Assigned to you" style={{ color: C.amber, marginRight: 6 }}>★</span>
                  )}
                  <a href={`/practice/${p.practiceCode}`} style={{ color: C.cyan, textDecoration: 'none', fontWeight: 600 }}>{p.name}</a>
                  <div style={{ fontSize: 11, color: C.faint }}>Solo Practice</div>
                </td>
                <td style={{ ...td, color: C.dim }}>{p.state ?? '—'}</td>
                <td style={{ ...tdLeft, color: C.dim }}>{p.specialty ?? '—'}</td>
                {COLUMN_SIGNALS.map((s) => (
                  <td key={s.key as string} style={td}>
                    {p[s.key] ? <span style={{ color: C.green }}>✓</span> : <span style={{ color: C.faint }}>—</span>}
                  </td>
                ))}
                <td style={{ ...tdLeft, color: C.dim, fontSize: 12 }}>
                  {hasRealMips(p)
                    ? <span style={{ color: C.green, marginRight: 6 }}>✓</span>
                    : <span style={{ color: C.faint, marginRight: 6 }}>—</span>}
                  {p.mipsByYear?.[2026] ?? ''}
                </td>
                <td style={{ ...tdLeft, fontSize: 12 }}>{sourceBadge(p.source, p.allocatedTo)}</td>
                <td style={{ ...tdLeft, color: C.dim, fontSize: 12 }}>{fmtDateTime(p.allocatedOn)}</td>
                <td style={{ ...tdLeft, fontSize: 12 }}>{statusBadge(p.status)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={15} style={{ ...tdLeft, color: C.faint, padding: 24 }}>No leads match these filters. Clear them to see the full pool.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 13, color: C.dim }}>
        <span>Showing {filtered.length} of {practices.length} practices</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled style={{ ...btnGhost, opacity: 0.5 }}>Previous</button>
          <button disabled style={{ ...btnGhost, opacity: 0.5 }}>Next</button>
        </div>
      </div>
    </div>
  )

  // ---- small components ----
  function LabeledSelect({ label, options }: { label: string; options: string[] }) {
    return (
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 12px', background: C.panelAlt }}>
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
  if (!s) return <span style={{ color: '#566472' }}>—</span>
  const isAllocated = s.toLowerCase().includes('alloc')
  const color = isAllocated ? '#8b5cf6' : '#22d3ee' // violet vs cyan
  const label = isAllocated ? 'Allocated' : 'Uploaded'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block', fontSize: 11, fontWeight: 600,
        color, border: `1px solid ${color}`, borderRadius: 999,
        padding: '2px 10px', background: color + '22',
      }}>{label}</span>
      {isAllocated && allocatedTo && (
        <span style={{ fontSize: 11, color: '#8a99a8' }}>→ {allocatedTo}</span>
      )}
    </span>
  )
}

// Colored status badge. Maps the agent's chosen action to a colored pill.
function statusBadge(status?: string | null) {
  const s = (status ?? '').trim()
  if (!s) return <span style={{ color: '#566472' }}>—</span>
  const key = s.toLowerCase()
  let color = '#8a99a8' // default grey
  if (key.includes('sold')) color = '#22c55e'          // green
  else if (key.includes('clos')) color = '#3b82f6'      // blue
  else if (key.includes('follow')) color = '#f59e0b'    // amber
  else if (key.includes('interest')) color = '#22d3ee'  // cyan
  else if (key.includes('not interest') || key.includes('dnc')) color = '#ef4444' // red
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, fontWeight: 600,
      color, border: `1px solid ${color}`, borderRadius: 999,
      padding: '2px 10px', background: color + '22',
    }}>{s}</span>
  )
}

function SampleTag({ note }: { note?: string }) {
  return (
    <span title={note} style={{ fontSize: 9, color: '#566472', border: '1px solid #1c2836', borderRadius: 4, padding: '2px 6px', alignSelf: 'center' }}>
      sample
    </span>
  )
}

// ---- shared styles ----
const panel: React.CSSProperties = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 }
const input: React.CSSProperties = { background: C.panelAlt, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 12px', fontSize: 13 }
const btnPrimary: React.CSSProperties = { background: C.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }
const btnGhost: React.CSSProperties = { background: 'transparent', color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
const th: React.CSSProperties = { padding: '12px 10px', textAlign: 'center', fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }
const thLeft: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '12px 10px', textAlign: 'center' }
const tdLeft: React.CSSProperties = { padding: '12px 10px', textAlign: 'left' }

function pill(active: boolean): React.CSSProperties {
  return {
    fontSize: 12, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', userSelect: 'none',
    border: `1px solid ${active ? C.blue : C.line}`,
    background: active ? 'rgba(59,130,246,0.15)' : 'transparent',
    color: active ? C.text : C.dim,
  }
}