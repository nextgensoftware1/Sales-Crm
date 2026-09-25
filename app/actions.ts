// 'use server'

// import { createSupabaseServer } from '../lib/supabase-server'
// import { revalidatePath } from 'next/cache'

// export async function allocatePractices(practiceCodes: string[], tenantSlug: string) {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return { ok: false, message: 'Not logged in' }

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, roles(key)')
//     .eq('auth_id', user.id)
//     .single()

//   if ((me as any)?.roles?.key !== 'super_admin') {
//     return { ok: false, message: 'Only Super Admin can allocate' }
//   }

//   const { data: tenant } = await supabase
//     .from('tenants')
//     .select('id')
//     .eq('slug', tenantSlug)
//     .single()
//   if (!tenant) return { ok: false, message: 'Company not found' }

//   const { data: practices } = await supabase
//     .from('master_practices')
//     .select('id')
//     .in('practice_code', practiceCodes)

//   if (!practices || practices.length === 0) {
//     return { ok: false, message: 'No practices selected' }
//   }

//   const rows = practices.map((p: any) => ({
//     practice_id: p.id,
//     tenant_id: tenant.id,
//     allocated_by: (me as any).id,
//   }))

//   const { error } = await supabase
//     .from('lead_allocations')
//     .upsert(rows, { onConflict: 'practice_id,tenant_id', ignoreDuplicates: true })

//   if (error) return { ok: false, message: error.message }

//   return { ok: true, message: `Allocated ${rows.length} practice(s) to ${tenantSlug}` }
// }

// export async function logActivity(
//   practiceCode: string,
//   disposition: string,
//   note: string
// ) {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return { ok: false, message: 'Not logged in' }

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, tenant_id, roles(key)')
//     .eq('auth_id', user.id)
//     .single()
//   if (!me) return { ok: false, message: 'User not found' }

//   const { data: practice } = await supabase
//     .from('master_practices')
//     .select('id')
//     .eq('practice_code', practiceCode)
//     .maybeSingle()
//   if (!practice) return { ok: false, message: 'This lead could not be found — it may have been deleted.' }

//   const { error } = await supabase.from('lead_activity').insert({
//     practice_id: practice.id,
//     tenant_id: (me as any).tenant_id,
//     agent_id: (me as any).id,
//     type: 'call',
//     disposition: disposition || null,
//     note: note || null,
//   })
//   if (error) return { ok: false, message: error.message }

//   if (disposition) {
//     await supabase
//       .from('lead_assignments')
//       .update({ current_status: disposition, last_activity_at: new Date().toISOString() })
//       .eq('practice_id', practice.id)
//       .eq('assigned_to', (me as any).id)
//   }

//   return { ok: true, message: 'Activity logged' }
// }

// export async function setReminder(
//   practiceCode: string,
//   remindAt: string,
//   note: string
// ) {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return { ok: false, message: 'Not logged in' }

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, tenant_id')
//     .eq('auth_id', user.id)
//     .single()
//   if (!me) return { ok: false, message: 'User not found' }

//   const { data: practice } = await supabase
//     .from('master_practices')
//     .select('id')
//     .eq('practice_code', practiceCode)
//     .maybeSingle()
//   if (!practice) return { ok: false, message: 'This lead could not be found — it may have been deleted.' }

//   const { error } = await supabase.from('lead_reminders').insert({
//     practice_id: practice.id,
//     tenant_id: (me as any).tenant_id,
//     agent_id: (me as any).id,
//     remind_at: remindAt,
//     note: note || null,
//   })
//   if (error) return { ok: false, message: error.message }

//   return { ok: true, message: 'Reminder set' }
// }

// // List closers in the current user's company (for the transfer dropdown),
// // PLUS the current user themselves (so an agent can keep/close the lead).
// export async function getClosers() {
//   const supabase = await createSupabaseServer()
//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return []

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, full_name, email, tenant_id, roles(key, label)')
//     .eq('auth_id', user.id)
//     .single()
//   if (!me) return []

//   const { data: people } = await supabase
//     .from('users')
//     .select('id, full_name, email, roles(key, label)')
//     .eq('tenant_id', (me as any).tenant_id)
//     .eq('status', 'active')

//   // All closers in the company.
//   const closers = (people ?? [])
//     .filter((c: any) => c.roles?.key === 'closer')
//     .map((c: any) => ({ id: c.id, name: c.full_name, email: c.email }))

