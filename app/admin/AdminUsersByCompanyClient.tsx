'use client'

import { useState } from 'react'
import CompanyTeamClient, { type TeamMember } from './CompanyTeamClient' // ← CHANGED: shared table with Rename / Delete

// Super Admin → Admin → Users & Teams. Pick a company on the left; its users
// are listed on the right with Rename and Delete for Managers, Team Leads,
// Agents and Closers (same table a Company Admin sees for their own team).
export default function AdminUsersByCompanyClient({
  allCompanyNames,
  usersByCompany,
  myId,
  myLevel,
}: {
  allCompanyNames: string[]
  usersByCompany: Record<string, TeamMember[]> // ← CHANGED: carries id + role level
  myId: string     // ← ADDED
  myLevel: number  // ← ADDED
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
          // ← CHANGED: key resets an open Rename when switching company
          <CompanyTeamClient key={selected} members={currentUsers} canRemove myId={myId} myLevel={myLevel} />
        )}
      </div>
    </div>
  )
}
