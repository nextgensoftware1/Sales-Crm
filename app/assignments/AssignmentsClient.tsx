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

export default function AssignmentsClient() {
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
    <>
      {loading ? (
        <p className="subtle">Loading…</p>
      ) : people.length === 0 ? (
        <p className="subtle">You haven’t assigned any leads yet.</p>
      ) : (
        <div className="grid-2-sidebar-sm">
          {/* People list */}
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 10px' }}>My reports</div>
            {people.map((p) => (
              <button
                key={p.id}
                onClick={() => pickPerson(p.id)}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: selected === p.id ? 'var(--surface-2)' : 'transparent',
                  border: `1px solid ${selected === p.id ? 'var(--accent)' : 'transparent'}`,
                  color: 'var(--ink)', borderRadius: 8, padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
                }}
              >
                <span>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.full_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.role}</div>
                </span>
                <span className="badge badge-amber">{p.count}</span>
              </button>
            ))}
          </div>

          {/* Leads for selected person */}
          <div className="card">
            {!selected ? (
              <p className="subtle">Pick a person on the left to see the leads you assigned them.</p>
            ) : leads.length === 0 ? (
              <p className="subtle">No leads assigned to this person (or all removed).</p>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Practice</th>
                      <th>State</th>
                      <th>Specialty</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => (
                      <tr key={l.practiceCode}>
                        <td style={{ fontWeight: 600 }}>
                          {incoming.has(l.practiceCode) && (
                            <span title="Also assigned to you by your manager" style={{ color: 'var(--warn)', marginRight: 6 }}>★</span>
                          )}
                          <a href={`/practice/${l.practiceCode}`}>{l.name}</a>
                        </td>
                        <td>{l.state ?? '—'}</td>
                        <td>{l.specialty ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            onClick={() => remove(l.practiceCode)}
                            style={{ background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 6, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {msg && <p className="subtle" style={{ marginTop: 16 }}>{msg}</p>}
    </>
  )
}
