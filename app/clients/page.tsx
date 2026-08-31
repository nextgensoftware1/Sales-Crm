import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'

export default async function ClientsPage() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('users')
    .select('tenant_id, roles(key)')
    .eq('auth_id', user.id)
    .single()

  const isSuperAdmin = (me as any)?.roles?.key === 'super_admin'

  // Super Admin sees all clients; others see only their company's clients
  let query = supabase
    .from('client_ownership')
    .select('locked_at, active, tenants(name), master_practices(name, practice_code), sales(service_sold, contract_value, mrr, sale_date)')
    .eq('active', true)
    .order('locked_at', { ascending: false })

  if (!isSuperAdmin) {
    query = query.eq('owner_tenant_id', (me as any).tenant_id)
  }

  const { data: clients } = await query

  const cell = { padding: 10, border: '1px solid #ddd', fontSize: 14, textAlign: 'left' as const }
  const head = { ...cell, background: '#f2f2f2', color: '#000', fontWeight: 600 }

  return (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 28 }}>{isSuperAdmin ? 'Global Client Registry' : 'Active Clients'} ({clients?.length ?? 0})</h1>
        <a href="/" style={{ color: '#2563eb', textDecoration: 'none', fontSize: 14 }}>← Back to practices</a>
      </div>

      {(!clients || clients.length === 0) ? (
        <p style={{ color: '#888' }}>No clients yet.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 1000 }}>
          <thead>
            <tr>
              <th style={head}>Practice</th>
              {isSuperAdmin && <th style={head}>Owner Company</th>}
              <th style={head}>Service</th>
              <th style={head}>Contract Value</th>
              <th style={head}>MRR</th>
              <th style={head}>Sale Date</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c: any, i) => (
              <tr key={i}>
                <td style={cell}>
                  <a href={`/practice/${c.master_practices?.practice_code}`} style={{ color: '#2563eb', textDecoration: 'none' }}>
                    {c.master_practices?.name ?? '—'}
                  </a>
                </td>
                {isSuperAdmin && <td style={cell}>{c.tenants?.name ?? '—'}</td>}
                <td style={cell}>{c.sales?.service_sold ?? '—'}</td>
                <td style={cell}>{c.sales?.contract_value != null ? '$' + c.sales.contract_value : '—'}</td>
                <td style={cell}>{c.sales?.mrr != null ? '$' + c.sales.mrr : '—'}</td>
                <td style={cell}>{c.sales?.sale_date ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}