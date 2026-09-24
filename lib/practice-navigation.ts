import type { SupabaseClient } from '@supabase/supabase-js'
import { chunks, mapConcurrent } from './query-utils'

type Lead = { id: string; practice_code: string; name: string; ws_updated_by: string | null }
type Scope = { role: string; userId: string | null; tenantId: string | null; personalIds?: string[] }

// Fetch every page: PostgREST's default row cap is not a total-count API.
export async function allRows<T>(makeQuery: () => PromiseLike<{ data: T[] | null; error: unknown }> & { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }> }): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

export async function getPracticeNavigation(db: SupabaseClient, scope: Scope): Promise<string[]> {
  const projection = 'id, practice_code, name, ws_updated_by'
  const byIds = async (ids: string[]) => (await mapConcurrent(chunks([...new Set(ids)], 300), 4, part =>
    allRows<Lead>(() => db.from('master_practices').select(projection).in('id', part)
      .eq('is_roster', false).order('name').order('id')))).flat()
  let leads: Lead[] = []
  if (scope.role === 'super_admin') {
    leads = await allRows<Lead>(() => db.from('master_practices').select(projection)
      .eq('is_roster', false).is('deleted_at', null).order('name').order('id'))
  } else if (['agent', 'closer', 'manager', 'team_lead'].includes(scope.role) && scope.userId) {
    let ids = scope.personalIds
    if (!ids) {
      const [assignments, transfers] = await Promise.all([
        allRows<{ practice_id: string }>(() => db.from('lead_assignments').select('practice_id')
          .eq('assigned_to', scope.userId).eq('status', 'active').order('practice_id')),
        scope.role === 'closer' ? allRows<{ practice_id: string }>(() => db.from('lead_transfers').select('practice_id')
          .eq('to_user_id', scope.userId).order('practice_id')) : [],
      ])
      ids = [...assignments, ...transfers].map(row => row.practice_id).filter(Boolean)
    }
    if (['manager', 'team_lead'].includes(scope.role) && scope.tenantId) {
      const engaged = (await mapConcurrent(chunks(ids, 300), 4, part =>
        allRows<{ practice_id: string }>(() => db.from('lead_assignments').select('practice_id')
          .in('practice_id', part).eq('status', 'active').neq('tenant_id', scope.tenantId).order('practice_id')))).flat()
      const excluded = new Set(engaged.map(row => row.practice_id))
      ids = ids.filter(id => !excluded.has(id))
    }
    leads = await byIds(ids)
    if (scope.role === 'agent' || scope.role === 'closer') {
      leads = leads.filter(lead => lead.ws_updated_by !== scope.userId)
    }
  } else if (scope.role === 'company_admin' && scope.tenantId) {
    const [owned, allocations] = await Promise.all([
      allRows<Lead>(() => db.from('master_practices').select(projection)
        .eq('owner_tenant_id', scope.tenantId).eq('is_roster', false).order('name').order('id')),
      allRows<{ practice_id: string }>(() => db.from('lead_allocations').select('practice_id')
        .eq('tenant_id', scope.tenantId).eq('status', 'active').order('practice_id')),
    ])
    leads = [...owned, ...await byIds(allocations.map(row => row.practice_id).filter(Boolean))]
  }
  leads.sort((a, b) => a.name.localeCompare(b.name) || a.practice_code.localeCompare(b.practice_code))
  return [...new Set(leads.map(row => row.practice_code).filter(Boolean))]
}
