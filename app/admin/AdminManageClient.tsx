'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  createCompany, createUser, getAssignableRoles, getCompaniesForUserCreation,
  type AssignableRole, type CompanyOption,
} from '../admin-manage-actions'

function genTempPassword() {
  // Readable-ish random temporary password — the user resets it on first login.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

function AddCompanyForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const submit = async () => {
    setBusy(true); setMsg(null)
    const res = await createCompany(name)
    if (res.ok) {
      setMsg({ text: `"${name.trim()}" was added.`, ok: true })
      setName('')
      onCreated()
      router.refresh()
    } else {
      setMsg({ text: res.message ?? 'Could not add company.', ok: false })
    }
    setBusy(false)
  }

  return (
    <div className="card">
      <h2 className="h-section">Add Company</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label className="lead-field-label">Company Name</label>
          <input className="lead-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Medical Sales" />
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add Company'}
        </button>
      </div>
      {msg && <p className="subtle" style={{ color: msg.ok ? 'var(--ok)' : 'var(--danger)', marginTop: 10 }}>{msg.text}</p>}
    </div>
  )
}

function AddUserForm({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const router = useRouter()
  const [roles, setRoles] = useState<AssignableRole[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [roleKey, setRoleKey] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [tempPassword, setTempPassword] = useState(genTempPassword())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    (async () => {
      const rolesRes = await getAssignableRoles()
      if (rolesRes.ok) {
        setRoles(rolesRes.roles ?? [])
        if (rolesRes.roles?.length) setRoleKey(rolesRes.roles[0].key)
      }
      if (isSuperAdmin) {
        const companiesRes = await getCompaniesForUserCreation()
        if (companiesRes.ok) {
          setCompanies(companiesRes.companies ?? [])
          if (companiesRes.companies?.length) setTenantId(companiesRes.companies[0].id)
        }
      }
    })()
  }, [isSuperAdmin])

  const submit = async () => {
    setBusy(true); setMsg(null)
    const res = await createUser({
      email, fullName, roleKey, temporaryPassword: tempPassword,
      tenantId: isSuperAdmin ? tenantId : undefined,
    })
    if (res.ok) {
      setMsg({ text: `${fullName} was created. Share the temporary password with them securely — it won't be shown again after you leave this page.`, ok: true })
      setEmail(''); setFullName(''); setTempPassword(genTempPassword())
      router.refresh()
    } else {
      setMsg({ text: res.message ?? 'Could not create user.', ok: false })
    }
    setBusy(false)
  }

  const canSubmit = email.trim() && fullName.trim() && roleKey && tempPassword.length >= 8 && (!isSuperAdmin || tenantId)

  return (
    <div className="card">
      <h2 className="h-section">Add User</h2>
      <div className="grid-fields-2">
        <div>
          <label className="lead-field-label">Full Name</label>
          <input className="lead-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
        </div>
        <div>
          <label className="lead-field-label">Email</label>
          <input className="lead-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
        </div>
        <div>
          <label className="lead-field-label">Role</label>
          <select className="lead-select" value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        {isSuperAdmin && (
          <div>
            <label className="lead-field-label">Company</label>
            <select className="lead-select" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div style={{ gridColumn: isSuperAdmin ? 'auto' : '1 / -1' }}>
          <label className="lead-field-label">Temporary Password</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="lead-input" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
            <button type="button" className="lead-quickbtn" onClick={() => setTempPassword(genTempPassword())}>Regenerate</button>
          </div>
        </div>
      </div>
      <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={submit} disabled={busy || !canSubmit}>
        {busy ? 'Creating…' : 'Create User'}
      </button>
      {msg && <p className="subtle" style={{ color: msg.ok ? 'var(--ok)' : 'var(--danger)', marginTop: 10 }}>{msg.text}</p>}
    </div>
  )
}

export default function AdminManageClient({ isSuperAdmin, onCompanyCreated }: { isSuperAdmin: boolean; onCompanyCreated?: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {isSuperAdmin && <AddCompanyForm onCreated={() => onCompanyCreated?.()} />}
      <AddUserForm isSuperAdmin={isSuperAdmin} />
    </div>
  )
}
