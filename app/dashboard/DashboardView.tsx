'use client'

import { useMemo } from 'react'

type Props = {
  scopeLabel: string
  companyName: string
  userName: string
  roleLabel: string
  activityCount: number
  transferCount: number
  saleCount: number
  totalValue: number
  totalMrr: number
  clientCount: number
  dispoCounts: Record<string, number>
}

// ---- palette (dark) ----
const C = {
  bg: '#0b0f14',
  panel: '#111823',
  panelAlt: '#0e141d',
  line: '#1e2a38',
  text: '#e6edf3',
  dim: '#8a99a8',
  faint: '#5c6b7a',
  blue: '#3b82f6',
  cyan: '#22d3ee',
  green: '#22c55e',
  amber: '#f59e0b',
  violet: '#8b5cf6',
  red: '#ef4444',
}

const nav = [
  { label: 'Dashboard', href: '/dashboard', active: true },
  { label: 'Leads Engine', href: '/' },
  { label: 'My Reminders', href: '/reminders' },
  { label: 'Transfers', href: '/' },
  { label: 'Active Clients', href: '/clients' },
]

const money = (n: number) => '$' + (Number(n) || 0).toLocaleString()

export default function DashboardView(p: Props) {
  // ---- REAL funnel: activities -> transfers -> sales ----
  const funnel = useMemo(() => {
    const worked = p.activityCount
    const rows = [
      { label: 'Activities logged', value: worked, color: C.blue },
      { label: 'Transfers', value: p.transferCount, color: C.cyan },
      { label: 'Sales', value: p.saleCount, color: C.violet },
    ]
    const top = Math.max(worked, 1)
    return rows.map((r) => ({ ...r, pct: Math.round((r.value / top) * 100) }))
  }, [p.activityCount, p.transferCount, p.saleCount])

  const dispoRows = useMemo(
    () => Object.entries(p.dispoCounts).sort((a, b) => b[1] - a[1]),
    [p.dispoCounts]
  )
  const dispoMax = Math.max(1, ...dispoRows.map(([, n]) => n))

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* ---- Sidebar ---- */}
      <aside style={{ width: 232, borderRight: `1px solid ${C.line}`, background: C.panelAlt, padding: '20px 14px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 20px' }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, ${C.blue}, ${C.cyan})` }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{p.companyName}</div>
            <div style={{ fontSize: 10, color: C.faint, letterSpacing: 0.5 }}>PRACTICE REVENUE CRM</div>
          </div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nav.map((n) => (
            <a key={n.label} href={n.href}
              style={{
                fontSize: 13, textDecoration: 'none', padding: '9px 12px', borderRadius: 8,
                color: n.active ? C.text : C.dim,
                background: n.active ? C.panel : 'transparent',
                border: n.active ? `1px solid ${C.line}` : '1px solid transparent',
              }}>
              {n.label}
            </a>
          ))}
        </nav>
        <div style={{ marginTop: 24, padding: '10px 12px', borderTop: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{p.userName}</div>
          <div style={{ fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.5 }}>{p.roleLabel}</div>
        </div>
      </aside>

      {/* ---- Main ---- */}
      <main style={{ flex: 1, padding: '24px 28px', maxWidth: 1400 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Performance Dashboard</h1>
            <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>Sales &amp; KPI overview · Scope: {p.scopeLabel}</div>
          </div>
          <a href="/" style={{ fontSize: 13, color: C.blue, textDecoration: 'none' }}>← Back to practices</a>
        </div>

        {/* ---- KPI cards row 1 ---- */}
        <div style={grid6}>
          <Kpi label="Activities logged" value={p.activityCount} accent={C.blue} />
          <Kpi label="Transfers" value={p.transferCount} accent={C.cyan} />
          <Kpi label="Sales" value={p.saleCount} accent={C.violet} />
          <Kpi label="Active clients" value={p.clientCount} accent={C.green} />
          <Kpi label="Proposals shared" value={0} accent={C.amber} sample />
          <Kpi label="Contracts signed" value={0} accent={C.green} sample />
        </div>

        {/* ---- KPI cards row 2 (money) ---- */}
        <div style={{ ...grid3, marginTop: 16 }}>
          <Kpi label="Total contract value" value={money(p.totalValue)} accent={C.green} big />
          <Kpi label="Total MRR" value={money(p.totalMrr)} accent={C.cyan} big />
          <Kpi label="Total incentives paid" value={money(0)} accent={C.violet} big sample />
        </div>

        {/* ---- Charts row ---- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 20 }}>
          {/* Conversion funnel (REAL) */}
          <Panel title="Conversion funnel" subtitle="Activities → transfers → sales">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
              {funnel.map((f) => (
                <div key={f.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: C.dim }}>{f.label}</span>
                    <span style={{ color: C.text, fontVariantNumeric: 'tabular-nums' }}>{f.value} · {f.pct}%</span>
                  </div>
                  <div style={{ height: 14, borderRadius: 7, background: C.panelAlt, overflow: 'hidden' }}>
                    <div style={{ width: `${f.pct}%`, height: '100%', background: f.color, borderRadius: 7, transition: 'width .3s' }} />
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* Incentive splits donut (SAMPLE) */}
          <Panel title="Incentive splits" subtitle="Payout by category" sample>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 8 }}>
              <Donut />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                {[
                  ['Transfer', C.blue], ['Contract', C.green],
                  ['Shared sale', C.violet], ['Self sale', C.cyan], ['Manual', C.amber],
                ].map(([l, c]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.dim }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: c as string }} />
                    {l}: {money(0)}
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* ---- Ratios + disposition ---- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          {/* Conversion ratios (REAL from funnel) */}
          <Panel title="Conversion ratios" subtitle="Lead progression efficiency">
            {[
              ['Activity → transfer', p.activityCount ? Math.round((p.transferCount / p.activityCount) * 100) : 0],
              ['Transfer → sale', p.transferCount ? Math.round((p.saleCount / p.transferCount) * 100) : 0],
              ['Sale → client', p.saleCount ? Math.round((p.clientCount / p.saleCount) * 100) : 0],
            ].map(([label, pct]) => (
              <div key={label as string} style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span style={{ color: C.dim }}>{label}</span>
                  <span style={{ color: C.violet }}>{pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: C.panelAlt }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: C.violet, borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </Panel>

          {/* Disposition breakdown (REAL) */}
          <Panel title="Disposition breakdown" subtitle="Outcomes logged in scope">
            {dispoRows.length === 0 ? (
              <p style={{ color: C.faint, fontSize: 13, marginTop: 12 }}>No activity logged yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {dispoRows.map(([d, n]) => (
                  <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 130, fontSize: 12, color: C.dim }}>{d}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: C.panelAlt }}>
                      <div style={{ width: `${(n / dispoMax) * 100}%`, height: '100%', background: C.cyan, borderRadius: 4 }} />
                    </div>
                    <span style={{ width: 24, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <p style={{ fontSize: 11, color: C.faint, marginTop: 22 }}>
          Cards marked “sample” are placeholder metrics — no data source is wired for them yet
          (calls dialed, proposals, contracts, incentives, collected/outstanding).
        </p>
      </main>
    </div>
  )
}

// ---- shared styles ----
const grid6: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }

function Kpi({ label, value, accent, big, sample }: { label: string; value: number | string; accent: string; big?: boolean; sample?: boolean }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderTop: `2px solid ${accent}`, borderRadius: 10, padding: 16, position: 'relative' }}>
      <div style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: big ? 26 : 30, fontWeight: 700, marginTop: 6, color: C.text }}>{value}</div>
      {sample && (
        <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 9, color: C.faint, border: `1px solid ${C.line}`, borderRadius: 4, padding: '1px 5px' }}>sample</span>
      )}
    </div>
  )
}

function Panel({ title, subtitle, sample, children }: { title: string; subtitle?: string; sample?: boolean; children: React.ReactNode }) {
  return (
    <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h2>
          {subtitle && <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>{subtitle}</div>}
        </div>
        {sample && <span style={{ fontSize: 9, color: C.faint, border: `1px solid ${C.line}`, borderRadius: 4, padding: '1px 5px' }}>sample</span>}
      </div>
      {children}
    </section>
  )
}

function Donut() {
  // static placeholder ring
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="44" fill="none" stroke={C.panelAlt} strokeWidth="16" />
      <circle cx="60" cy="60" r="44" fill="none" stroke={C.blue} strokeWidth="16"
        strokeDasharray="276" strokeDashoffset="90" transform="rotate(-90 60 60)" strokeLinecap="round" />
    </svg>
  )
}