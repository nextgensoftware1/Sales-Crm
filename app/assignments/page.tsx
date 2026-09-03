'use client'

import { useEffect, useState } from 'react'
import {
  getMyAssignmentSummary,
  getAssignedLeads,
  unassignLead,
  getMyIncomingCodes,
} from '../manage-assignments-actions'

type Person = { id: string; full_name: string; role: string; count: number }
type Lead = { practiceCode: string; name: string; state: string | null; specialty: string | null; assignedAt: string }

const C = {
  bg: '#0a0e14', panel: '#0f1620', panelAlt: '#0b1119', line: '#1c2836',
  text: '#e6edf3', dim: '#8a99a8', faint: '#566472',
  blue: '#3b82f6', green: '#22c55e', red: '#ef4444', amber: '#f59e0b', cyan: '#06b6d4',
}

export default function ManageAssignmentsPage() {
  const [people, setPeople] = useState<Person[]>([])
  const [selected, setSelected] = useState<string>('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [incoming, setIncoming] = useState<Set<string>>(new Set())

  // load the summary of people I've assigned to + which leads came to me from above
  useEffect(() => {
    (async () => {
      setLoading(true)
      const res = await getMyAssignmentSummary()
      if (res.ok && res.people) setPeople(res.people)
      else setMsg(res.message ?? 'Could not load assignments.')
      const codes = await getMyIncomingCodes()
      setIncoming(new Set(codes))
      setLoading(false)
    })()
  }, [])

  const pickPerson = async (id: string) => {
    setSelected(id)
    setLeads([])
    setMsg('')
    const res = await getAssignedLeads(id)
    if (res.ok && res.leads) setLeads(res.leads)
    else setMsg(res.message ?? 'Could not load leads.')
  }

  const remove = async (code: string) => {
    const res = await unassignLead(code, selected)
    setMsg(res.message)
    if (res.ok) {
      setLeads((prev) => prev.filter((l) => l.practiceCode !== code))
      setPeople((prev) => prev.map((p) => p.id === selected ? { ...p, count: p.count - 1 } : p))
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'ui-sans-serif, system-ui, sans-serif', padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Manage Assignments</h1>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>Leads you assigned. Remove one to send it back to the unassigned pool.</div>
        </div>
        <a href="/dashboard" style={{ fontSize: 13, color: C.blue, textDecoration: 'none' }}>← Back to dashboard</a>
      </div>

      {loading ? (
        <p style={{ color: C.dim }}>Loading…</p>
      ) : people.length === 0 ? (
        <p style={{ color: C.faint }}>You haven’t assigned any leads yet.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
          {/* People list */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 10px' }}>My reports</div>
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => pickPerson(p.id)}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: selected === p.id ? C.panelAlt : 'transparent',
                  border: `1px solid ${selected === p.id ? C.blue : 'transparent'}`,
                  color: C.text, borderRadius: 8, padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
                }}
              >
                <span>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.full_name}</div>
                  <div style={{ fontSize: 11, color: C.faint }}>{p.role}</div>
                </span>
                <span style={{ fontSize: 13, color: C.amber, background: C.panelAlt, borderRadius: 999, padding: '2px 10px' }}>{p.count}</span>
              </button>
            ))}
          </div>

          {/* Leads for selected person */}
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 }}>
            {!selected ? (
              <p style={{ color: C.faint }}>Pick a person on the left to see the leads you assigned them.</p>
            ) : leads.length === 0 ? (
              <p style={{ color: C.faint }}>No leads assigned to this person (or all removed).</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: C.dim, fontSize: 11, textTransform: 'uppercase' }}>Practice</th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: C.dim, fontSize: 11, textTransform: 'uppercase' }}>State</th>
                    <th style={{ textAlign: 'left', padding: '10px 8px', color: C.dim, fontSize: 11, textTransform: 'uppercase' }}>Specialty</th>
                    <th style={{ textAlign: 'right', padding: '10px 8px', color: C.dim, fontSize: 11, textTransform: 'uppercase' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.practiceCode} style={{ borderBottom: `1px solid ${C.line}` }}>
                      <td style={{ padding: '10px 8px', fontWeight: 600 }}>
                        {incoming.has(l.practiceCode) && (
                          <span title="Also assigned to you by your manager" style={{ color: C.amber, marginRight: 6 }}>★</span>
                        )}
                        <a href={`/practice/${l.practiceCode}`} style={{ color: C.cyan, textDecoration: 'none' }}>{l.name}</a>
                      </td>
                      <td style={{ padding: '10px 8px', color: C.dim }}>{l.state ?? '—'}</td>
                      <td style={{ padding: '10px 8px', color: C.dim }}>{l.specialty ?? '—'}</td>
                      <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                        <button
                          onClick={() => remove(l.practiceCode)}
                          style={{ background: 'transparent', color: C.red, border: `1px solid ${C.red}`, borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {msg && <p style={{ marginTop: 16, fontSize: 13, color: C.dim }}>{msg}</p>}
    </div>
  )
}