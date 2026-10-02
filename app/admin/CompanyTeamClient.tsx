'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserRoundX } from 'lucide-react'
import { roleLabel } from '../../lib/roles'
import { removeCompanyUser } from '../admin-manage-actions'

type TeamMember = {
  id: string
  name: string
  email: string
  roleKey: string
  level: number
  status: string
}

function statusBadge(status: string) {
  const normalized = status.toLowerCase()
  const className = normalized === 'active' ? 'badge-green' : normalized === 'inactive' ? 'badge-grey' : 'badge-amber'
  return <span className={`badge ${className}`}>{status}</span>
}

export default function CompanyTeamClient({
  members,
  currentUserId,
  currentRoleLevel,
}: {
  members: TeamMember[]
  currentUserId: string
  currentRoleLevel: number
}) {
  const router = useRouter()
  const [busyUserId, setBusyUserId] = useState('')
  const [message, setMessage] = useState('')

  const removeMember = async (member: TeamMember) => {
    const confirmed = window.confirm(
      `Remove ${member.name} from the active team? They will no longer be able to sign in. Their worksheet and activity history will be kept.`
    )
    if (!confirmed) return

    setBusyUserId(member.id)
    setMessage('')
    const result = await removeCompanyUser(member.id)
    setBusyUserId('')
    setMessage(result.message ?? (result.ok ? 'User removed.' : 'Could not remove user.'))
    if (result.ok) router.refresh()
  }

  return (
    <>
      {message && <p className="subtle" role="status" style={{ color: message.startsWith('User removed') ? 'var(--ok)' : 'var(--danger)' }}>{message}</p>}
      {!members.length ? (
        <p className="subtle">No users in this company yet.</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {members.map(member => {
                const canRemove = member.status === 'active'
                  && member.id !== currentUserId
                  && member.level > currentRoleLevel
                return (
                  <tr key={member.id}>
                    <td>{member.name}</td>
                    <td>{member.email}</td>
                    <td><strong>{roleLabel(member.roleKey)}</strong></td>
                    <td>{statusBadge(member.status)}</td>
                    <td>
                      {canRemove ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void removeMember(member)}
                          disabled={busyUserId === member.id}
                          aria-label={`Remove ${member.name}`}
                          title="Remove user and revoke sign-in access"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--danger)' }}
                        >
                          <UserRoundX size={14} />
                          {busyUserId === member.id ? 'Removing…' : 'Remove'}
                        </button>
                      ) : <span className="subtle">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
