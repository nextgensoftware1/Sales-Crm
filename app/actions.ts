'use server'

import { createSupabaseServer } from '../lib/supabase-server'
import { revalidatePath } from 'next/cache'

export async function allocatePractices(practiceCodes: string[], tenantSlug: string) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await supabase
    .from('users')
    .select('id, roles(key)')
    .eq('auth_id', user.id)
    .single()

  if ((me as any)?.roles?.key !== 'super_admin') {
    return { ok: false, message: 'Only Super Admin can allocate' }
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single()
  if (!tenant) return { ok: false, message: 'Company not found' }

  const { data: practices } = await supabase
    .from('master_practices')
    .select('id')
    .in('practice_code', practiceCodes)

  if (!practices || practices.length === 0) {
    return { ok: false, message: 'No practices selected' }
  }

  const rows = practices.map((p: any) => ({
    practice_id: p.id,
    tenant_id: tenant.id,
    allocated_by: (me as any).id,
  }))

  const { error } = await supabase
    .from('lead_allocations')
    .upsert(rows, { onConflict: 'practice_id,tenant_id', ignoreDuplicates: true })

  if (error) return { ok: false, message: error.message }

  return { ok: true, message: `Allocated ${rows.length} practice(s) to ${tenantSlug}` }
}

export async function logActivity(
  practiceCode: string,
  disposition: string,
  note: string
) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id, roles(key)')
    .eq('auth_id', user.id)
    .single()
  if (!me) return { ok: false, message: 'User not found' }

  const { data: practice } = await supabase
    .from('master_practices')
    .select('id')
    .eq('practice_code', practiceCode)
    .maybeSingle()
  if (!practice) return { ok: false, message: 'This lead could not be found — it may have been deleted.' }

  const { error } = await supabase.from('lead_activity').insert({
    practice_id: practice.id,
    tenant_id: (me as any).tenant_id,
    agent_id: (me as any).id,
    type: 'call',
    disposition: disposition || null,
    note: note || null,
  })
  if (error) return { ok: false, message: error.message }

  if (disposition) {
    await supabase
      .from('lead_assignments')
      .update({ current_status: disposition, last_activity_at: new Date().toISOString() })
      .eq('practice_id', practice.id)
      .eq('assigned_to', (me as any).id)
  }

  return { ok: true, message: 'Activity logged' }
}

export async function setReminder(
  practiceCode: string,
  remindAt: string,
  note: string
) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_id', user.id)
    .single()
  if (!me) return { ok: false, message: 'User not found' }

  const { data: practice } = await supabase
    .from('master_practices')
    .select('id')
    .eq('practice_code', practiceCode)
    .maybeSingle()
  if (!practice) return { ok: false, message: 'This lead could not be found — it may have been deleted.' }

  const { error } = await supabase.from('lead_reminders').insert({
    practice_id: practice.id,
    tenant_id: (me as any).tenant_id,
    agent_id: (me as any).id,
    remind_at: remindAt,
    note: note || null,
  })
  if (error) return { ok: false, message: error.message }

  return { ok: true, message: 'Reminder set' }
}

// List closers in the current user's company (for the transfer dropdown),
// PLUS the current user themselves (so an agent can keep/close the lead).
export async function getClosers() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: me } = await supabase
    .from('users')
    .select('id, full_name, email, tenant_id, roles(key, label)')
    .eq('auth_id', user.id)
    .single()
  if (!me) return []

  const { data: people } = await supabase
    .from('users')
    .select('id, full_name, email, roles(key, label)')
    .eq('tenant_id', (me as any).tenant_id)
    .eq('status', 'active')

  // All closers in the company.
  const closers = (people ?? [])
    .filter((c: any) => c.roles?.key === 'closer')
    .map((c: any) => ({ id: c.id, name: c.full_name, email: c.email }))

  // Add the current user themselves at the top (unless already a closer).
  const meId = (me as any).id
  const alreadyIncluded = closers.some((c) => c.id === meId)
  if (!alreadyIncluded) {
    closers.unshift({
      id: meId,
      name: `${(me as any).full_name} (myself)`,
      email: (me as any).email,
    })
  }

  return closers
}

export async function transferToCloser(
  practiceCode: string,
  closerId: string,
  note: string
) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_id', user.id)
    .single()
  if (!me) return { ok: false, message: 'User not found' }

  const { data: practice } = await supabase
    .from('master_practices')
    .select('id')
    .eq('practice_code', practiceCode)
    .maybeSingle()
  if (!practice) return { ok: false, message: 'This lead could not be found — it may have been deleted.' }

  const { error: tErr } = await supabase.from('lead_transfers').insert({
    practice_id: practice.id,
    tenant_id: (me as any).tenant_id,
    from_user_id: (me as any).id,
    to_user_id: closerId,
    note: note || null,
  })
  if (tErr) return { ok: false, message: tErr.message }

  const { error: aErr } = await supabase
    .from('lead_assignments')
    .upsert(
      {
        practice_id: practice.id,
        tenant_id: (me as any).tenant_id,
        assigned_to: closerId,
        assigned_by: (me as any).id,
        current_status: 'Transferred',
      },
      { onConflict: 'practice_id,assigned_to' }
    )
  if (aErr) return { ok: false, message: aErr.message }

  await supabase.from('lead_activity').insert({
    practice_id: practice.id,
    tenant_id: (me as any).tenant_id,
    agent_id: (me as any).id,
    type: 'status_change',
    disposition: 'Transferred to Closer',
    note: note || null,
  })

  return { ok: true, message: 'Transferred to closer' }
}

