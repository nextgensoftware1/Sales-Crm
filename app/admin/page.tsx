import Link from 'next/link'
import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel, ROLE_PERMISSIONS } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import AdminManageClient from './AdminManageClient'
import AdminUsersByCompanyClient from './AdminUsersByCompanyClient'
import CompaniesTable from './CompaniesTable'
import SectionTabs from '../SectionTabs'

export default async function AdminPage() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)

  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: roleLabel((me as any).roles?.key),
        company: (me as any).tenants?.name ?? '',
      }
    : null

  const roleKey = (me as any)?.roles?.key ?? ''
  const showTransfers = true // everyone signed in can view transfers (scoped by role inside the page)

  const canManageUsers = ['super_admin', 'company_admin', 'manager', 'team_lead'].includes(roleKey)
  if (!canManageUsers) {
    return (
      <AppShell title="Admin" currentUser={currentUser} active="/admin" showAdmin={false} showTransfers={showTransfers} canManageUsers={canManageUsers}>
        <div className="card" style={{ maxWidth: 480 }}>
          <h1 style={{ color: 'var(--danger)', fontSize: 20, margin: '0 0 8px' }}>Access denied</h1>
          <p className="subtle">Only Team Lead, Manager, Company Admin, and Super Admin can manage users.</p>
        </div>
      </AppShell>
    )
  }

  // Company Admin, Manager, and Team Lead: a scoped view of just their own
  // company — add teammates within the roles they're allowed to grant, see
  // who's already on the team. No visibility into other companies, the
  // allocation history, or the ability to add a new company (Super Admin only).
  const rolesQuery = supabase.from('roles').select('key, label, level').order('level')
  const toRoleOptions = (rows: { key: string; label: string; level: number }[]) => rows
    .filter((r) => r.key !== 'super_admin' && (roleKey === 'super_admin' || r.level > (me?.roles?.level ?? 999)))
    .map((r) => ({ key: r.key, label: roleLabel(r.key) }))

  if (roleKey !== 'super_admin') {
    const myCompanyName = (me as any)?.tenants?.name ?? 'Your Company'
    const [{ data: myUsers }, { data: availableRoles }] = await Promise.all([
      supabase.from('users').select('email, full_name, status, roles(key, label, level)')
        .eq('tenant_id', (me as any)?.tenant_id),
      rolesQuery,
    ])

    const sorted = ((myUsers ?? []) as any[])
      // Super Admin is a platform-level role, not a member of any specific
      // company's team — exclude it here even if a Super Admin account's
      // tenant_id happens to point at this company (e.g. from earlier testing).
      .filter((u) => u.roles?.key !== 'super_admin')
      .sort((a, b) => (a.roles?.level ?? 99) - (b.roles?.level ?? 99))
    const statusBadge = (status: string) => {
      const s = (status || '').toLowerCase()
      const cls = s === 'active' ? 'badge-green' : s === 'inactive' ? 'badge-grey' : 'badge-amber'
      return <span className={`badge ${cls}`}>{status}</span>
    }

    return (
      <AppShell
        title={`Admin — ${myCompanyName}`}
        subtitle="Manage your company's team"
        currentUser={currentUser}
        active="/admin"
        showAdmin={false}
        showTransfers={showTransfers}
        canManageUsers={canManageUsers}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <AdminManageClient isSuperAdmin={false} roles={toRoleOptions(availableRoles ?? [])} companies={[]} />
          <div className="card">
            <h2 className="h-section">Your Team ({sorted.length})</h2>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
                <tbody>
                  {sorted.map((u: any, i) => (
                    <tr key={i}>
                      <td>{u.full_name}</td>
                      <td>{u.email}</td>
                      <td><strong>{roleLabel(u.roles?.key)}</strong></td>
                      <td>{statusBadge(u.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  const [{ data: users }, { data: tenants }, { data: allocations }, { data: availableRoles }] = await Promise.all([
    supabase
      .from('users')
      .select('email, full_name, status, roles(key, label, level), tenants(name)'),
    supabase
      .from('tenants')
      .select('id, name, is_platform, status')
      .order('name'),
    supabase
      .from('lead_allocations')
      .select(`
        allocated_at,
        status,
        tenants ( name ),
        master_practices ( name, practice_code )
      `)
      .order('allocated_at', { ascending: false })
      .limit(1000),
    rolesQuery,
  ])

  // Group users by company name
  const byCompany: Record<string, any[]> = {}
  for (const u of (users ?? []) as any[]) {
    const company = u.tenants?.name ?? 'No company'
    if (!byCompany[company]) byCompany[company] = []
    byCompany[company].push(u)
  }
  // Sort each company's users by role level (highest first)
  for (const c of Object.keys(byCompany)) {
    byCompany[c].sort((a, b) => (a.roles?.level ?? 99) - (b.roles?.level ?? 99))
  }

  // Real, complete company roster — every registered company shows up in
  // the picker below, even ones with zero users so far, not just whichever
  // companies happen to already have someone in them.
  const allCompanyNames = (tenants ?? []).map((t: any) => t.name)
  const usersByCompany: Record<string, { name: string; email: string; roleKey: string; status: string }[]> = {}
  for (const company of Object.keys(byCompany)) {
    usersByCompany[company] = byCompany[company].map((u: any) => ({
      name: u.full_name,
      email: u.email,
      roleKey: u.roles?.key ?? '',
      status: u.status,
    }))
  }

  const companiesForTable = (tenants ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    isPlatform: t.is_platform,
    status: t.status,
    userCount: byCompany[t.name]?.length ?? 0,
  }))

  return (
    <AppShell
      title="Admin — Users & Companies"
      subtitle="Platform-wide user, company, and allocation management"
      currentUser={currentUser}
      active="/admin"
      showAdmin
      showTransfers={showTransfers}
      canManageUsers={canManageUsers}
      headerRight={
        <Link prefetch={false} href="/admin/view" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          View as role →
        </Link>
      }
    >
      <SectionTabs label="Company administration" sections={[
        { label: 'Company Settings', content: <div className="card">
          <h2 className="h-section">Companies ({tenants?.length ?? 0})</h2>
          <p className="subtle" style={{ marginTop: -8, marginBottom: 14 }}>Suspend, reactivate, or permanently delete a company</p>
          <CompaniesTable companies={companiesForTable} />
        </div> },
        { label: 'Users & Teams', content: <div className="card">
          <h2 className="h-section">Users by Company</h2>
          <AdminUsersByCompanyClient allCompanyNames={allCompanyNames} usersByCompany={usersByCompany} />
        </div> },
        { label: 'Manage Companies & Users', content: <AdminManageClient isSuperAdmin={true} roles={toRoleOptions(availableRoles ?? [])}
          companies={(tenants ?? []).filter((t) => !t.is_platform).map((t) => ({ id: t.id, name: t.name }))} /> },
        { label: 'Roles & Permissions', content: <div className="card">
          <h2 className="h-section">Roles & Permissions</h2>
          <p className="subtle" style={{ marginTop: -8, marginBottom: 14 }}>
            Read-only reference — this reflects the role hierarchy and assignment rules already enforced elsewhere in the app; it does not grant or change anything here.
          </p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Can assign leads to</th>
                  <th>Sees</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_PERMISSIONS.map((r) => (
                  <tr key={r.key}>
                    <td><strong>{roleLabel(r.key)}</strong></td>
                    <td>{r.canAssignTo.length ? r.canAssignTo.map(roleLabel).join(', ') : '—'}</td>
                    <td className="subtle" style={{ fontSize: 12.5 }}>{r.sees}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div> },
        { label: 'Allocation History', content: <div className="card">
          <h2 className="h-section">Allocation History ({allocations?.length ?? 0})</h2>
          {(!allocations || allocations.length === 0) ? (
            <p className="subtle">No allocations yet.</p>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Practice</th>
                    <th>Allocated To</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations?.map((a: any, i) => {
                    const d = new Date(a.allocated_at)
                    return (
                      <tr key={i}>
                        <td>{d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</td>
                        <td>{d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{a.master_practices?.name ?? '—'}</td>
                        <td><strong>{a.tenants?.name ?? '—'}</strong></td>
                        <td>{a.status}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div> },
      ]} />
    </AppShell>
  )
}
