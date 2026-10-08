'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, BadgeCheck, ClipboardList, Clock3, XCircle } from 'lucide-react'
import { getWorkOverview, type WorkOverview } from './overview-actions'
import { rangeLabel } from '../../lib/date-range'

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)

/**
 * "Worksheets & Transfers" on the Dashboard: worksheet and transfer totals,
 * transfer review outcomes, the Call Disposition breakdown (click one to use
 * it as a sub-filter) and per-agent numbers. Follows the Dashboard's date
 * range; Super Admin can pick a company, managers/admins an agent.
 */
export default function WorkOverviewPanel({ fromDate, toDate, companyId = '', agentId = '' }: {
  fromDate: string; toDate: string
  /** Dashboard-wide filters from the top bar. */
  companyId?: string; agentId?: string
}) {
  const [disposition, setDisposition] = useState('')
  const [data, setData] = useState<WorkOverview | null>(null)
  const [loading, setLoading] = useState(true)
  // Range label uses the viewer's local time, so it's set after load.
  const [label, setLabel] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setLabel(`${rangeLabel(fromDate)} – ${rangeLabel(toDate)}`), 0)
    return () => window.clearTimeout(id)
  }, [fromDate, toDate])

  useEffect(() => {
    let cancelled = false
    const id = window.setTimeout(() => {
      setLoading(true)
      getWorkOverview({ from: fromDate, to: toDate, companyId, agentId })
        .then((res) => { if (!cancelled) setData(res) })
        .catch(() => { if (!cancelled) setData(null) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 0)
    return () => { cancelled = true; window.clearTimeout(id) }
  }, [fromDate, toDate, companyId, agentId])

  const team = data?.scope === 'team' || data?.scope === 'all'
  const superAdmin = data?.scope === 'all'
  const dispositionTotal = data?.worksheets ?? 0
  const maxDisposition = Math.max(1, ...(data?.dispositions ?? []).map((d) => d.count))
  const agents = useMemo(() => {
    const rows = data?.agents ?? []
    if (!disposition) return rows
    return rows.filter((a) => (a.dispositions[disposition] ?? 0) > 0)
      .sort((a, b) => (b.dispositions[disposition] ?? 0) - (a.dispositions[disposition] ?? 0) || a.name.localeCompare(b.name))
  }, [data, disposition])

  return (
    <section className="card wo-panel" aria-labelledby="wo-title" aria-busy={loading}>
      <header className="wo-head">
        <div>
          <span className="kpi-panel-kicker">Activity overview</span>
          <h3 id="wo-title">Worksheets &amp; Transfers</h3>
          <p className="subtle">{label}{data?.scope === 'own' ? ' · your own work' : ''}</p>
        </div>
      </header>

      {!data && loading ? <p className="subtle">Loading…</p>
        : !data || !data.ok ? <p className="subtle" role="alert">{data?.message ?? 'Could not load the overview.'}</p>
        : (
          <div className={loading ? 'wo-body is-loading' : 'wo-body'}>
            <div className="wo-stats">
              <Stat icon={<ClipboardList size={16} />} label="Worksheets saved" value={data.worksheets} />
              <Stat icon={<ArrowLeftRight size={16} />} label="Transfers" value={data.transfers} />
              {data.kpiAvailable && <>
                <Stat icon={<BadgeCheck size={16} />} label="Verified" value={data.verified} sub={`${pct(data.verified, data.transfers)}% of transfers`} tone="ok" />
                <Stat icon={<XCircle size={16} />} label="Rejected" value={data.rejected} sub={`${pct(data.rejected, data.transfers)}% of transfers`} tone="bad" />
                <Stat icon={<Clock3 size={16} />} label="Pending review" value={data.pending} sub={`${pct(data.pending, data.transfers)}% of transfers`} tone="warn" />
              </>}
            </div>

            <div className="wo-grid">
              <div>
                <div className="wo-subhead">
                  <h4>Call Disposition</h4>
                  <span className="subtle">{disposition ? <>Filtering by <strong>{disposition}</strong> · <button type="button" className="wo-link" onClick={() => setDisposition('')}>show all</button></> : 'Click one to filter the agent table'}</span>
                </div>
                {data.dispositions.length === 0 ? <p className="subtle">No worksheets saved in this period.</p> : (
                  <ul className="wo-bars" aria-label="Worksheets by call disposition">
                    {data.dispositions.map((d) => (
                      <li key={d.name}>
                        <button type="button" className={'wo-bar' + (disposition === d.name ? ' is-active' : '')} aria-pressed={disposition === d.name}
                          onClick={() => setDisposition(disposition === d.name ? '' : d.name)}>
                          <span className="wo-bar-label">{d.name}</span>
                          <span className="wo-bar-track"><span className="wo-bar-fill" style={{ width: `${Math.max(3, (d.count / maxDisposition) * 100)}%` }} /></span>
                          <span className="wo-bar-value"><strong>{d.count}</strong> <span className="subtle">{pct(d.count, dispositionTotal)}%</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="wo-subhead"><h4>Handoff status</h4><span className="subtle">Transfers by status</span></div>
                {data.handoff.length === 0 ? <p className="subtle">No transfers in this period.</p> : (
                  <ul className="wo-chips">
                    {data.handoff.map((h) => <li key={h.name}><span>{h.name}</span><strong>{h.count}</strong></li>)}
                  </ul>
                )}
              </div>
            </div>

            {team && (
              <div>
                <div className="wo-subhead"><h4>By agent</h4><span className="subtle">{disposition ? `Agents with "${disposition}" worksheets` : 'Worksheets saved and transfers made'}</span></div>
                {agents.length === 0 ? <p className="subtle">No agent activity for these filters.</p> : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr>
                        <th>Agent</th>{superAdmin && <th>Company</th>}
                        {disposition && <th>{disposition}</th>}
                        <th>Worksheets</th><th>Transfers</th>{data.kpiAvailable && <><th>Verified</th><th>Rejected</th></>}
                      </tr></thead>
                      <tbody>{agents.map((a) => (
                        <tr key={a.id}>
                          <td><strong>{a.name}</strong></td>{superAdmin && <td>{a.company ?? '—'}</td>}
                          {disposition && <td><strong>{a.dispositions[disposition] ?? 0}</strong></td>}
                          <td>{a.worksheets}</td><td>{a.transfers}</td>
                          {data.kpiAvailable && <><td>{a.verified}</td><td>{a.rejected}</td></>}
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
    </section>
  )
}

function Stat({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <div className={'wo-stat' + (tone ? ` is-${tone}` : '')}>
      <span className="wo-stat-icon" aria-hidden="true">{icon}</span>
      <div><span>{label}</span><strong>{value.toLocaleString()}</strong>{sub && <small>{sub}</small>}</div>
    </div>
  )
}