//   // Add the current user themselves at the top (unless already a closer).
//   const meId = (me as any).id
//   const alreadyIncluded = closers.some((c) => c.id === meId)
//   if (!alreadyIncluded) {
//     closers.unshift({
//       id: meId,
//       name: `${(me as any).full_name} (myself)`,
//       email: (me as any).email,
//     })
//   }

//   return closers
// }

// export async function transferToCloser(
//   practiceCode: string,
//   closerId: string,
//   note: string
// ) {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return { ok: false, message: 'Not logged in' }

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, tenant_id')
//     .eq('auth_id', user.id)
//     .single()
//   if (!me) return { ok: false, message: 'User not found' }

//   const { data: practice } = await supabase
//     .from('master_practices')
//     .select('id')
//     .eq('practice_code', practiceCode)
//     .maybeSingle()
//   if (!practice) return { ok: false, message: 'This lead could not be found — it may have been deleted.' }

//   // A lead can only be transferred once. Real enforcement lives here, not
//   // just in the UI hiding the form — if a transfer already exists for this
//   // practice, reject a second one outright rather than silently overwriting
//   // or duplicating it.
//   const { data: existing } = await supabase
//     .from('lead_transfers')
//     .select('id')
//     .eq('practice_id', practice.id)
//     .limit(1)
//     .maybeSingle()
//   if (existing) {
//     return { ok: false, message: 'This lead has already been transferred once and cannot be transferred again.' }
//   }

//   const { error: tErr } = await supabase.from('lead_transfers').insert({
//     practice_id: practice.id,
//     tenant_id: (me as any).tenant_id,
//     from_user_id: (me as any).id,
//     to_user_id: closerId,
//     note: note || null,
//   })
//   if (tErr) return { ok: false, message: tErr.message }

//   const { error: aErr } = await supabase
//     .from('lead_assignments')
//     .upsert(
//       {
//         practice_id: practice.id,
//         tenant_id: (me as any).tenant_id,
//         assigned_to: closerId,
//         assigned_by: (me as any).id,
//         current_status: 'Transferred',
//       },
//       { onConflict: 'practice_id,assigned_to' }
//     )
//   if (aErr) return { ok: false, message: aErr.message }

//   await supabase.from('lead_activity').insert({
//     practice_id: practice.id,
//     tenant_id: (me as any).tenant_id,
//     agent_id: (me as any).id,
//     type: 'status_change',
//     disposition: 'Transferred to Closer',
//     note: note || null,
//   })

//   return { ok: true, message: 'Transferred to closer' }
// }

// export async function markAsSold(
//   practiceCode: string,
//   serviceSold: string,
//   contractValue: string,
//   mrr: string,
//   note: string
// ) {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return { ok: false, message: 'Not logged in' }

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, tenant_id, roles(key)')
//     .eq('auth_id', user.id)
//     .single()
//   if (!me) return { ok: false, message: 'User not found' }

//   const roleKey = (me as any).roles?.key
//   if (roleKey !== 'closer' && roleKey !== 'company_admin') {
//     return { ok: false, message: 'Only a Closer or Company Admin can mark a sale' }
//   }

//   const { data: practice } = await supabase
//     .from('master_practices')
//     .select('id')
//     .eq('practice_code', practiceCode)
//     .maybeSingle()
//   if (!practice) return { ok: false, message: 'This lead could not be found — it may have been deleted.' }

//   // Once transferred, the whole worksheet (including marking it sold) is
//   // frozen from this form — matches the UI, enforced here too.
//   const { data: alreadyTransferred } = await supabase
//     .from('lead_transfers')
//     .select('id')
//     .eq('practice_id', practice.id)
//     .limit(1)
//     .maybeSingle()
//   if (alreadyTransferred) {
//     return { ok: false, message: 'This lead has already been transferred — the worksheet is locked and can no longer be edited.' }
//   }

//   const { data: sale, error: sErr } = await supabase
//     .from('sales')
//     .insert({
//       practice_id: practice.id,
//       tenant_id: (me as any).tenant_id,
//       sold_by: (me as any).id,
//       service_sold: serviceSold || null,
//       contract_value: contractValue ? Number(contractValue) : null,
//       mrr: mrr ? Number(mrr) : null,
//       note: note || null,
//     })
//     .select('id')
//     .single()
//   if (sErr) return { ok: false, message: sErr.message }

//   const { error: oErr } = await supabase
//     .from('client_ownership')
//     .insert({
//       practice_id: practice.id,
//       owner_tenant_id: (me as any).tenant_id,
//       sale_id: (sale as any).id,
//       active: true,
//     })
//   if (oErr) return { ok: false, message: 'This practice is already a client (locked): ' + oErr.message }

