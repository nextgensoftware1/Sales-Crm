'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'

export async function getAllocationHistory() {
  const { data: { user } } = await getCurrentUser()
  if (!user) throw new Error('Not signed in.')
  const { data: me } = await getCurrentProfile(user.id)
  if (me?.roles?.key !== 'super_admin') throw new Error('Not allowed.')
  const supabase = await createSupabaseServer()
  const { data, error } = await supabase.from('lead_allocations')
    .select('allocated_at, status, tenants(name), master_practices(name, practice_code)')
    .order('allocated_at', { ascending: false }).limit(1000)
  if (error) throw new Error('Could not load allocation history.')
  return (data ?? []).map(row => ({
    allocatedAt: row.allocated_at as string,
    status: row.status as string,
    company: (row.tenants as unknown as { name: string } | null)?.name ?? '—',
    practice: (row.master_practices as unknown as { name: string } | null)?.name ?? '—',
  }))
}
