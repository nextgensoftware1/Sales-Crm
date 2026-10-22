'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { removeCompanyUser, renameCompanyUser } from '../admin-manage-actions' // ← CHANGED: + renameCompanyUser
import { roleLabel } from '../../lib/roles'

export type TeamMember = {
  id: string
  full_name: string | null
  email: string | null
  status: string | null
  roleKey: string | null
  roleLevel: number | null
}

// ← ADDED: only these roles can be renamed or deleted (matches the server check).
const MANAGEABLE_ROLES = ['manager', 'team_lead', 'agent', 'closer']

function statusBadge(status: string | null) {
  const s = (status || '').toLowerCase()
  const cls = s === 'active' ? 'badge-green' : s === 'inactive' ? 'badge-grey' : 'badge-amber'
  return <span className={`badge ${cls}`}>{s === 'suspended' ? 'deleted' : status}</span> // ← CHANGED: "deleted"
}

// Team table. Company Admin (own company) and Super Admin (any company) get
// Rename and Delete for Managers, Team Leads, Agents and Closers.
// Everyone else sees it read-only.
// ← CHANGED: Rename added; also used by Super Admin's "Users by Company".
export default function CompanyTeamClient({ members, canRemove, myId, myLevel }: {
  members: TeamMember[]
  /** Can rename + delete (Company Admin / Super Admin). */
  canRemove: boolean
  myId: string
  myLevel: number
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null) // ← ADDED
  const [draftName, setDraftName] = useState('')                  // ← ADDED

  // ← CHANGED: manageable = a junior Manager / Team Lead / Agent / Closer
  const manageable = (m: TeamMember) =>
    canRemove && m.id !== myId && MANAGEABLE_ROLES.includes(m.roleKey ?? '') && (m.roleLevel ?? 0) > myLevel
  const removable = (m: TeamMember) => manageable(m) && (m.status ?? '') === 'active'

  // ← ADDED: rename in place
  const startRename = (m: TeamMember) => { setEditingId(m.id); setDraftName(m.full_name ?? ''); setMessage(null) }
  const saveRename = async (m: TeamMember) => {
    const name = draftName.replace(/\s+/g, ' ').trim()
    if (!name) { setMessage({ ok: false, text: 'Enter a name.' }); return }
    setBusyId(m.id)
    setMessage(null)
    try {
      const res = await renameCompanyUser(m.id, name)
      setMessage({ ok: res.ok, text: res.message })
      if (res.ok) { setEditingId(null); router.refresh() }
    } catch {
      setMessage({ ok: false, text: 'Could not rename this user. Please try again.' })
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (m: TeamMember) => {
    const name = m.full_name || m.email || 'this user'
    const confirmed = window.confirm(
      `Delete ${name}?\n\n` +
      `• They will no longer be able to sign in.\n` +
      `• They will be removed from every Agent / Assign-to list.\n` +
      `• Their currently assigned leads will return to the lead pool.\n` +
      `• Their saved work stays on Active Call / Active Email under their name.\n\n` +
      `This cannot be undone from this page.`
    )
    if (!confirmed) return
    setBusyId(m.id)
    setMessage(null)
    try {
      const res = await removeCompanyUser(m.id)
      setMessage({ ok: res.ok, text: res.message })
      if (res.ok) router.refresh()
    } catch {
      setMessage({ ok: false, text: 'Could not delete this user. Please try again.' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} style={{ margin: '0 0 12px', fontSize: 13, color: message.ok ? 'var(--ok)' : 'var(--danger)' }}>
          {message.text}
        </p>
      )}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Role</th><th>Status</th>
              {canRemove && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  {editingId === m.id ? (
                    // ← ADDED: inline rename (Enter saves, Esc cancels)
                    <input className="input" autoFocus value={draftName} maxLength={100} aria-label={`New name for ${m.full_name ?? 'user'}`}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(m); if (e.key === 'Escape') setEditingId(null) }}
                      style={{ minWidth: 180 }} />
                  ) : m.full_name}
                </td>
                <td>{m.email}</td>
                <td><strong>{roleLabel(m.roleKey ?? undefined)}</strong></td>
                <td>{statusBadge(m.status)}</td>
                {canRemove && (
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {editingId === m.id ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="btn btn-primary" disabled={busyId !== null} onClick={() => saveRename(m)}>
                          {busyId === m.id ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className="btn" disabled={busyId !== null} onClick={() => setEditingId(null)}>Cancel</button>
                      </span>
                    ) : manageable(m) ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button type="button" className="btn" disabled={busyId !== null} onClick={() => startRename(m)}>Rename</button>
                        {removable(m) && (
                          <button
                            type="button"
                            className="btn"
                            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            disabled={busyId !== null}
                            onClick={() => remove(m)}
                          >
                            {busyId === m.id ? 'Deleting…' : 'Delete'}
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="subtle" style={{ fontSize: 12 }}>{m.id === myId ? 'You' : '—'}</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