//   await supabase
//     .from('lead_assignments')
//     .update({ current_status: 'Sold' })
//     .eq('practice_id', practice.id)
//     .eq('assigned_to', (me as any).id)

//   await supabase.from('lead_activity').insert({
//     practice_id: practice.id,
//     tenant_id: (me as any).tenant_id,
//     agent_id: (me as any).id,
//     type: 'status_change',
//     disposition: 'SOLD',
//     note: `Sold ${serviceSold || ''} — value ${contractValue || '?'}, MRR ${mrr || '?'}. ${note || ''}`,
//   })

//   return { ok: true, message: 'Marked as SOLD — practice is now a locked client' }
// }

// // ============================================================================
// // SOFT-DELETE / RESTORE / HARD-DELETE  (Super Admin only)
// // Two-stage delete workflow:
// //   Stage 1 (softDeleteLeads): sets deleted_at → hidden from Super Admin main
// //           pool, moved to /deleted-leads page. Company admins with the lead
// //           allocated/assigned still see it in their pool.
// //   Stage 2 (hardDeleteLeads): DELETE FROM database — gone for everyone.
// //   Restore (restoreLeads): undo Stage 1, lead reappears in main pool.
// // ============================================================================

// /**
//  * STAGE 1 — Soft delete. Marks selected practice_codes as deleted (hidden
//  * from Super Admin main pool). Company admins/agents with the lead still
//  * allocated/assigned continue to see it in their pool until Stage 2 fires.
//  */
// export async function softDeleteLeads(codes: string[]) {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return { ok: false, message: 'Not signed in.' }

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, roles(key)')
//     .eq('auth_id', user.id)
//     .single()
//   const roleKey = (me as any)?.roles?.key
//   if (roleKey !== 'super_admin') {
//     return { ok: false, message: 'Only Super Admin can delete leads.' }
//   }
//   if (!codes || codes.length === 0) {
//     return { ok: false, message: 'No leads selected.' }
//   }

//   const { error, count } = await supabase
//     .from('master_practices')
//     .update(
//       { deleted_at: new Date().toISOString(), deleted_by: (me as any).id },
//       { count: 'exact' }
//     )
//     .in('practice_code', codes)
//     .is('deleted_at', null)   // don't touch rows already soft-deleted

//   if (error) return { ok: false, message: error.message }
//   revalidatePath('/')
//   revalidatePath('/deleted-leads')
//   return { ok: true, message: `Moved ${count ?? codes.length} lead(s) to Deleted Leads.` }
// }

// /**
//  * Restore soft-deleted leads back to the main pool.
//  */
// export async function restoreLeads(codes: string[]) {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return { ok: false, message: 'Not signed in.' }

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, roles(key)')
//     .eq('auth_id', user.id)
//     .single()
//   if ((me as any)?.roles?.key !== 'super_admin') {
//     return { ok: false, message: 'Only Super Admin can restore leads.' }
//   }
//   if (!codes || codes.length === 0) {
//     return { ok: false, message: 'No leads selected.' }
//   }

//   const { error, count } = await supabase
//     .from('master_practices')
//     .update({ deleted_at: null, deleted_by: null }, { count: 'exact' })
//     .in('practice_code', codes)
//     .not('deleted_at', 'is', null)

//   if (error) return { ok: false, message: error.message }
//   revalidatePath('/')
//   revalidatePath('/deleted-leads')
//   return { ok: true, message: `Restored ${count ?? codes.length} lead(s) to the pool.` }
// }

// /**
//  * STAGE 2 — Hard delete. Permanently removes rows from the database.
//  * Related rows (allocations, assignments, etc.) are removed via ON DELETE
//  * CASCADE / ON DELETE SET NULL — verify your FK constraints match intent.
//  */
// export async function hardDeleteLeads(codes: string[]) {
//   const supabase = await createSupabaseServer()

//   const { data: { user } } = await supabase.auth.getUser()
//   if (!user) return { ok: false, message: 'Not signed in.' }

//   const { data: me } = await supabase
//     .from('users')
//     .select('id, roles(key)')
//     .eq('auth_id', user.id)
//     .single()
//   if ((me as any)?.roles?.key !== 'super_admin') {
//     return { ok: false, message: 'Only Super Admin can permanently delete leads.' }
//   }
//   if (!codes || codes.length === 0) {
//     return { ok: false, message: 'No leads selected.' }
//   }

//   const { error, count } = await supabase
//     .from('master_practices')
//     .delete({ count: 'exact' })
//     .in('practice_code', codes)

