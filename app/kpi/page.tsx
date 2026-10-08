import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import KpiClient from './KpiClient'
import KpiCompanyNav from './KpiCompanyNav'
import { getTransferKpi } from '../kpi-actions'

// KPI records: PKR 500 per verified transfer. Agents and closers see their own
// records; managers, team leads and company admins see their company; Super
// Admin sees every company. Visibility is enforced by the database (RLS).
export default async function KpiPage() {
  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  const { data: me } = await getCurrentProfile(user.id)
  const kpi = await getTransferKpi()

  const roleKey = (me as any)?.roles?.key ?? ''
  const isSuperAdmin = roleKey === 'super_admin'
  const canManageUsers = isSuperAdmin || ['company_admin', 'manager', 'team_lead'].includes(roleKey)
  // Left panel: every company with its verified-transfer count (Super Admin),
  // or the user's own company name.
  let companies: { id: string; name: string; count: number }[] = []
  if (isSuperAdmin) {
    const supabase = await createSupabaseServer()
    const { data: tenants } = await supabase.from('tenants').select('id, name').eq('is_platform', false).order('name')
    const verified = new Map<string, number>()
    for (const c of kpi.credits) if (c.tenantId && c.status !== 'rejected') verified.set(c.tenantId, (verified.get(c.tenantId) ?? 0) + 1)
    companies = ((tenants ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name, count: verified.get(t.id) ?? 0 }))
  }

  const currentUser = me
    ? { full_name: (me as any).full_name, role: roleLabel((me as any).roles?.key), company: (me as any).tenants?.name ?? '' }
    : null

  return (
    <AppShell
      title="KPI"
      subtitle={isSuperAdmin
        ? 'Verified transfer earnings — every company'
        : kpi.scope === 'team' ? `Verified transfer earnings — ${(me as any)?.tenants?.name ?? 'your company'}` : 'Your verified transfer earnings'}
      currentUser={currentUser}
      active="/kpi"
      showAdmin={isSuperAdmin}
      showTransfers
      canManageUsers={canManageUsers}
      contextExtra={kpi.available ? <KpiCompanyNav companies={companies} ownCompany={(me as any)?.tenants?.name ?? null} /> : null}
      // The panel shows the company list in place of the shortcut links
      // (same as Worksheet Reports); the main sidebar still has every page.
      contextItemsHidden={kpi.available}
      contextHelpText={isSuperAdmin ? 'Choose a company to see its KPI records, then pick a user.' : 'Your company’s verified transfer earnings.'}
    >
      <KpiClient initial={kpi} allCompanies={companies.map(({ id, name }) => ({ id, name }))} />
    </AppShell>
  )
}
