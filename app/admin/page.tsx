import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'

export default async function AdminPage() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('full_name, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: (me as any).roles?.label ?? 'Unknown',
        company: (me as any).tenants?.name ?? '',
      }
    : null

  if ((me as any)?.roles?.key !== 'super_admin') {
    return (
      <AppShell title="Admin" currentUser={currentUser} active="/admin" showAdmin={false}>
        <div className="card" style={{ maxWidth: 480 }}>
          <h1 style={{ color: 'var(--danger)', fontSize: 20, margin: '0 0 8px' }}>Access denied</h1>
          <p className="subtle">Only the Super Admin can view user management.</p>
        </div>
      </AppShell>
    )
  }

  const { data: users } = await supabase
    .from('users')
    .select('email, full_name, status, roles(label, level), tenants(name)')

  const { data: tenants } = await supabase
    .from('tenants')
    .select('name, is_platform, status')
    .order('name')
    // Allocation history — who got allocated what, and when
  const { data: allocations } = await supabase
    .from('lead_allocations')
    .select(`
      allocated_at,
      status,
      tenants ( name ),
      master_practices ( name, practice_code )
    `)
    .order('allocated_at', { ascending: false })
    .limit(1000)

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

  const statusBadge = (status: string) => {
    const s = (status || '').toLowerCase()
    const cls = s === 'active' ? 'badge-green' : s === 'inactive' ? 'badge-grey' : 'badge-amber'
    return <span className={`badge ${cls}`}>{status}</span>
  }

  return (
    <AppShell
      title="Admin — Users & Companies"
      subtitle="Platform-wide user, company, and allocation management"
      currentUser={currentUser}
      active="/admin"
      showAdmin
      headerRight={
        <a href="/admin/view" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          View as role →
        </a>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="card">
          <h2 className="h-section">Companies ({tenants?.length ?? 0})</h2>
          <p className="subtle" style={{ marginTop: -8, marginBottom: 14 }}>Click a company to filter users &amp; allocations below</p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Users</th>
                </tr>
              </thead>
              <tbody>
                {tenants?.map((t: any, i) => (
                  <tr key={i}>
                    <td>
                      {t.name}{' '}
                      {t.is_platform && <span className="badge badge-blue" style={{ marginLeft: 6 }}>platform</span>}
                    </td>
                    <td>{t.is_platform ? 'Platform' : 'Company'}</td>
                    <td>{statusBadge(t.status)}</td>
                    <td>{byCompany[t.name]?.length ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2 className="h-section">Users by Company</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {Object.keys(byCompany).sort().map((company) => (
              <div key={company}>
                <h3 style={{ fontSize: 14, fontWeight: 650, margin: '0 0 10px', color: 'var(--accent)' }}>
                  {company} <span className="subtle" style={{ fontWeight: 400 }}>({byCompany[company].length} users)</span>
                </h3>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byCompany[company].map((u: any, i) => (
                        <tr key={i}>
                          <td>{u.full_name}</td>
                          <td>{u.email}</td>
                          <td><strong>{u.roles?.label ?? '—'}</strong></td>
                          <td>{statusBadge(u.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
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
        </div>
      </div>
    </AppShell>
  )
}
