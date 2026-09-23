import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrentProfile } from './supabase-server'

type PracticeCandidate = {
  id: string
  practice_code: string
  owner_tenant_id: string | null
  deleted_at: string | null
  practice_providers: Array<{ providers: { org_pac_id: string | null } | null }> | null
}

export type AuthorizedPractice = { id: string; practiceCode: string }

const COMPANY_ROLES = ['company_admin', 'manager', 'team_lead']

async function organizationPracticeIds(db: SupabaseClient, candidates: PracticeCandidate[]): Promise<string[]> {
  const orgIds = [...new Set(candidates.flatMap((practice) =>
    (practice.practice_providers ?? []).map((link) => link.providers?.org_pac_id).filter((id): id is string => Boolean(id))
  ))]
  if (orgIds.length === 0) return []

  const { data } = await db.from('providers')
    .select('practice_providers(practice_id)')
    .in('org_pac_id', orgIds)
  const rows = (data ?? []) as unknown as Array<{ practice_providers: Array<{ practice_id: string }> | null }>
  return [...new Set(rows.flatMap((row) => (row.practice_providers ?? []).map((link) => link.practice_id).filter(Boolean)))]
}

/** Server-side lead authorization shared by every write action. */
export async function authorizePractice(
  db: SupabaseClient,
  profile: CurrentProfile,
  practiceCode: string,
): Promise<AuthorizedPractice | null> {
  const code = practiceCode.trim()
  if (!code) return null

  const { data } = await db.from('master_practices')
    .select('id, practice_code, owner_tenant_id, deleted_at, practice_providers(providers(org_pac_id))')
    .eq('practice_code', code)
    .is('deleted_at', null)
  const candidates = (data ?? []) as unknown as PracticeCandidate[]
  if (candidates.length === 0) return null

  const role = profile.roles?.key ?? ''
  if (role === 'super_admin') return { id: candidates[0].id, practiceCode: candidates[0].practice_code }
  if (!profile.tenant_id) return null

  const directIds = candidates.map((practice) => practice.id)
  const orgIds = await organizationPracticeIds(db, candidates)
  const accessibleIds = [...new Set([...directIds, ...orgIds])]

  if (role === 'agent' || role === 'closer') {
    const [{ data: assignments }, { data: transfers }] = await Promise.all([
      db.from('lead_assignments').select('practice_id')
        .eq('assigned_to', profile.id).eq('status', 'active').in('practice_id', accessibleIds),
      role === 'closer'
        ? db.from('lead_transfers').select('practice_id').eq('to_user_id', profile.id).in('practice_id', accessibleIds)
        : Promise.resolve({ data: [] }),
    ])
    const allowedIds = new Set([
      ...((assignments ?? []) as Array<{ practice_id: string }>).map((row) => row.practice_id),
      ...((transfers ?? []) as Array<{ practice_id: string }>).map((row) => row.practice_id),
    ])
    if (allowedIds.size === 0) return null
    return { id: candidates[0].id, practiceCode: candidates[0].practice_code }
  }

  if (COMPANY_ROLES.includes(role)) {
    const owned = candidates.find((practice) => practice.owner_tenant_id === profile.tenant_id)
    if (owned) return { id: owned.id, practiceCode: owned.practice_code }

    const [{ data: organizationOwned }, { data: allocations }] = await Promise.all([
      orgIds.length
        ? db.from('master_practices').select('id').eq('owner_tenant_id', profile.tenant_id).in('id', orgIds)
        : Promise.resolve({ data: [] }),
      db.from('lead_allocations').select('practice_id')
        .eq('tenant_id', profile.tenant_id).eq('status', 'active').in('practice_id', accessibleIds),
    ])
    if ((organizationOwned ?? []).length > 0 || (allocations ?? []).length > 0) {
      return { id: candidates[0].id, practiceCode: candidates[0].practice_code }
    }
  }

  return null
}
