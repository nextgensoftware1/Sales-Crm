'use client'

import { useState } from 'react'
import { roleLabel } from '../../lib/roles'

type CompanyUser = { name: string; email: string; roleKey: string; status: string }

function statusBadge(status: string) {
  const s = (status || '').toLowerCase()
  const cls = s === 'active' ? 'badge-green' : s === 'inactive' ? 'badge-grey' : 'badge-amber'
  return <span className={`badge ${cls}`}>{status}</span>
}

export default function AdminUsersByCompanyClient({
  allCompanyNames,
  usersByCompany,
}: {
  allCompanyNames: string[]
  usersByCompany: Record<string, CompanyUser[]>
}) {
  const [selected, setSelected] = useState(allCompanyNames[0] ?? '')
  const currentUsers = usersByCompany[selected] ?? []

  if (allCompanyNames.length === 0) {
    return <p className="subtle">No companies are registered yet.</p>
  }

  return (
    <div className="grid-2-sidebar-sm">
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 10px' }}>
          Companies
        </div>
        {allCompanyNames.map((name) => {
          const count = usersByCompany[name]?.length ?? 0
          const isSelected = selected === name
          return (
            <button
              key={name}
              onClick={() => setSelected(name)}
              style={{
                width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: isSelected ? 'var(--surface-2)' : 'transparent',
                border: `1px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
                color: 'var(--ink)', borderRadius: 8, padding: '10px 12px', marginBottom: 4, cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
              <span className={count > 0 ? 'badge badge-blue' : 'badge badge-grey'}>{count}</span>
            </button>
          )
        })}
      </div>
      <div>
        <div className="subtle" style={{ marginBottom: 10 }}>
          {currentUsers.length} user{currentUsers.length === 1 ? '' : 's'} at {selected}
        </div>
        {currentUsers.length === 0 ? (
          <p className="subtle">No users yet.</p>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr>
              </thead>
              <tbody>
                {currentUsers.map((u, i) => (
                  <tr key={i}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td><strong>{roleLabel(u.roleKey)}</strong></td>
                    <td>{statusBadge(u.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
