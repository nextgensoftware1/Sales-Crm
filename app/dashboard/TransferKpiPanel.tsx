'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BadgeCheck, Building2, CalendarDays, ChevronRight, Wallet, XCircle } from 'lucide-react'
import { getTransferKpi, type KpiCredit } from '../kpi-actions'

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`
const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Same calendar month as `now`, in the viewer's own time zone. */
function inThisMonth(iso: string, now: Date) {
  const d = new Date(iso)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

type Totals = { count: number; amount: number }
type Group = { key: string; name: string; month: Totals; allTime: Totals; rejected: number }

/** Earnings totals (verified only) for a set of credits. */
function totalsOf(credits: KpiCredit[], now: Date | null) {
  const month: Totals = { count: 0, amount: 0 }
  const allTime: Totals = { count: 0, amount: 0 }
  for (const c of credits) {
    if (c.status === 'rejected') continue
    allTime.count += 1; allTime.amount += c.amount
    if (now && inThisMonth(c.verifiedAt, now)) { month.count += 1; month.amount += c.amount }
  }
  return { month, allTime }
}

function groupBy(credits: KpiCredit[], keyOf: (c: KpiCredit) => string, nameOf: (c: KpiCredit) => string, now: Date | null): Group[] {
  const map = new Map<string, KpiCredit[]>()
  for (const c of credits) map.set(keyOf(c), [...(map.get(keyOf(c)) ?? []), c])
  return Array.from(map, ([key, rows]) => ({
    key, name: nameOf(rows[0]), ...totalsOf(rows, now), rejected: rows.filter((r) => r.status === 'rejected').length,
  })).sort((a, b) => b.month.amount - a.month.amount || b.allTime.amount - a.allTime.amount || a.name.localeCompare(b.name))
}

const agentKey = (c: KpiCredit) => c.agentId ?? `name:${c.agentName ?? ''}`

/**
 * Transfer KPI (PKR 500 per verified transfer), with drill-down:
 *   Super Admin: companies → a company's users → a user's KPI records.
 *   Managers / admins: their company's users → a user's KPI records.
 *   Agents / closers: their own KPI records.
 * Follows the Dashboard's Company / Agent filters. Totals count verified
 * transfers only (rejected ones are listed but earn nothing).
 */
export default function TransferKpiPanel({ companyId = '', agentId = '' }: { companyId?: string; agentId?: string }) {
  const [state, setState] = useState<{ loading: boolean; error: string; available: boolean; scope: 'own' | 'team'; isSuperAdmin: boolean; credits: KpiCredit[] }>(
    { loading: true, error: '', available: true, scope: 'own', isSuperAdmin: false, credits: [] },
  )
  const [now, setNow] = useState<Date | null>(null)
  // Drill-down selection (starts from the Dashboard filters).
  const [pickedCompany, setPickedCompany] = useState('')
  const [pickedAgent, setPickedAgent] = useState('')

  useEffect(() => {
    let cancelled = false
    getTransferKpi().then((res) => {
      if (cancelled) return
      setNow(new Date())   // "this month" in the viewer's own time zone
      setState({ loading: false, error: res.ok ? '' : (res.message ?? 'Could not load the Transfer KPI.'), available: res.available, scope: res.scope, isSuperAdmin: !!res.isSuperAdmin, credits: res.credits })
    }).catch(() => { if (!cancelled) setState((s) => ({ ...s, loading: false, error: 'Could not load the Transfer KPI.' })) })
    return () => { cancelled = true }
  }, [])

  const team = state.scope === 'team'
  const superAdmin = state.isSuperAdmin
  // Dashboard-wide filters narrow everything; the drill-down narrows further.
  const company = companyId || pickedCompany
  const agent = agentId || pickedAgent
  const inCompany = useMemo(() => (company ? state.credits.filter((c) => c.tenantId === company) : state.credits), [state.credits, company])
  const inAgent = useMemo(() => (agent ? inCompany.filter((c) => c.agentId === agent || agentKey(c) === agent) : inCompany), [inCompany, agent])

  const level: 'companies' | 'agents' | 'records' =
    !team || agent ? 'records' : superAdmin && !company ? 'companies' : 'agents'
  const shown = level === 'records' ? inAgent : inCompany
  const totals = useMemo(() => totalsOf(shown, now), [shown, now])
  const companyGroups = useMemo(() => groupBy(state.credits, (c) => c.tenantId ?? 'none', (c) => c.companyName ?? 'Unknown company', now), [state.credits, now])
  const agentGroups = useMemo(() => groupBy(inCompany, agentKey, (c) => c.agentName ?? 'Unknown agent', now), [inCompany, now])

  const monthLabel = now ? now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'This month'
  const companyName = state.credits.find((c) => c.tenantId === company)?.companyName ?? null
  const agentName = inCompany.find((c) => c.agentId === agent || agentKey(c) === agent)?.agentName ?? null

  const crumbs: { label: string; onClick?: () => void }[] = []
  if (team) {
    if (superAdmin) crumbs.push({ label: 'All companies', onClick: companyId ? undefined : () => { setPickedCompany(''); setPickedAgent('') } })
    if (superAdmin && company) crumbs.push({ label: companyName ?? 'Company', onClick: agentId ? undefined : () => setPickedAgent('') })
    if (!superAdmin) crumbs.push({ label: 'All agents', onClick: agentId ? undefined : () => setPickedAgent('') })
    if (agent) crumbs.push({ label: agentName ?? 'Agent' })
  }

  return (
    <section className="card kpi-panel" aria-labelledby="transfer-kpi-title">
      <header className="kpi-panel-head">
        <div>
          <span className="kpi-panel-kicker">Incentives</span>
          <h3 id="transfer-kpi-title">Transfer KPI</h3>
          <p className="subtle">{team ? 'PKR 500 per verified transfer. Click a row to see more.' : 'You earn PKR 500 for every transfer that is verified.'}</p>
        </div>
        <Link prefetch={false} href="/kpi" className="btn" style={{ alignSelf: 'flex-start', textDecoration: 'none' }}>View all KPI records →</Link>
      </header>

      {state.loading ? <p className="subtle">Loading…</p>
        : !state.available ? <p className="subtle">Transfer KPI isn&apos;t set up yet. Run <code>database/transfer-kpi-v2.sql</code> in Supabase.</p>
        : state.error ? <p className="subtle" role="alert">{state.error}</p>
        : (
          <>
            {crumbs.length > 1 && (
              <nav className="kpi-crumbs" aria-label="KPI drill-down">
                {crumbs.map((c, i) => (
                  <span key={i} className="kpi-crumb">
                    {i > 0 && <ChevronRight size={13} aria-hidden="true" />}
                    {c.onClick && i < crumbs.length - 1
                      ? <button type="button" onClick={c.onClick}>{c.label}</button>
                      : <strong aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</strong>}
                  </span>
                ))}
              </nav>
            )}

            <div className="kpi-panel-stats">
              <div className="kpi-panel-stat">
                <span className="kpi-panel-stat-icon"><CalendarDays size={16} aria-hidden="true" /></span>
                <div><span>{monthLabel}</span><strong>{pkr(totals.month.amount)}</strong><small>{totals.month.count} verified transfer{totals.month.count === 1 ? '' : 's'}</small></div>
              </div>
              <div className="kpi-panel-stat">
                <span className="kpi-panel-stat-icon"><Wallet size={16} aria-hidden="true" /></span>
                <div><span>All-time</span><strong>{pkr(totals.allTime.amount)}</strong><small>{totals.allTime.count} verified transfer{totals.allTime.count === 1 ? '' : 's'}</small></div>
              </div>
            </div>

            {level === 'companies' && (
              companyGroups.length === 0 ? <p className="subtle">No verified transfers yet.</p> : (
                <GroupTable title="Companies" first="Company" icon groups={companyGroups} monthLabel={monthLabel}
                  onPick={(key) => { setPickedCompany(key); setPickedAgent('') }} />
              )
            )}
            {level === 'agents' && (
              agentGroups.length === 0 ? <p className="subtle">No KPI records for {companyName ?? 'this company'} yet.</p> : (
                <GroupTable title={superAdmin ? `${companyName ?? 'Company'} · users with KPI` : 'Users with KPI'} first="User" groups={agentGroups} monthLabel={monthLabel}
                  onPick={(key) => setPickedAgent(key)} />
              )
            )}
            {level === 'records' && (
              shown.length === 0 ? <p className="subtle">No verified transfers yet{team ? ' for this user' : ' — once a closer or manager verifies one of your transfers, it appears here'}.</p> : (
                <div className="tbl-wrap">
                  <table className="tbl kpi-records-table">
                    <thead><tr><th>Reviewed on</th><th>Lead</th><th>Reviewed by</th><th>Note</th><th style={{ textAlign: 'right' }}>KPI</th></tr></thead>
                    <tbody>{shown.map((c, i) => (
                      <tr key={`${c.practiceCode}|${c.verifiedAt}|${i}`}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.verifiedAt)}</td>
                        <td><strong>{c.practiceName ?? '—'}</strong><div className="subtle mono" style={{ fontSize: 10.5 }}>{c.practiceCode ?? ''}</div></td>
                        <td>{c.verifiedByName ?? '—'}</td>
                        <td className="kpi-note-cell">{c.note ? <span title={c.note}>{c.note}</span> : <span className="subtle">—</span>}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{c.status === 'rejected'
                          ? <span className="kpi-rejected"><XCircle size={14} aria-hidden="true" /> Rejected</span>
                          : <span className="kpi-verified"><BadgeCheck size={14} aria-hidden="true" /> +{c.currency} {c.amount.toLocaleString()}</span>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )
            )}
          </>
        )}
    </section>
  )
}

function GroupTable({ title, first, groups, monthLabel, onPick, icon = false }: {
  title: string; first: string; groups: Group[]; monthLabel: string; onPick: (key: string) => void; icon?: boolean
}) {
  return (
    <div>
      <h4 className="kpi-group-title">{title}</h4>
      <div className="tbl-wrap">
        <table className="tbl kpi-panel-table kpi-group-table">
          <thead><tr><th>{first}</th><th>{monthLabel}</th><th>All-time</th><th>Rejected</th><th aria-label="Open" /></tr></thead>
          <tbody>{groups.map((g) => (
            <tr key={g.key} className="kpi-group-row" tabIndex={0} role="button" aria-label={`Show ${g.name}`}
              onClick={() => onPick(g.key)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(g.key) } }}>
              <td><strong>{icon && <Building2 size={14} aria-hidden="true" style={{ marginRight: 6, verticalAlign: '-2px', color: 'var(--accent)' }} />}{g.name}</strong></td>
              <td><strong>{pkr(g.month.amount)}</strong> <span className="subtle">· {g.month.count}</span></td>
              <td><strong>{pkr(g.allTime.amount)}</strong> <span className="subtle">· {g.allTime.count}</span></td>
              <td>{g.rejected || <span className="subtle">0</span>}</td>
              <td style={{ textAlign: 'right' }}><ChevronRight size={16} aria-hidden="true" className="kpi-group-arrow" /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
