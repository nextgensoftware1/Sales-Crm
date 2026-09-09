'use server'

import { createSupabaseServer } from '../lib/supabase-server'

// ---------------------------------------------------------------------------
// allocatePracticesExclusive(practiceCodes, tenantSlug)
//
// Super Admin only. Allocates Platform-owned leads to ONE company. Exclusive:
// if a practice is already actively allocated to a DIFFERENT company, it is
// skipped and reported — it cannot be given to two companies at once.
// ---------------------------------------------------------------------------

export async function allocatePracticesExclusive(
  practiceCodes: string[],
  tenantSlug: string
): Promise<{ ok: boolean; message: string; allocated?: number; blocked?: number }> {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await supabase
    .from('users')
    .select('id, roles(key)')
    .eq('auth_id', user.id)
    .single()
  if ((me as any)?.roles?.key !== 'super_admin') {
    return { ok: false, message: 'Only the Super Admin can allocate leads.' }
  }
  if (!tenantSlug) return { ok: false, message: 'Pick a company.' }
  if (!practiceCodes || practiceCodes.length === 0) {
    return { ok: false, message: 'Select at least one lead.' }
  }

  // Target company
  const { data: target } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('slug', tenantSlug)
    .maybeSingle()
  if (!target) return { ok: false, message: 'Company not found.' }
  const targetId = (target as any).id

  // Resolve practice codes → ids
  const { data: pracs } = await supabase
    .from('master_practices')
    .select('id, practice_code')
    .in('practice_code', practiceCodes)
  const idByCode = new Map<string, string>()
  for (const p of (pracs ?? []) as any[]) idByCode.set(p.practice_code, p.id)
  const ids = Array.from(idByCode.values())
  if (ids.length === 0) return { ok: false, message: 'No matching leads found.' }

  // Which of these are already actively allocated to a DIFFERENT company?
  const { data: existing } = await supabase
    .from('lead_allocations')
    .select('practice_id, tenant_id')
    .in('practice_id', ids)
    .eq('status', 'active')
  const blockedIds = new Set(
    (existing ?? [])
      .filter((a: any) => a.tenant_id !== targetId)
      .map((a: any) => a.practice_id)
  )
  const alreadyHere = new Set(
    (existing ?? [])
      .filter((a: any) => a.tenant_id === targetId)
      .map((a: any) => a.practice_id)
  )

  const toAllocate = ids.filter((id) => !blockedIds.has(id) && !alreadyHere.has(id))
  const blocked = blockedIds.size

  if (toAllocate.length === 0) {
    return {
      ok: true,
      message: blocked
        ? `Nothing allocated — ${blocked} lead(s) already belong to another company.`
        : 'Those leads are already allocated to this company.',
      allocated: 0,
      blocked,
    }
  }

  const now = new Date().toISOString()
  const rows = toAllocate.map((pid) => ({
    practice_id: pid,
    tenant_id: targetId,
    allocated_by: (me as any).id,
    allocated_at: now,
    status: 'active',
  }))

  const { error } = await supabase.from('lead_allocations').insert(rows)
  if (error) return { ok: false, message: `Allocation failed: ${error.message}` }

  return {
    ok: true,
    message: `Allocated ${toAllocate.length} lead(s) to ${(target as any).name}` +
      (blocked ? `; skipped ${blocked} already owned by another company.` : '.'),
    allocated: toAllocate.length,
    blocked,
  }
}