//   if (error) return { ok: false, message: error.message }
//   revalidatePath('/')
//   revalidatePath('/deleted-leads')
//   return { ok: true, message: `Permanently deleted ${count ?? codes.length} lead(s).` }
// }
'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { authorizePractice } from '../lib/lead-access'
import { revalidatePath } from 'next/cache'

export async function allocatePractices(practiceCodes: string[], tenantSlug: string) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await getCurrentProfile(user.id)

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

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found' }

  const practice = await authorizePractice(supabase, me, practiceCode)
  if (!practice) return { ok: false, message: 'This lead is unavailable or you do not have permission to update it.' }

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

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found' }

  const practice = await authorizePractice(supabase, me, practiceCode)
  if (!practice) return { ok: false, message: 'This lead is unavailable or you do not have permission to update it.' }

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
  const { data: { user } } = await getCurrentUser()
  if (!user) return []

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return []

  const { data: people } = await supabase
    .from('users')
    .select('id, full_name, email, roles(key, label)')
    .eq('tenant_id', (me as any).tenant_id)
    .eq('status', 'active')

  const closers = (people ?? [])
    .filter((c: any) => c.roles?.key === 'closer')
    .map((c: any) => ({ id: c.id, name: c.full_name, email: c.email }))

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

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found' }

  const practice = await authorizePractice(supabase, me, practiceCode)
  if (!practice) return { ok: false, message: 'This lead is unavailable or you do not have permission to transfer it.' }

  const { data: recipient } = await supabase.from('users')
    .select('id, tenant_id, status, roles(key)')
    .eq('id', closerId)
    .maybeSingle()
  const target = recipient as unknown as { id: string; tenant_id: string | null; status: string; roles: { key: string } | null } | null
  const transferringToSelf = closerId === me.id
  if (!target || target.tenant_id !== me.tenant_id || target.status !== 'active'
      || (!transferringToSelf && target.roles?.key !== 'closer')) {
    return { ok: false, message: 'Choose an active closer from your company.' }
  }

  // Update the existing handoff in place so a failed replacement never
  // destroys the previous transfer record.
  const { data: previousTransfer } = await supabase.from('lead_transfers')
    .select('id, tenant_id, from_user_id, to_user_id, note')
    .eq('practice_id', practice.id).eq('tenant_id', me.tenant_id).limit(1).maybeSingle()
  const transferValues = {
    tenant_id: me.tenant_id,
    from_user_id: me.id,
    to_user_id: closerId,
    note: note.trim() || null,
  }
  const transferWrite = previousTransfer
    ? await supabase.from('lead_transfers').update(transferValues).eq('id', previousTransfer.id)
    : await supabase.from('lead_transfers').insert({ practice_id: practice.id, ...transferValues })
  const tErr = transferWrite.error
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
  if (aErr) {
    if (previousTransfer) {
      await supabase.from('lead_transfers').update({
        tenant_id: previousTransfer.tenant_id,
        from_user_id: previousTransfer.from_user_id,
        to_user_id: previousTransfer.to_user_id,
        note: previousTransfer.note,
      }).eq('id', previousTransfer.id)
    } else {
      await supabase.from('lead_transfers').delete()
        .eq('practice_id', practice.id).eq('tenant_id', me.tenant_id)
        .eq('from_user_id', me.id).eq('to_user_id', closerId)
    }
    return { ok: false, message: aErr.message }
  }

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

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not logged in' }

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found' }

  const roleKey = (me as any).roles?.key
  if (roleKey !== 'closer' && roleKey !== 'company_admin') {
    return { ok: false, message: 'Only a Closer or Company Admin can mark a sale' }
  }

  const practice = await authorizePractice(supabase, me, practiceCode)
  if (!practice) return { ok: false, message: 'This lead is unavailable or you do not have permission to sell it.' }

  const service = serviceSold.trim()
  const contractAmount = contractValue.trim() ? Number(contractValue) : null
  const monthlyAmount = mrr.trim() ? Number(mrr) : null
  if (!service) return { ok: false, message: 'Service sold is required.' }
  if ((contractAmount != null && (!Number.isFinite(contractAmount) || contractAmount < 0))
      || (monthlyAmount != null && (!Number.isFinite(monthlyAmount) || monthlyAmount < 0))) {
    return { ok: false, message: 'Contract value and MRR must be valid positive amounts.' }
  }

  const { data: existingOwnership } = await supabase.from('client_ownership')
    .select('id').eq('practice_id', practice.id).eq('active', true).limit(1).maybeSingle()
  if (existingOwnership) return { ok: false, message: 'This practice is already an active client.' }

  const { data: sale, error: sErr } = await supabase
    .from('sales')
    .insert({
      practice_id: practice.id,
      tenant_id: (me as any).tenant_id,
      sold_by: (me as any).id,
      service_sold: service,
      contract_value: contractAmount,
      mrr: monthlyAmount,
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
  if (oErr) {
    await supabase.from('sales').delete().eq('id', (sale as { id: string }).id)
    return { ok: false, message: 'This practice could not be converted to a client: ' + oErr.message }
  }

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

  // Completing a sale ends this company's exclusive claim. Original Super
  // Admin allocations remain active, so the other allocated companies can
  // see and work the lead again while this sale remains in Sold Leads.
  const { error: releaseError } = await supabase.rpc('release_company_claim', {
    p_practice_id: practice.id,
    p_status: 'sold',
    p_reason: 'Sale completed',
  })
  if (releaseError) {
    return { ok: true, message: 'Marked as SOLD, but the company claim could not be released automatically.' }
  }

  return { ok: true, message: 'Marked as SOLD. The lead is available again to its other allocated companies.' }
}

// ============================================================================
// SOFT-DELETE / RESTORE / HARD-DELETE  (Super Admin only)
// ============================================================================

export async function softDeleteLeads(codes: string[]) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)
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
    .is('deleted_at', null)

  if (error) return { ok: false, message: error.message }
  revalidatePath('/')
  revalidatePath('/deleted-leads')
  return { ok: true, message: `Moved ${count ?? codes.length} lead(s) to Deleted Leads.` }
}

