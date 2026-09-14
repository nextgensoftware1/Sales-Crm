'use client'

import { useMemo } from 'react'
import AppShell from '../AppShell'

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
  proposalsCount: number
  contractsCount: number
  dispoCounts: Record<string, number>
  canManageAssignments?: boolean
  isSuperAdmin?: boolean
}

const money = (n: number) => '$' + (Number(n) || 0).toLocaleString()

export default function DashboardView(p: Props) {
  // ---- REAL funnel: activities -> transfers -> sales ----
  const funnel = useMemo(() => {
    const worked = p.activityCount
    const rows = [
      { label: 'Activities logged', value: worked, colorVar: 'var(--accent)' },
      { label: 'Transfers', value: p.transferCount, colorVar: '#22d3ee' },
      { label: 'Sales', value: p.saleCount, colorVar: 'var(--purple)' },
    ]
    const top = Math.max(worked, 1)
    return rows.map((r) => ({ ...r, pct: Math.round((r.value / top) * 100) }))
  }, [p.activityCount, p.transferCount, p.saleCount])

  const dispoRows = useMemo(
    () => Object.entries(p.dispoCounts).sort((a, b) => b[1] - a[1]),
    [p.dispoCounts]
  )
  const dispoMax = Math.max(1, ...dispoRows.map(([, n]) => n))

  const currentUser = { full_name: p.userName, role: p.roleLabel, company: p.companyName }

  return (
    <AppShell
      title="Performance Dashboard"
      subtitle={`Sales & KPI overview · Scope: ${p.scopeLabel}`}
      currentUser={currentUser}
      active="/dashboard"
      showAdmin={!!p.isSuperAdmin}
      showTransfers
      canManageUsers={!!p.isSuperAdmin || !!p.canManageAssignments}
      headerRight={
        p.canManageAssignments ? (
          <a href="/assignments" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Manage assigned leads
          </a>
        ) : null
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* ---- KPI cards (matches reference: 1 / 2 / 3 col responsive glass cards) ---- */}
        <div className="kpi-cards-grid">
          <Kpi label="Activities Logged" value={p.activityCount} sub="Outbound dialing activity" color="calls" icon={<IconPhone />} />
          <Kpi label="Transfers" value={p.transferCount} sub="Qualified lead handovers" color="transfers" icon={<IconTransfer />} />
          <Kpi label="Closed Sales" value={p.saleCount} sub="New client accounts activated" color="sales" icon={<IconBadgeDollar />} />
          <Kpi label="Active Clients" value={p.clientCount} sub="Currently active accounts" color="collected" icon={<IconUsers />} />
          <Kpi label="Proposals Shared" value={p.proposalsCount} sub="Standard pitches delivered" color="proposals" icon={<IconFileText />} />
          <Kpi label="Contracts Signed" value={p.contractsCount} sub="Pending closes signed" color="contracts" icon={<IconFileCheck />} />
          <Kpi label="Total Contract Value" value={money(p.totalValue)} sub="Total value of signed deals" color="collected" icon={<IconBanknote />} />
          <Kpi label="Total MRR" value={money(p.totalMrr)} sub="Monthly recurring revenue" color="calls" icon={<IconTrendingUp />} />
          <Kpi label="Total Incentives Paid" value={money(0)} sub="Agent commissions calculated" color="incentives" icon={<IconWallet />} sample />
        </div>

        {/* ---- Charts row ---- */}
        <div className="grid-dash-a">
          {/* Conversion funnel (REAL) */}
          <Panel title="Conversion funnel" subtitle="Activities → transfers → sales">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
              {funnel.map((f) => (
                <div key={f.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span className="subtle">{f.label}</span>
                    <span style={{ color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{f.value} · {f.pct}%</span>
                  </div>
                  <div style={{ height: 14, borderRadius: 7, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{ width: `${f.pct}%`, height: '100%', background: f.colorVar, borderRadius: 7, transition: 'width .3s' }} />
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
                  ['Transfer', 'var(--accent)'], ['Contract', 'var(--ok)'],
                  ['Shared sale', 'var(--purple)'], ['Self sale', '#22d3ee'], ['Manual', 'var(--warn)'],
                ].map(([l, c]) => (
                  <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8 }} className="subtle">
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: c as string, display: 'inline-block' }} />
                    {l}: {money(0)}
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* ---- Ratios + disposition ---- */}
        <div className="grid-dash-b">
          {/* Conversion ratios (REAL from funnel) */}
          <Panel title="Conversion ratios" subtitle="Lead progression efficiency">
            {[
              ['Activity → transfer', p.activityCount ? Math.round((p.transferCount / p.activityCount) * 100) : 0],
              ['Transfer → sale', p.transferCount ? Math.round((p.saleCount / p.transferCount) * 100) : 0],
              ['Sale → client', p.saleCount ? Math.round((p.clientCount / p.saleCount) * 100) : 0],
            ].map(([label, pct]) => (
              <div key={label as string} style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                  <span className="subtle">{label}</span>
                  <span style={{ color: 'var(--purple)' }}>{pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-2)' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--purple)', borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </Panel>

          {/* Disposition breakdown (REAL) */}
          <Panel title="Disposition breakdown" subtitle="Outcomes logged in scope">
            {dispoRows.length === 0 ? (
              <p className="subtle" style={{ marginTop: 12 }}>No activity logged yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {dispoRows.map(([d, n]) => (
                  <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="subtle" style={{ width: 130, fontSize: 12 }}>{d}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface-2)' }}>
                      <div style={{ width: `${(n / dispoMax) * 100}%`, height: '100%', background: '#22d3ee', borderRadius: 4 }} />
                    </div>
                    <span style={{ width: 24, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <p className="subtle" style={{ fontSize: 11 }}>
          Cards marked “sample” are placeholder metrics — no data source is wired for them yet
          (agent commissions/incentives, collected/outstanding totals).
        </p>
      </div>
    </AppShell>
  )
}

type KpiColor = 'calls' | 'transfers' | 'contracts' | 'sales' | 'proposals' | 'incentives' | 'collected' | 'outstanding'

function Kpi({ label, value, sub, color, icon, sample }: {
  label: string; value: number | string; sub: string; color: KpiColor; icon: React.ReactNode; sample?: boolean
}) {
  const varColor = `var(--c-${color})`
  const rgbVar = `var(--c-${color}-rgb)`
  return (
    <div className="kpi-card">
      <div className="kpi-card-stripe" style={{ background: varColor }} />
      {sample && <span className="kpi-card-sample">sample</span>}
      <div className="kpi-card-top">
        <div className="kpi-card-text">
          <div className="kpi-card-label">{label}</div>
          <div className="kpi-card-value">{value}</div>
          <div className="kpi-card-sub">{sub}</div>
        </div>
        <div className="kpi-card-icon" style={{ background: `rgba(${rgbVar},0.1)`, borderColor: `rgba(${rgbVar},0.28)`, color: varColor }}>
          {icon}
        </div>
      </div>
    </div>
  )
}

// ---- Small hand-authored icon set (stroke-based, matches lucide's visual style) ----
const iconProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
function IconPhone() {
  return <svg {...iconProps}><path d="M13 2a9 9 0 0 1 9 9" /><path d="M13 6a5 5 0 0 1 5 5" /><path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384" /></svg>
}
function IconTransfer() {
  return <svg {...iconProps}><path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" /></svg>
}
function IconBadgeDollar() {
  return <svg {...iconProps}><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" /><path d="M12 17V7" /><path d="M9.5 9.5A2.5 2.5 0 0 1 12 7c1.4 0 2.5.8 2.5 2s-1 1.8-2.5 2c-1.5.2-2.5 1-2.5 2s1.1 2 2.5 2 2.5-.7 2.5-2" /></svg>
}
function IconUsers() {
  return <svg {...iconProps}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
}
function IconFileText() {
  return <svg {...iconProps}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></svg>
}
function IconFileCheck() {
  return <svg {...iconProps}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="m9 15 2 2 4-4" /></svg>
}
function IconBanknote() {
  return <svg {...iconProps}><rect width="20" height="12" x="2" y="6" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" /></svg>
}
function IconTrendingUp() {
  return <svg {...iconProps}><path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" /></svg>
}
function IconWallet() {
  return <svg {...iconProps}><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>
}

function Panel({ title, subtitle, sample, children }: { title: string; subtitle?: string; sample?: boolean; children: React.ReactNode }) {
  return (
    <section className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--ink-strong)' }}>{title}</h2>
          {subtitle && <div className="subtle" style={{ marginTop: 3 }}>{subtitle}</div>}
        </div>
        {sample && <span style={{ fontSize: 9, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>sample</span>}
      </div>
      {children}
    </section>
  )
}

function Donut() {
  // static placeholder ring
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="44" fill="none" stroke="var(--surface-2)" strokeWidth="16" />
      <circle cx="60" cy="60" r="44" fill="none" stroke="var(--accent)" strokeWidth="16"
        strokeDasharray="276" strokeDashoffset="90" transform="rotate(-90 60 60)" strokeLinecap="round" />
    </svg>
  )
}
