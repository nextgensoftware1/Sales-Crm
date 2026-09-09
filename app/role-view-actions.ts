'use server'

import { createSupabaseServer } from '../lib/supabase-server'

// ---------------------------------------------------------------------------
// Super Admin "view as role" — returns the leads a given role/user would see,
// WITHOUT logging in as them. Super Admin only.
// ---------------------------------------------------------------------------

type Lead = { practiceCode: string; name: string; state: string | null; specialty: string | null }

async function requireSuperAdmin(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabase
    .from('users').select('id, roles(key)').eq('auth_id', user.id).single()
  return (me as any)?.roles?.key === 'super_admin' ? me : null
}

// List the company's users of a given role (so Super Admin can pick whose view).
export async function listUsersByRole(roleKey: string): Promise<
  { ok: boolean; message?: string; users?: { id: string; full_name: string; company: string }[] }
> {
  const supabase = await createSupabaseServer()
  if (!(await requireSuperAdmin(supabase))) return { ok: false, message: 'Super Admin only.' }

  const { data: rows } = await supabase
    .from('users')
    .select('id, full_name, roles(key), tenants(name)')
    .order('full_name')
  const users = (rows ?? [])
    .filter((u: any) => u.roles?.key === roleKey)
    .map((u: any) => ({ id: u.id, full_name: u.full_name, company: u.tenants?.name ?? '' }))
  return { ok: true, users }
}

// Return the leads a specific user (by role) would see.
export async function getLeadsForUser(userId: string): Promise<
  { ok: boolean; message?: string; leads?: Lead[]; roleLabel?: string }
> {
  const supabase = await createSupabaseServer()
  if (!(await requireSuperAdmin(supabase))) return { ok: false, message: 'Super Admin only.' }

  const { data: u } = await supabase
    .from('users')
    .select('id, tenant_id, roles(key, label)')
    .eq('id', userId)
    .single()
  if (!u) return { ok: false, message: 'User not found.' }

  const roleKey = (u as any).roles?.key ?? ''
  const roleLabel = (u as any).roles?.label ?? roleKey
  const tenantId = (u as any).tenant_id

  let ids: string[] = []

  if (roleKey === 'agent' || roleKey === 'closer') {
    const idSet = new Set<string>()

    // Directly assigned.
    const { data: a } = await supabase
      .from('lead_assignments')
      .select('practice_id')
      .eq('assigned_to', userId)
      .eq('status', 'active')
    for (const r of (a ?? []) as any[]) if (r.practice_id) idSet.add(r.practice_id)

    // Closers also receive leads via transfer.
    if (roleKey === 'closer') {
      const { data: t } = await supabase
        .from('lead_transfers')
        .select('practice_id')
        .eq('to_user_id', userId)
      for (const r of (t ?? []) as any[]) if (r.practice_id) idSet.add(r.practice_id)
    }

    ids = Array.from(idSet)
  } else {
    // company roles: owned + allocated. Page the owned fetch past the 1000 cap.
    const ownedIds: string[] = []
    let fromRow = 0
    while (true) {
      const { data: ownedBatch } = await supabase
        .from('master_practices')
        .select('id')
        .eq('owner_tenant_id', tenantId)
        .range(fromRow, fromRow + 999)
      const batch = ownedBatch ?? []
      ownedIds.push(...batch.map((r: any) => r.id))
      if (batch.length < 1000) break
      fromRow += 1000
    }
    const { data: allocs } = await supabase
      .from('lead_allocations').select('practice_id').eq('tenant_id', tenantId).eq('status', 'active')
    ids = Array.from(new Set([
      ...ownedIds,
      ...(allocs ?? []).map((r: any) => r.practice_id),
    ])).filter((id: any) => typeof id === 'string' && id.length > 0)
  }

  if (ids.length === 0) {
    return {
      ok: true, leads: [], roleLabel,
      message: `No leads: role=${roleKey}, tenantId=${tenantId ?? 'NULL'}`,
    }
  }

  const leads: Lead[] = []
  const CHUNK = 200 // small chunks so .in() never exceeds URL length limit
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data: pr, error: prErr } = await supabase
      .from('master_practices')
      .select('practice_code, name, state, specialty')
      .in('id', chunk)
      .order('name')
    if (prErr) {
      return { ok: false, message: `Fetch failed: ${prErr.message}` }
    }
    for (const p of (pr ?? []) as any[]) {
      leads.push({ practiceCode: p.practice_code, name: p.name, state: p.state, specialty: p.specialty })
    }
  }
  return { ok: true, leads, roleLabel }
}