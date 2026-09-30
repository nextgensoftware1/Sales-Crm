import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { chunks, mapConcurrent } from '../../lib/query-utils'
import { roleLabel } from '../../lib/roles'
import { redirect } from 'next/navigation'
import AppShell from '../AppShell'
import DeletedLeadsTable from './DeletedLeadsTable'

export default async function DeletedLeads() {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) redirect('/login')

  // Super Admin only.
  const { data: me } = await getCurrentProfile(user.id)

  const roleKey = (me as any)?.roles?.key ?? ''
  if (roleKey !== 'super_admin') redirect('/')

  const currentUser = me
    ? {
        full_name: (me as any).full_name,
        role: roleLabel((me as any).roles?.key),
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
      <AppShell title="Deleted Leads" subtitle="Super Admin only" currentUser={currentUser} active="/deleted-leads" showAdmin showTransfers canManageUsers>
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
    // Same chunking (300 per request), same two queries per chunk, same
    // result processing — the only change is running the chunks with
    // bounded concurrency (matching mapConcurrent's use elsewhere in this
    // codebase) instead of one chunk waiting for the previous one to
    // finish, and running each chunk's own two queries together instead
    // of one after another.
    const parts = chunks(practiceIds, 300)
    const chunkResults = await mapConcurrent(parts, 4, async (part) => {
      const [{ data: allocs }, { data: assigns }] = await Promise.all([
        supabase.from('lead_allocations').select('practice_id, tenants(name)').in('practice_id', part).eq('status', 'active'),
        supabase.from('lead_assignments').select('practice_id').in('practice_id', part).eq('status', 'active'),
      ])
      return { allocs, assigns }
    })
    for (const { allocs, assigns } of chunkResults) {
      for (const a of (allocs ?? []) as any[]) {
        const n = a.tenants?.name
        if (!n) continue
        if (!stillAllocatedTo[a.practice_id]) stillAllocatedTo[a.practice_id] = []
        if (!stillAllocatedTo[a.practice_id].includes(n)) stillAllocatedTo[a.practice_id].push(n)
      }
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
      showTransfers
      canManageUsers
    >
      <DeletedLeadsTable rows={rows} />
    </AppShell>
  )
}