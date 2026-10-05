'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { removeCompanyUser } from '../admin-manage-actions'
import { roleLabel } from '../../lib/roles'

export type TeamMember = {
  id: string
  full_name: string | null
  email: string | null
  status: string | null
  roleKey: string | null
  roleLevel: number | null
}

function statusBadge(status: string | null) {
  const s = (status || '').toLowerCase()
  const cls = s === 'active' ? 'badge-green' : s === 'inactive' ? 'badge-grey' : 'badge-amber'
  return <span className={`badge ${cls}`}>{s === 'suspended' ? 'removed' : status}</span>
}

// "Your Team" table. Company Admins also get a Remove action for active,
// more junior teammates (never themselves). Everyone else sees it read-only.
export default function CompanyTeamClient({ members, canRemove, myId, myLevel }: {
  members: TeamMember[]
  canRemove: boolean
  myId: string
  myLevel: number
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const removable = (m: TeamMember) =>
    canRemove && m.id !== myId && (m.status ?? '') === 'active' && (m.roleLevel ?? 0) > myLevel

  const remove = async (m: TeamMember) => {
    const name = m.full_name || m.email || 'this user'
    const confirmed = window.confirm(
      `Remove ${name} from your company?\n\n` +
      `• They will no longer be able to sign in.\n` +
      `• Their currently assigned leads will return to your lead pool.\n` +
      `• Their saved worksheets, call history and sales are kept.\n\n` +
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
      setMessage({ ok: false, text: 'Could not remove this user. Please try again.' })
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
                <td>{m.full_name}</td>
                <td>{m.email}</td>
                <td><strong>{roleLabel(m.roleKey ?? undefined)}</strong></td>
                <td>{statusBadge(m.status)}</td>
                {canRemove && (
                  <td style={{ textAlign: 'right' }}>
                    {removable(m) ? (
                      <button
                        type="button"
                        className="btn"
                        style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        disabled={busyId !== null}
                        onClick={() => remove(m)}
                      >
                        {busyId === m.id ? 'Removing…' : 'Remove'}
                      </button>
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
