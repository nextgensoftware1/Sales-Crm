'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BadgeCheck, CalendarDays, Wallet } from 'lucide-react'
import { getTransferKpi, type KpiCredit } from '../kpi-actions'

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })

/** Same calendar month as `now`, in the viewer's own time zone. */
function inThisMonth(iso: string, now: Date) {
  const d = new Date(iso)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

type Totals = { count: number; amount: number }
const add = (t: Totals, amount: number) => ({ count: t.count + 1, amount: t.amount + amount })

/**
 * Transfer KPI: PKR 500 per verified transfer.
 * Agents / closers see their own earnings; managers and admins see each agent.
 * Both show this month and all-time.
 */
export default function TransferKpiPanel() {
  const [state, setState] = useState<{ loading: boolean; error: string; available: boolean; scope: 'own' | 'team'; credits: KpiCredit[] }>(
    { loading: true, error: '', available: true, scope: 'own', credits: [] },
  )
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false
    getTransferKpi().then((res) => {
      if (cancelled) return
      setNow(new Date())   // "this month" in the viewer's own time zone
      setState({ loading: false, error: res.ok ? '' : (res.message ?? 'Could not load the Transfer KPI.'), available: res.available, scope: res.scope, credits: res.credits })
    }).catch(() => { if (!cancelled) setState((s) => ({ ...s, loading: false, error: 'Could not load the Transfer KPI.' })) })
    return () => { cancelled = true }
  }, [])

  const summary = useMemo(() => {
    const month: Totals = { count: 0, amount: 0 }
    const allTime: Totals = { count: 0, amount: 0 }
    const byAgent = new Map<string, { name: string; month: Totals; allTime: Totals }>()
    if (!now) return { month, allTime, agents: [] as { name: string; month: Totals; allTime: Totals }[] }
    let m = month, a = allTime
    // Only verified transfers earn KPI; rejected ones are listed on the KPI page.
    for (const c of state.credits.filter((x) => x.status !== 'rejected')) {
      const thisMonth = inThisMonth(c.verifiedAt, now)
      a = add(a, c.amount)
      if (thisMonth) m = add(m, c.amount)
      const key = c.agentId ?? `name:${c.agentName ?? 'Unknown'}`
      const row = byAgent.get(key) ?? { name: c.agentName ?? 'Unknown agent', month: { count: 0, amount: 0 }, allTime: { count: 0, amount: 0 } }
      row.allTime = add(row.allTime, c.amount)
      if (thisMonth) row.month = add(row.month, c.amount)
      byAgent.set(key, row)
    }
    const agents = Array.from(byAgent.values()).sort((x, y) => y.month.amount - x.month.amount || y.allTime.amount - x.allTime.amount || x.name.localeCompare(y.name))
    return { month: m, allTime: a, agents }
  }, [state.credits, now])

  const monthLabel = now ? now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'This month'
  const team = state.scope === 'team'

  return (
    <section className="card kpi-panel" aria-labelledby="transfer-kpi-title">
      <header className="kpi-panel-head">
        <div>
          <span className="kpi-panel-kicker">Incentives</span>
          <h3 id="transfer-kpi-title">Transfer KPI</h3>
          <p className="subtle">{team ? 'PKR 500 per verified transfer, by agent.' : 'You earn PKR 500 for every transfer that is verified.'}</p>
        </div>
        <Link prefetch={false} href="/kpi" className="btn" style={{ alignSelf: 'flex-start', textDecoration: 'none' }}>View all KPI records →</Link>
      </header>

      {state.loading ? <p className="subtle">Loading…</p>
        : !state.available ? <p className="subtle">Transfer KPI isn&apos;t set up yet. Run <code>database/transfer-kpi.sql</code> in Supabase.</p>
        : state.error ? <p className="subtle" role="alert">{state.error}</p>
        : (
          <>
            <div className="kpi-panel-stats">
              <div className="kpi-panel-stat">
                <span className="kpi-panel-stat-icon"><CalendarDays size={16} aria-hidden="true" /></span>
                <div>
                  <span>{team ? `Team · ${monthLabel}` : monthLabel}</span>
                  <strong>{pkr(summary.month.amount)}</strong>
                  <small>{summary.month.count} verified transfer{summary.month.count === 1 ? '' : 's'}</small>
                </div>
              </div>
              <div className="kpi-panel-stat">
                <span className="kpi-panel-stat-icon"><Wallet size={16} aria-hidden="true" /></span>
                <div>
                  <span>{team ? 'Team · all-time' : 'All-time'}</span>
                  <strong>{pkr(summary.allTime.amount)}</strong>
                  <small>{summary.allTime.count} verified transfer{summary.allTime.count === 1 ? '' : 's'}</small>
                </div>
              </div>
            </div>

            {team ? (
              summary.agents.length === 0 ? <p className="subtle">No verified transfers yet.</p> : (
                <div className="tbl-wrap">
                  <table className="tbl kpi-panel-table">
                    <thead><tr><th>Agent</th><th>{monthLabel}</th><th>All-time</th></tr></thead>
                    <tbody>{summary.agents.map((a) => (
                      <tr key={a.name}>
                        <td><strong>{a.name}</strong></td>
                        <td><strong>{pkr(a.month.amount)}</strong> <span className="subtle">· {a.month.count}</span></td>
                        <td><strong>{pkr(a.allTime.amount)}</strong> <span className="subtle">· {a.allTime.count}</span></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )
            ) : (
              !state.credits.some((c) => c.status !== 'rejected') ? <p className="subtle">No verified transfers yet — once a closer or manager verifies one of your transfers, it appears here.</p> : (
                <ul className="kpi-panel-recent" aria-label="Recently verified transfers">
                  {state.credits.filter((c) => c.status !== 'rejected').slice(0, 6).map((c, i) => (
                    <li key={`${c.practiceCode}-${i}`}>
                      <BadgeCheck size={15} aria-hidden="true" />
                      <span className="kpi-panel-recent-name">{c.practiceName ?? c.practiceCode ?? 'Lead'}</span>
                      <span className="subtle">{fmtDate(c.verifiedAt)}{c.verifiedByName ? ` · by ${c.verifiedByName}` : ''}</span>
                      <strong>+{pkr(c.amount)}</strong>
                    </li>
                  ))}
                </ul>
              )
            )}
          </>
        )}
    </section>
  )
}
