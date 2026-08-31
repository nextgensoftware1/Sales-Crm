'use server'

import { createSupabaseServer } from '../lib/supabase-server'

export async function allocatePractices(practiceCodes: string[], tenantSlug: string) {
  const supabase = await createSupabaseServer()

  // Verify the caller is the Super Admin
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

  // Find the target company
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single()
  if (!tenant) return { ok: false, message: 'Company not found' }

  // Find the practice ids from their codes
  const { data: practices } = await supabase
    .from('master_practices')
    .select('id')
    .in('practice_code', practiceCodes)

  if (!practices || practices.length === 0) {
    return { ok: false, message: 'No practices selected' }
  }

  // Build allocation rows and insert (skip duplicates)
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
    .single()
  if (!practice) return { ok: false, message: 'Practice not found' }

  // Write the activity
  const { error } = await supabase.from('lead_activity').insert({
    practice_id: practice.id,
    tenant_id: (me as any).tenant_id,
    agent_id: (me as any).id,
    type: 'call',
    disposition: disposition || null,
    note: note || null,
  })
  if (error) return { ok: false, message: error.message }

  // Update the assignment's current status (if this agent has it assigned)
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
  remindAt: string,   // ISO date-time string
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
    .single()
  if (!practice) return { ok: false, message: 'Practice not found' }

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
// List closers in the current user's company (for the transfer dropdown)
export async function getClosers() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: me } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_id', user.id)
    .single()
  if (!me) return []

  const { data: closers } = await supabase
    .from('users')
    .select('id, full_name, email, roles(key)')
    .eq('tenant_id', (me as any).tenant_id)
    .eq('status', 'active')

  // keep only closers
  return (closers ?? [])
    .filter((c: any) => c.roles?.key === 'closer')
    .map((c: any) => ({ id: c.id, name: c.full_name, email: c.email }))
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
    .single()
  if (!practice) return { ok: false, message: 'Practice not found' }

  // 1. Record the transfer
  const { error: tErr } = await supabase.from('lead_transfers').insert({
    practice_id: practice.id,
    tenant_id: (me as any).tenant_id,
    from_user_id: (me as any).id,
    to_user_id: closerId,
    note: note || null,
  })
  if (tErr) return { ok: false, message: tErr.message }

  // 2. Assign the lead to the closer (so it appears in their list)
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

  // 3. Log it as activity
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

  // Only closers (or company admins) may mark a sale
  const roleKey = (me as any).roles?.key
  if (roleKey !== 'closer' && roleKey !== 'company_admin') {
    return { ok: false, message: 'Only a Closer or Company Admin can mark a sale' }
  }

  const { data: practice } = await supabase
    .from('master_practices')
    .select('id')
    .eq('practice_code', practiceCode)
    .single()
  if (!practice) return { ok: false, message: 'Practice not found' }

  // 1. Create the sale
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

  // 2. Create the client-ownership lock (fails if already owned = already sold)
  const { error: oErr } = await supabase
    .from('client_ownership')
    .insert({
      practice_id: practice.id,
      owner_tenant_id: (me as any).tenant_id,
      sale_id: (sale as any).id,
      active: true,
    })
  if (oErr) return { ok: false, message: 'This practice is already a client (locked): ' + oErr.message }

  // 3. Update the assignment status to 'Sold'
  await supabase
    .from('lead_assignments')
    .update({ current_status: 'Sold' })
    .eq('practice_id', practice.id)
    .eq('assigned_to', (me as any).id)

  // 4. Log activity
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