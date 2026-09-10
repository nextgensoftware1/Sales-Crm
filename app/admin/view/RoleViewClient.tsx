'use client'

import { useEffect, useState } from 'react'
import { listUsersByRole, getLeadsForUser } from '../../role-view-actions'

type UserRow = { id: string; full_name: string; company: string }
type Lead = { practiceCode: string; name: string; state: string | null; specialty: string | null }

const ROLES = [
  { key: 'company_admin', label: 'Company Admin' },
  { key: 'manager', label: 'Manager' },
  { key: 'team_lead', label: 'Team Lead' },
  { key: 'agent', label: 'Agent' },
  { key: 'closer', label: 'Closer' },
]

export default function RoleViewClient() {
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
    <>
      {/* Role tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {ROLES.map((r) => (
          <button key={r.key} onClick={() => setRoleKey(r.key)}
            style={{
              fontSize: 13, padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
              background: roleKey === r.key ? 'var(--surface-2)' : 'transparent',
              border: `1px solid ${roleKey === r.key ? 'var(--accent)' : 'var(--border)'}`,
              color: roleKey === r.key ? 'var(--ink)' : 'var(--muted)',
            }}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid-2-sidebar">
        {/* Users of this role */}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 10px' }}>Users</div>
          {users.length === 0 ? (
            <p className="subtle" style={{ padding: 8 }}>No users with this role.</p>
          ) : users.map((u) => (
            <button key={u.id} onClick={() => pickUser(u.id)}
              style={{
                width: '100%', textAlign: 'left', background: selectedUser === u.id ? 'var(--surface-2)' : 'transparent',
                border: `1px solid ${selectedUser === u.id ? 'var(--accent)' : 'transparent'}`,
                color: 'var(--ink)', borderRadius: 8, padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
              }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{u.full_name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.company}</div>
            </button>
          ))}
        </div>

        {/* Leads that user sees */}
        <div className="card">
          {!selectedUser ? (
            <p className="subtle">Pick a user to see the leads they can access.</p>
          ) : leads.length === 0 ? (
            <p className="subtle">This user currently sees no leads.</p>
          ) : (
            <>
              <div className="subtle" style={{ marginBottom: 10 }}>{leads.length} lead(s) visible to this user</div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Practice</th>
                      <th>State</th>
                      <th>Specialty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => (
                      <tr key={l.practiceCode}>
                        <td><a href={`/practice/${l.practiceCode}`}>{l.name}</a></td>
                        <td>{l.state ?? '—'}</td>
                        <td>{l.specialty ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
      {msg && <p className="subtle" style={{ marginTop: 16 }}>{msg}</p>}
    </>
  )
}
