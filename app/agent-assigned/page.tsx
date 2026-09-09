'use client'

import { useEffect, useState } from 'react'
import { getAgentAssignedLeads } from '../agent-assigned-actions'

type Lead = { practiceCode: string; name: string; state: string | null; specialty: string | null; assignedBy: string | null; assignedAt: string | null }
type AgentGroup = { agentId: string; agentName: string; role: string; leads: Lead[] }

const C = {
  bg: '#0a0e14', panel: '#0f1620', panelAlt: '#0b1119', line: '#1c2836',
  text: '#e6edf3', dim: '#8a99a8', faint: '#566472', blue: '#3b82f6', cyan: '#22d3ee', amber: '#f59e0b',
}

const fmt = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function AgentAssignedLeadsPage() {
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
        // auto-select the first agent that has leads
        const first = res.groups.find((g) => g.leads.length > 0) ?? res.groups[0]
        if (first) setSelected(first.agentId)
      } else setMsg(res.message ?? 'Could not load.')
      setLoading(false)
    })()
  }, [])

  const current = groups.find((g) => g.agentId === selected)

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'ui-sans-serif, system-ui, sans-serif', padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Agent Assigned Leads</h1>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>Leads currently assigned to each agent/closer.</div>
        </div>
        <a href="/" style={{ fontSize: 13, color: C.blue, textDecoration: 'none' }}>← Back to practices</a>
      </div>

      {loading ? (
        <p style={{ color: C.dim }}>Loading…</p>
      ) : groups.length === 0 ? (
        <p style={{ color: C.faint }}>{msg || 'No agents found.'}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
          {/* Agent list */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 10px' }}>Agents</div>
            {groups.map((g) => (
              <button key={g.agentId} onClick={() => setSelected(g.agentId)}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: selected === g.agentId ? C.panelAlt : 'transparent',
                  border: `1px solid ${selected === g.agentId ? C.blue : 'transparent'}`,
                  color: C.text, borderRadius: 8, padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
                }}>
                <span>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{g.agentName}</div>
                  <div style={{ fontSize: 11, color: C.faint }}>{g.role}</div>
                </span>
                <span style={{ fontSize: 13, color: C.amber, background: C.panelAlt, borderRadius: 999, padding: '2px 10px' }}>{g.leads.length}</span>
              </button>
            ))}
          </div>

          {/* Leads for selected agent */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 }}>
            {!current ? (
              <p style={{ color: C.faint }}>Pick an agent.</p>
            ) : current.leads.length === 0 ? (
              <p style={{ color: C.faint }}>No leads assigned to {current.agentName} yet.</p>
            ) : (
              <>
                <div style={{ fontSize: 13, color: C.dim, marginBottom: 10 }}>
                  {current.leads.length} lead(s) assigned to {current.agentName}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                      <th style={th}>Practice</th>
                      <th style={th}>State</th>
                      <th style={th}>Specialty</th>
                      <th style={th}>Assigned By</th>
                      <th style={th}>Assigned On</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.leads.map((l) => (
                      <tr key={l.practiceCode} style={{ borderBottom: `1px solid ${C.line}` }}>
                        <td style={td}>
                          <a href={`/practice/${l.practiceCode}`} style={{ color: C.cyan, textDecoration: 'none' }}>{l.name}</a>
                        </td>
                        <td style={{ ...td, color: C.dim }}>{l.state ?? '—'}</td>
                        <td style={{ ...td, color: C.dim }}>{l.specialty ?? '—'}</td>
                        <td style={{ ...td, color: C.dim }}>{l.assignedBy ?? '—'}</td>
                        <td style={{ ...td, color: C.dim, fontSize: 12 }}>{fmt(l.assignedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px', color: '#8a99a8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }
const td: React.CSSProperties = { padding: '8px', textAlign: 'left' }