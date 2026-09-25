'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import AppShell from '../AppShell'
import DateRangePicker from './DateRangePicker'
import { SalesFunnel, DispositionDonut } from './Charts'

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
  fromDate: string
  toDate: string
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <DateRangePicker from={p.fromDate} to={p.toDate} />
          {p.canManageAssignments && (
            <Link prefetch={false} href="/assignments" className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Manage assigned leads
            </Link>
          )}
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* ---- Hero stats: the headline numbers, given real visual weight
             instead of sitting equal-sized next to nine other cards ---- */}
        <div className="hero-stats-row page-anchor" id="overview">
          <HeroStat label="Total Contract Value" value={money(p.totalValue)} sub="All-time · not scoped to the date range yet" accent="var(--accent)" />
          <div className="hero-stats-divider" />
          <HeroStat label="Activities Logged" value={p.activityCount} sub="Outbound dialing activity, in range" accent="var(--c-calls)" />
          <div className="hero-stats-divider" />
          <HeroStat label="Closed Sales" value={p.saleCount} sub="All-time · not scoped to the date range yet" accent="var(--c-sales)" />
        </div>

        {/* ---- Secondary KPI cards — everything else, at a smaller, supporting weight ---- */}
        <div className="kpi-cards-grid kpi-cards-grid-secondary">
          <Kpi label="Transfers" value={p.transferCount} sub="Qualified lead handovers, in range" color="transfers" icon={<IconTransfer />} />
          <Kpi label="Active Clients" value={p.clientCount} sub="All-time · not scoped to the date range yet" color="collected" icon={<IconUsers />} />
          <Kpi label="Proposals Shared" value={p.proposalsCount} sub="Standard pitches delivered, in range" color="proposals" icon={<IconFileText />} />
          <Kpi label="Contracts Signed" value={p.contractsCount} sub="Pending closes signed, in range" color="contracts" icon={<IconFileCheck />} />
        </div>

        {/* ---- Charts row ---- */}
        <div className="grid-dash-a page-anchor" id="pipeline">
          {/* Conversion funnel (REAL) */}
          <Panel title="Conversion funnel" subtitle="Activities → transfers → sales">
            <SalesFunnel rows={funnel} />
          </Panel>

          <Panel title="Disposition Breakdown" subtitle="Outcomes logged in scope">
            <DispositionDonut rows={dispoRows} />
          </Panel>
        </div>

        <div className="kpi-cards-grid kpi-cards-grid-secondary dashboard-secondary page-anchor" id="revenue">
          <Kpi label="Total MRR" value={money(p.totalMrr)} sub="All-time · not scoped to the date range yet" color="calls" icon={<IconTrendingUp />} />
          <Kpi label="Total Incentives Paid" value={money(0)} sub="Agent commissions calculated" color="incentives" icon={<IconWallet />} sample />
        </div>

        {/* ---- Ratios + incentive splits ---- */}
        <div className="grid-dash-b page-anchor" id="conversion">
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

        <p className="subtle" style={{ fontSize: 11 }}>
          Cards marked “sample” are placeholder metrics — no data source is wired for them yet
          (agent commissions/incentives, collected/outstanding totals).
        </p>
      </div>
    </AppShell>
  )
}

function HeroStat({ label, value, sub, accent }: { label: string; value: number | string; sub: string; accent: string }) {
  return (
    <div className="hero-stat">
      <div className="hero-stat-value" style={{ color: accent }}>{value}</div>
      <div className="hero-stat-label">{label}</div>
      <div className="hero-stat-sub">{sub}</div>
    </div>
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
const iconProps = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true, focusable: false,
}
function IconTransfer() {
  return <svg {...iconProps}><path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" /></svg>
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
    <svg aria-hidden="true" focusable="false" width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="44" fill="none" stroke="var(--surface-2)" strokeWidth="16" />
      <circle cx="60" cy="60" r="44" fill="none" stroke="var(--accent)" strokeWidth="16"
        strokeDasharray="276" strokeDashoffset="90" transform="rotate(-90 60 60)" strokeLinecap="round" />
    </svg>
  )
}
