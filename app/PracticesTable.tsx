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
}

type Company = { slug: string; name: string }

type Props = {
  practices: Practice[]
  companies?: Company[]
  isSuperAdmin?: boolean
  currentUser?: { full_name: string; role: string; company: string } | null
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

const SIGNALS: { key: keyof Practice; label: string }[] = [
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

export default function PracticesTable({ practices, companies = [], isSuperAdmin = false, currentUser }: Props) {
  const router = useRouter()

  // ---- REAL filter state ----
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [activeSignals, setActiveSignals] = useState<Set<keyof Practice>>(new Set())

  // ---- REAL allocation state ----
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targetCompany, setTargetCompany] = useState('')
  const [allocMsg, setAllocMsg] = useState('')

  // ---- placeholder-only UI state (sample) ----
  const [poolTab, setPoolTab] = useState('All Leads')
  const [catTab, setCatTab] = useState('All Categories')

  const states = useMemo(
    () => Array.from(new Set(practices.map((p) => p.state).filter(Boolean))).sort() as string[],
    [practices]
  )

  const toggleSignal = (key: keyof Practice) => {
    setActiveSignals((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const filtered = useMemo(() => {
    return practices.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
      if (stateFilter && p.state !== stateFilter) return false
      for (const key of activeSignals) if (!p[key]) return false
      return true
    })
  }, [practices, search, stateFilter, activeSignals])

  const toggleSelect = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
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

  const resetFilters = () => {
    setSearch(''); setStateFilter(''); setActiveSignals(new Set())
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

      {/* ---- Table ---- */}
      <section style={{ ...panel, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.line}` }}>
              {isSuperAdmin && <th style={th}></th>}
              <th style={thLeft}>Practice</th>
              <th style={th}>State</th>
              <th style={thLeft}>Specialty</th>
              {SIGNALS.map((s) => <th key={s.key as string} style={th}>{s.label}</th>)}
              <th style={thLeft}>MIPS 2026</th>
              <th style={thLeft}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.practiceCode} style={{ borderBottom: `1px solid ${C.line}` }}>
                {isSuperAdmin && (
                  <td style={td}>
                    <input type="checkbox" checked={selected.has(p.practiceCode)} onChange={() => toggleSelect(p.practiceCode)} />
                  </td>
                )}
                <td style={tdLeft}>
                  <a href={`/practice/${p.practiceCode}`} style={{ color: C.cyan, textDecoration: 'none', fontWeight: 600 }}>{p.name}</a>
                  <div style={{ fontSize: 11, color: C.faint }}>Solo Practice</div>
                </td>
                <td style={{ ...td, color: C.dim }}>{p.state ?? '—'}</td>
                <td style={{ ...tdLeft, color: C.dim }}>{p.specialty ?? '—'}</td>
                {SIGNALS.map((s) => (
                  <td key={s.key as string} style={td}>
                    {p[s.key] ? <span style={{ color: C.green }}>✓</span> : <span style={{ color: C.faint }}>—</span>}
                  </td>
                ))}
                <td style={{ ...tdLeft, color: C.dim, fontSize: 12 }}>{p.mipsByYear?.[2026] ?? '—'}</td>
                <td style={{ ...tdLeft, color: C.dim, fontSize: 12 }}>{p.status || '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={13} style={{ ...tdLeft, color: C.faint, padding: 24 }}>No leads match these filters. Clear them to see the full pool.</td></tr>
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