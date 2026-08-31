import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'

export default async function AdminPage() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('roles(key)')
    .eq('auth_id', user.id)
    .single()

  if ((me as any)?.roles?.key !== 'super_admin') {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
        <a href="/" style={{ color: '#2563eb' }}>← Back</a>
        <h1 style={{ color: '#dc2626', marginTop: 16 }}>Access denied</h1>
        <p>Only the Super Admin can view user management.</p>
      </div>
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

  const cell = { padding: 10, border: '1px solid #ddd', fontSize: 14, textAlign: 'left' as const }
  const head = { ...cell, background: '#f2f2f2', color: '#000', fontWeight: 600 }

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28 }}>Admin — Users & Companies</h1>
        <a href="/" style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14 }}>← Back to practices</a>
      </div>

      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Companies ({tenants?.length ?? 0})</h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 600, marginBottom: 36 }}>
        <thead>
          <tr>
            <th style={head}>Company</th>
            <th style={head}>Type</th>
            <th style={head}>Status</th>
            <th style={head}>Users</th>
          </tr>
        </thead>
        <tbody>
          {tenants?.map((t: any, i) => (
            <tr key={i}>
              <td style={cell}>{t.name}</td>
              <td style={cell}>{t.is_platform ? 'Platform' : 'Company'}</td>
              <td style={cell}>{t.status}</td>
              <td style={cell}>{byCompany[t.name]?.length ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Users by Company</h2>
      {Object.keys(byCompany).sort().map((company) => (
        <div key={company} style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 16, marginBottom: 8, color: '#2563eb' }}>
            {company} <span style={{ color: '#888', fontWeight: 400 }}>({byCompany[company].length} users)</span>
          </h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 800 }}>
            <thead>
              <tr>
                <th style={head}>Name</th>
                <th style={head}>Email</th>
                <th style={head}>Role</th>
                <th style={head}>Status</th>
              </tr>
            </thead>
            <tbody>
              {byCompany[company].map((u: any, i) => (
                <tr key={i}>
                  <td style={cell}>{u.full_name}</td>
                  <td style={cell}>{u.email}</td>
                  <td style={cell}><strong>{u.roles?.label ?? '—'}</strong></td>
                  <td style={cell}>{u.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
            <h2 style={{ fontSize: 18, margin: '36px 0 12px' }}>
        Allocation History ({allocations?.length ?? 0})
      </h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 900 }}>
        <thead>
          <tr>
            <th style={head}>Date</th>
            <th style={head}>Time</th>
            <th style={head}>Practice</th>
            <th style={head}>Allocated To</th>
            <th style={head}>Status</th>
          </tr>
        </thead>
        <tbody>
          {allocations?.map((a: any, i) => {
            const d = new Date(a.allocated_at)
            return (
              <tr key={i}>
                <td style={cell}>{d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</td>
                <td style={cell}>{d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</td>
                <td style={cell}>{a.master_practices?.name ?? '—'}</td>
                <td style={cell}><strong>{a.tenants?.name ?? '—'}</strong></td>
                <td style={cell}>{a.status}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}