export async function restoreLeads(codes: string[]) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)
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

export async function hardDeleteLeads(codes: string[]) {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)
  if ((me as any)?.roles?.key !== 'super_admin') {
    return { ok: false, message: 'Only Super Admin can permanently delete leads.' }
  }
  if (!codes || codes.length === 0) {
    return { ok: false, message: 'No leads selected.' }
  }

  // Resolve the practices being deleted, plus their PROVIDERS. A leftover
  // provider keeps the NPI "taken" and blocks re-upload, so we purge providers,
  // their signals/mips, AND all ROSTER members of the same organization
  // (same org_pac_id) — otherwise deleting an anchor leaves its roster behind.
  const { data: practicesToDelete } = await supabase
    .from('master_practices')
    .select('id, practice_code, practice_providers(providers(id, org_pac_id))')
    .in('practice_code', codes)

  const providerIds = new Set<string>()
  const orgPacIds = new Set<string>()
  for (const p of (practicesToDelete ?? []) as any[]) {
    for (const link of (p.practice_providers ?? [])) {
      const prov = link.providers
      if (prov?.id) providerIds.add(prov.id)
      if (prov?.org_pac_id) orgPacIds.add(prov.org_pac_id)
    }
  }

  // Pull in every provider (and its practice) that shares a deleted anchor's org.
  const codesToDelete = new Set<string>(codes)
  if (orgPacIds.size) {
    const { data: orgProviders } = await supabase
      .from('providers')
      .select('id, npi, org_pac_id')
      .in('org_pac_id', Array.from(orgPacIds))
    for (const pr of (orgProviders ?? []) as any[]) {
      if (pr.id) providerIds.add(pr.id)
      if (pr.npi) codesToDelete.add(`PR-${pr.npi}`)
    }
  }

  const provIdArr = Array.from(providerIds)
  const codeArr = Array.from(codesToDelete)

  // Delete provider children first (signals/mips), then the providers.
  if (provIdArr.length) {
    for (let i = 0; i < provIdArr.length; i += 300) {
      const part = provIdArr.slice(i, i + 300)
      await supabase.from('provider_signals').delete().in('provider_id', part)
      await supabase.from('provider_mips').delete().in('provider_id', part)
    }
  }

  // Delete the practices (anchors + their roster members).
  const { error, count } = await supabase
    .from('master_practices')
    .delete({ count: 'exact' })
    .in('practice_code', codeArr)
  if (error) return { ok: false, message: error.message }

  // Now delete the orphaned providers themselves.
  if (provIdArr.length) {
    for (let i = 0; i < provIdArr.length; i += 300) {
      const part = provIdArr.slice(i, i + 300)
      await supabase.from('providers').delete().in('id', part)
    }
  }

  revalidatePath('/')
  revalidatePath('/deleted-leads')
  return { ok: true, message: `Permanently deleted ${count ?? codeArr.length} lead(s) (incl. roster members).` }
}
