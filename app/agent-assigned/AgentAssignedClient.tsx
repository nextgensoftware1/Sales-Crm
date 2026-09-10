'use client'

import { useEffect, useState } from 'react'
import { getAgentAssignedLeads } from '../agent-assigned-actions'

type Lead = { practiceCode: string; name: string; state: string | null; specialty: string | null; assignedBy: string | null; assignedAt: string | null }
type AgentGroup = { agentId: string; agentName: string; role: string; leads: Lead[] }

const fmt = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function AgentAssignedClient() {
  const [groups, setGroups] = useState<AgentGroup[]>([])
  const [selected, setSelected] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      const res = await getAgentAssignedLeads()
      if (res.ok && res.groups) {
        setGroups(res.groups)
        const first = res.groups.find((g) => g.leads.length > 0) ?? res.groups[0]
        if (first) setSelected(first.agentId)
      } else setMsg(res.message ?? 'Could not load.')
      setLoading(false)
    })()
  }, [])

  const current = groups.find((g) => g.agentId === selected)

  return (
    <>
      {loading ? (
        <p className="subtle">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="subtle">{msg || 'No agents found.'}</p>
      ) : (
        <div className="grid-2-sidebar-sm">
          {/* Agent list */}
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 10px' }}>Agents</div>
            {groups.map((g) => (
              <button
                key={g.agentId}
                onClick={() => setSelected(g.agentId)}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: selected === g.agentId ? 'var(--surface-2)' : 'transparent',
                  border: `1px solid ${selected === g.agentId ? 'var(--accent)' : 'transparent'}`,
                  color: 'var(--ink)', borderRadius: 8, padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
                }}
              >
                <span>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{g.agentName}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{g.role}</div>
                </span>
                <span className="badge badge-amber">{g.leads.length}</span>
              </button>
            ))}
          </div>

          {/* Leads for selected agent */}
          <div className="card">
            {!current ? (
              <p className="subtle">Pick an agent.</p>
            ) : current.leads.length === 0 ? (
              <p className="subtle">No leads assigned to {current.agentName} yet.</p>
            ) : (
              <>
                <div className="subtle" style={{ marginBottom: 10 }}>{current.leads.length} lead(s) assigned to {current.agentName}</div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Practice</th>
                        <th>State</th>
                        <th>Specialty</th>
                        <th>Assigned By</th>
                        <th>Assigned On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.leads.map((l) => (
                        <tr key={l.practiceCode}>
                          <td><a href={`/practice/${l.practiceCode}`}>{l.name}</a></td>
                          <td>{l.state ?? '—'}</td>
                          <td>{l.specialty ?? '—'}</td>
                          <td>{l.assignedBy ?? '—'}</td>
                          <td style={{ fontSize: 12 }}>{fmt(l.assignedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
