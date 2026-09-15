'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { suspendCompany, reactivateCompany, deleteCompany, getCompanyDeletionImpact } from '../admin-manage-actions'

type Company = { id: string; name: string; isPlatform: boolean; status: string; userCount: number }

function statusBadge(status: string) {
  const s = (status || '').toLowerCase()
  const cls = s === 'active' ? 'badge-green' : s === 'suspended' ? 'badge-amber' : 'badge-grey'
  return <span className={`badge ${cls}`}>{status}</span>
}

export default function CompaniesTable({ companies }: { companies: Company[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const handleSuspend = async (c: Company) => {
    if (!window.confirm(`Suspend "${c.name}"? This also temporarily deactivates all ${c.userCount} of its users. You can reactivate it any time.`)) return
    setBusyId(c.id); setMsg('')
    const res = await suspendCompany(c.id)
    setMsg(res.ok ? `"${c.name}" is now suspended.` : (res.message ?? 'Could not suspend company.'))
    setBusyId(null)
    if (res.ok) router.refresh()
  }

  const handleReactivate = async (c: Company) => {
    setBusyId(c.id); setMsg('')
    const res = await reactivateCompany(c.id)
    setMsg(res.ok ? `"${c.name}" is active again.` : (res.message ?? 'Could not reactivate company.'))
    setBusyId(null)
    if (res.ok) router.refresh()
  }

  const handleDelete = async (c: Company) => {
    setBusyId(c.id); setMsg('')
    const impact = await getCompanyDeletionImpact(c.id)
    const userWarning = impact.ok && impact.userCount ? ` It still has ${impact.userCount} user(s).` : ''

    const proceed = window.confirm(
      `Permanently DELETE "${c.name}"?${userWarning}\n\nThis cannot be undone. Type DELETE on the next dialog to confirm.`
    )
    if (!proceed) { setBusyId(null); return }
    const typed = window.prompt('Type DELETE to confirm permanent deletion:')
    if (typed !== 'DELETE') { setMsg('Cancelled — you must type DELETE exactly.'); setBusyId(null); return }

    const res = await deleteCompany(c.id)
    setMsg(res.ok ? `"${c.name}" was permanently deleted.` : (res.message ?? 'Could not delete company.'))
    setBusyId(null)
    if (res.ok) router.refresh()
  }

  return (
    <div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Company</th>
              <th>Type</th>
              <th>Status</th>
              <th>Users</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name}{' '}
                  {c.isPlatform && <span className="badge badge-blue" style={{ marginLeft: 6 }}>platform</span>}
                </td>
                <td>{c.isPlatform ? 'Platform' : 'Company'}</td>
                <td>{statusBadge(c.status)}</td>
                <td>{c.userCount}</td>
                <td>
                  {!c.isPlatform && (
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {c.status === 'suspended' ? (
                        <button className="lead-quickbtn" disabled={busyId === c.id} onClick={() => handleReactivate(c)}>
                          Reactivate
                        </button>
                      ) : (
                        <button className="lead-quickbtn" disabled={busyId === c.id} onClick={() => handleSuspend(c)}>
                          Suspend
                        </button>
                      )}
                      <button
                        className="lead-quickbtn"
                        disabled={busyId === c.id}
                        onClick={() => handleDelete(c)}
                        style={{ color: 'var(--danger)' }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className="subtle" style={{ marginTop: 10 }}>{msg}</p>}
    </div>
  )
}