export async function markAsSold(
  practiceCode: string,
  serviceSold: string,
  contractValue: string,
  mrr: string,
  note: string
) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id, roles(key)')
    .eq('auth_id', user.id)
    .single()
  if (!me) return { ok: false, message: 'User not found' }

  const roleKey = (me as any).roles?.key
  if (roleKey !== 'closer' && roleKey !== 'company_admin') {
    return { ok: false, message: 'Only a Closer or Company Admin can mark a sale' }
  }

  const { data: practice } = await supabase
    .from('master_practices')
    .select('id')
    .eq('practice_code', practiceCode)
    .maybeSingle()
  if (!practice) return { ok: false, message: 'This lead could not be found — it may have been deleted.' }

  const { data: sale, error: sErr } = await supabase
    .from('sales')
    .insert({
      practice_id: practice.id,
      tenant_id: (me as any).tenant_id,
      sold_by: (me as any).id,
      service_sold: serviceSold || null,
      contract_value: contractValue ? Number(contractValue) : null,
      mrr: mrr ? Number(mrr) : null,
      note: note || null,
    })
    .select('id')
    .single()
  if (sErr) return { ok: false, message: sErr.message }

  const { error: oErr } = await supabase
    .from('client_ownership')
    .insert({
      practice_id: practice.id,
      owner_tenant_id: (me as any).tenant_id,
      sale_id: (sale as any).id,
      active: true,
    })
  if (oErr) return { ok: false, message: 'This practice is already a client (locked): ' + oErr.message }

  await supabase
    .from('lead_assignments')
    .update({ current_status: 'Sold' })
    .eq('practice_id', practice.id)
    .eq('assigned_to', (me as any).id)

  await supabase.from('lead_activity').insert({
    practice_id: practice.id,
    tenant_id: (me as any).tenant_id,
    agent_id: (me as any).id,
    type: 'status_change',
    disposition: 'SOLD',
    note: `Sold ${serviceSold || ''} — value ${contractValue || '?'}, MRR ${mrr || '?'}. ${note || ''}`,
  })

  return { ok: true, message: 'Marked as SOLD — practice is now a locked client' }
}

// ============================================================================
// SOFT-DELETE / RESTORE / HARD-DELETE  (Super Admin only)
// Two-stage delete workflow:
//   Stage 1 (softDeleteLeads): sets deleted_at → hidden from Super Admin main
//           pool, moved to /deleted-leads page. Company admins with the lead
//           allocated/assigned still see it in their pool.
//   Stage 2 (hardDeleteLeads): DELETE FROM database — gone for everyone.
//   Restore (restoreLeads): undo Stage 1, lead reappears in main pool.
// ============================================================================

/**
 * STAGE 1 — Soft delete. Marks selected practice_codes as deleted (hidden
 * from Super Admin main pool). Company admins/agents with the lead still
 * allocated/assigned continue to see it in their pool until Stage 2 fires.
 */
export async function softDeleteLeads(codes: string[]) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await supabase
    .from('users')
    .select('id, roles(key)')
    .eq('auth_id', user.id)
    .single()
  const roleKey = (me as any)?.roles?.key
  if (roleKey !== 'super_admin') {
    return { ok: false, message: 'Only Super Admin can delete leads.' }
  }
  if (!codes || codes.length === 0) {
    return { ok: false, message: 'No leads selected.' }
  }

  const { error, count } = await supabase
    .from('master_practices')
    .update(
      { deleted_at: new Date().toISOString(), deleted_by: (me as any).id },
      { count: 'exact' }
    )
    .in('practice_code', codes)
    .is('deleted_at', null)   // don't touch rows already soft-deleted

  if (error) return { ok: false, message: error.message }
  revalidatePath('/')
  revalidatePath('/deleted-leads')
  return { ok: true, message: `Moved ${count ?? codes.length} lead(s) to Deleted Leads.` }
}

/**
 * Restore soft-deleted leads back to the main pool.
 */
export async function restoreLeads(codes: string[]) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await supabase
    .from('users')
    .select('id, roles(key)')
    .eq('auth_id', user.id)
    .single()
  if ((me as any)?.roles?.key !== 'super_admin') {
    return { ok: false, message: 'Only Super Admin can restore leads.' }
  }
  if (!codes || codes.length === 0) {
    return { ok: false, message: 'No leads selected.' }
  }

  const { error, count } = await supabase
    .from('master_practices')
    .update({ deleted_at: null, deleted_by: null }, { count: 'exact' })
    .in('practice_code', codes)
    .not('deleted_at', 'is', null)

  if (error) return { ok: false, message: error.message }
  revalidatePath('/')
  revalidatePath('/deleted-leads')
  return { ok: true, message: `Restored ${count ?? codes.length} lead(s) to the pool.` }
}

/**
 * STAGE 2 — Hard delete. Permanently removes rows from the database.
 * Related rows (allocations, assignments, etc.) are removed via ON DELETE
 * CASCADE / ON DELETE SET NULL — verify your FK constraints match intent.
 */
export async function hardDeleteLeads(codes: string[]) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await supabase
    .from('users')
    .select('id, roles(key)')
    .eq('auth_id', user.id)
    .single()
  if ((me as any)?.roles?.key !== 'super_admin') {
    return { ok: false, message: 'Only Super Admin can permanently delete leads.' }
  }
  if (!codes || codes.length === 0) {
    return { ok: false, message: 'No leads selected.' }
  }

  const { error, count } = await supabase
    .from('master_practices')
    .delete({ count: 'exact' })
    .in('practice_code', codes)

  if (error) return { ok: false, message: error.message }
  revalidatePath('/')
  revalidatePath('/deleted-leads')
  return { ok: true, message: `Permanently deleted ${count ?? codes.length} lead(s).` }
}