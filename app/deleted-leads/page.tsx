import { createSupabaseServer } from '../../lib/supabase-server'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import DeletedLeadsTable from './DeletedLeadsTable'

export default async function DeletedLeads() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Super Admin only.
  const { data: me } = await supabase
    .from('users')
    .select('full_name, roles(key, label), tenants(name)')
    .eq('auth_id', user.id)
    .single()

  const roleKey = (me as any)?.roles?.key ?? ''
  if (roleKey !== 'super_admin') redirect('/')

  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: (me as any).roles?.label ?? 'Super Admin',
        company: (me as any).tenants?.name ?? '',
      }
    : null

  // Fetch every soft-deleted practice + who deleted it.
  const { data: deletedRows, error } = await supabase
    .from('master_practices')
    .select(`
      id, practice_code, name, state, specialty, deleted_at,
      deleted_by, users:deleted_by ( full_name )
    `)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })

  if (error) {
    return (
      <AppShell title="Deleted Leads" subtitle="Super Admin only" currentUser={currentUser} active="/deleted-leads" showAdmin>
        <div style={{ padding: 24, color: '#f66' }}>Error: {error.message}</div>
      </AppShell>
    )
  }

  // For each deleted practice, figure out if any company still has it
  // allocated / assigned — those need to be shown with a warning badge so
  // Super Admin knows hard-deleting will pull it out from under active work.
  const practiceIds = (deletedRows ?? []).map((r: any) => r.id)
  const stillAllocatedTo: Record<string, string[]> = {} // practice_id -> [company names]
  const stillAssigned: Set<string> = new Set()          // practice_ids assigned to a person

  if (practiceIds.length) {
    // Chunk into 300s for large lists.
    const CHUNK = 300
    for (let i = 0; i < practiceIds.length; i += CHUNK) {
      const part = practiceIds.slice(i, i + CHUNK)

      const { data: allocs } = await supabase
        .from('lead_allocations')
        .select('practice_id, tenants(name)')
        .in('practice_id', part)
        .eq('status', 'active')
      for (const a of (allocs ?? []) as any[]) {
        const n = a.tenants?.name
        if (!n) continue
        if (!stillAllocatedTo[a.practice_id]) stillAllocatedTo[a.practice_id] = []
        if (!stillAllocatedTo[a.practice_id].includes(n)) stillAllocatedTo[a.practice_id].push(n)
      }

      const { data: assigns } = await supabase
        .from('lead_assignments')
        .select('practice_id')
        .in('practice_id', part)
        .eq('status', 'active')
      for (const a of (assigns ?? []) as any[]) {
        if (a.practice_id) stillAssigned.add(a.practice_id)
      }
    }
  }

  const rows = (deletedRows ?? []).map((r: any) => ({
    id: r.id,
    practiceCode: r.practice_code,
    name: r.name,
    state: r.state,
    specialty: r.specialty,
    deletedAt: r.deleted_at,
    deletedByName: (r.users as any)?.full_name ?? null,
    allocatedTo: stillAllocatedTo[r.id] ?? [],
    isAssigned: stillAssigned.has(r.id),
  }))

  return (
    <AppShell
      title="Deleted Leads"
      subtitle={`${rows.length} soft-deleted lead${rows.length === 1 ? '' : 's'} — restore to pool, or permanently delete from database`}
      currentUser={currentUser}
      active="/deleted-leads"
      showAdmin
    >
      <DeletedLeadsTable rows={rows} />
    </AppShell>
  )
}