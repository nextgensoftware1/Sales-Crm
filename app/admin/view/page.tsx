'use client'

import { useEffect, useState } from 'react'
import { listUsersByRole, getLeadsForUser } from '../../role-view-actions'

type UserRow = { id: string; full_name: string; company: string }
type Lead = { practiceCode: string; name: string; state: string | null; specialty: string | null }

const C = {
  bg: '#0a0e14', panel: '#0f1620', panelAlt: '#0b1119', line: '#1c2836',
  text: '#e6edf3', dim: '#8a99a8', faint: '#566472', blue: '#3b82f6', cyan: '#22d3ee',
}

const ROLES = [
  { key: 'company_admin', label: 'Company Admin' },
  { key: 'manager', label: 'Manager' },
  { key: 'team_lead', label: 'Team Lead' },
  { key: 'agent', label: 'Agent' },
  { key: 'closer', label: 'Closer' },
]

export default function RoleView() {
  const [roleKey, setRoleKey] = useState('company_admin')
  const [users, setUsers] = useState<UserRow[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    (async () => {
      setLeads([]); setSelectedUser(''); setMsg('')
      const res = await listUsersByRole(roleKey)
      if (res.ok && res.users) setUsers(res.users)
      else setMsg(res.message ?? 'Could not load users.')
    })()
  }, [roleKey])

  const pickUser = async (id: string) => {
    setSelectedUser(id)
    setLeads([])
    const res = await getLeadsForUser(id)
    if (res.ok && res.leads) setLeads(res.leads)
    if (res.message) setMsg(res.message)
    else if (!res.ok) setMsg(res.message ?? 'Could not load leads.')
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'ui-sans-serif, system-ui, sans-serif', padding: '28px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>View as Role</h1>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 4 }}>Super Admin — inspect exactly what each role sees.</div>
        </div>
        <a href="/admin" style={{ fontSize: 13, color: C.blue, textDecoration: 'none' }}>← Back to admin</a>
      </div>

      {/* Role tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {ROLES.map((r) => (
          <button key={r.key} onClick={() => setRoleKey(r.key)}
            style={{
              fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
              background: roleKey === r.key ? C.panel : 'transparent',
              border: `1px solid ${roleKey === r.key ? C.blue : C.line}`,
              color: roleKey === r.key ? C.text : C.dim,
            }}>
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        {/* Users of this role */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 11, color: C.faint, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 10px' }}>Users</div>
          {users.length === 0 ? (
            <p style={{ color: C.faint, fontSize: 13, padding: 8 }}>No users with this role.</p>
          ) : users.map((u) => (
            <button key={u.id} onClick={() => pickUser(u.id)}
              style={{
                width: '100%', textAlign: 'left', background: selectedUser === u.id ? C.panelAlt : 'transparent',
                border: `1px solid ${selectedUser === u.id ? C.blue : 'transparent'}`,
                color: C.text, borderRadius: 8, padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
              }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{u.full_name}</div>
              <div style={{ fontSize: 11, color: C.faint }}>{u.company}</div>
            </button>
          ))}
        </div>

        {/* Leads that user sees */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 }}>
          {!selectedUser ? (
            <p style={{ color: C.faint }}>Pick a user to see the leads they can access.</p>
          ) : leads.length === 0 ? (
            <p style={{ color: C.faint }}>This user currently sees no leads.</p>
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.dim, marginBottom: 10 }}>{leads.length} lead(s) visible to this user</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                    <th style={{ textAlign: 'left', padding: '8px', color: C.dim, fontSize: 11, textTransform: 'uppercase' }}>Practice</th>
                    <th style={{ textAlign: 'left', padding: '8px', color: C.dim, fontSize: 11, textTransform: 'uppercase' }}>State</th>
                    <th style={{ textAlign: 'left', padding: '8px', color: C.dim, fontSize: 11, textTransform: 'uppercase' }}>Specialty</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.practiceCode} style={{ borderBottom: `1px solid ${C.line}` }}>
                      <td style={{ padding: '8px' }}>
                        <a href={`/practice/${l.practiceCode}`} style={{ color: C.cyan, textDecoration: 'none' }}>{l.name}</a>
                      </td>
                      <td style={{ padding: '8px', color: C.dim }}>{l.state ?? '—'}</td>
                      <td style={{ padding: '8px', color: C.dim }}>{l.specialty ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      {msg && <p style={{ marginTop: 16, fontSize: 13, color: C.dim }}>{msg}</p>}
    </div>
  )
}