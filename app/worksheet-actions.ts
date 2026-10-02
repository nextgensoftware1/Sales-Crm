'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { authorizePractice } from '../lib/lead-access'

export type WorksheetData = {
  callDetails: string
  additionalPhone: string
  email: string
  concernedPerson: string
  directLine: string
  callbackAt: string   // ISO string or ''
  timezone: string
  disposition: string
}

export type WorksheetPreview = {
  worksheet: {
    callDetails: string | null
    additionalPhone: string | null
    email: string | null
    concernedPerson: string | null
    directLine: string | null
    callbackAt: string | null
    timezone: string | null
    disposition: string | null
    updatedAt: string | null
    updatedByName: string | null
    companyName: string | null
  } | null
  activities: {
    disposition: string | null
    note: string | null
    createdAt: string
    userName: string | null
  }[]
}

export type WorksheetPreviewActivity = WorksheetPreview['activities'][number]

export async function getWorksheetPreviewActivity(
  practiceCode: string,
  tenantId: string,
  practiceId: string,
): Promise<{ ok: true; activities: WorksheetPreviewActivity[] } | { ok: false; message: string }> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found.' }
  const roleKey = me.roles?.key ?? ''
  if (!['super_admin', 'company_admin', 'manager', 'team_lead', 'agent', 'closer'].includes(roleKey)) {
    return { ok: false, message: 'You do not have permission to view worksheet reports.' }
  }
  if (roleKey !== 'super_admin' && (!me.tenant_id || me.tenant_id !== tenantId)) {
    return { ok: false, message: 'This worksheet belongs to another company.' }
  }

  let worksheetQuery = supabase.from('lead_worksheets')
    .select('practice_id, master_practices!inner(practice_code, deleted_at)')
    .eq('practice_id', practiceId)
    .eq('tenant_id', tenantId)
    .eq('master_practices.practice_code', practiceCode)
    .is('master_practices.deleted_at', null)
  if (roleKey === 'agent' || roleKey === 'closer') worksheetQuery = worksheetQuery.eq('updated_by', me.id)
  const { data: worksheet, error: worksheetError } = await worksheetQuery.maybeSingle()
  if (worksheetError) return { ok: false, message: 'Could not verify worksheet access.' }
  if (!worksheet) return { ok: false, message: 'This worksheet is unavailable.' }

  const { data: activityRows, error: activityError } = await supabase.from('lead_activity')
    .select('disposition, note, created_at, users(full_name)')
    .eq('practice_id', practiceId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(12)
  if (activityError) return { ok: false, message: 'Could not load recent activity.' }

  type ActivityRow = {
    disposition: string | null
    note: string | null
    created_at: string
    users: { full_name: string | null } | null
  }
  const activities = (activityRows ?? []) as unknown as ActivityRow[]
  return {
    ok: true,
    activities: activities.map(activity => ({
      disposition: activity.disposition,
      note: activity.note,
      createdAt: activity.created_at,
      userName: activity.users?.full_name ?? null,
    })),
  }
}

export async function getWorksheetPreview(practiceCode: string, tenantId?: string, practiceId?: string): Promise<
  { ok: true; data: WorksheetPreview } | { ok: false; message: string }
> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found.' }

  const roleKey = me.roles?.key ?? ''
  let authorizedPracticeId: string
  if (tenantId && practiceId) {
    if (!['super_admin', 'company_admin', 'manager', 'team_lead', 'agent', 'closer'].includes(roleKey)) {
      return { ok: false, message: 'You do not have permission to view worksheet reports.' }
    }
    if (roleKey !== 'super_admin' && (!me.tenant_id || tenantId !== me.tenant_id)) {
      return { ok: false, message: 'This worksheet belongs to another company.' }
    }
    authorizedPracticeId = practiceId
  } else {
    const practice = await authorizePractice(supabase, me, practiceCode)
    if (!practice) return { ok: false, message: 'This lead is unavailable or you do not have permission to view it.' }
    authorizedPracticeId = practice.id
  }

  let worksheetQuery = supabase.from('lead_worksheets').select(`
    tenant_id, call_details, additional_phone, email, concerned_person, direct_line,
    callback_at, timezone, disposition, updated_at,
    users!lead_worksheets_updated_by_fkey(full_name), tenants!lead_worksheets_tenant_id_fkey(name),
    master_practices!inner(practice_code, deleted_at)
  `).eq('practice_id', authorizedPracticeId).order('updated_at', { ascending: false }).limit(1)
  if (tenantId && practiceId) {
    worksheetQuery = worksheetQuery.eq('tenant_id', tenantId)
      .eq('master_practices.practice_code', practiceCode)
      .is('master_practices.deleted_at', null)
  } else if (roleKey !== 'super_admin' && me.tenant_id) {
    worksheetQuery = worksheetQuery.eq('tenant_id', me.tenant_id)
  }
  if (tenantId && (roleKey === 'agent' || roleKey === 'closer')) {
    worksheetQuery = worksheetQuery.eq('updated_by', me.id)
  }

  type WorksheetRow = {
    tenant_id: string
    call_details: string | null
    additional_phone: string | null
    email: string | null
    concerned_person: string | null
    direct_line: string | null
    callback_at: string | null
    timezone: string | null
    disposition: string | null
    updated_at: string | null
    users: { full_name: string | null } | null
    tenants: { name: string | null } | null
    master_practices: { practice_code: string; deleted_at: string | null }
  }
  type ActivityRow = {
    disposition: string | null
    note: string | null
    created_at: string
    users: { full_name: string | null } | null
  }
  const readActivities = (activityTenantId: string) => supabase.from('lead_activity')
      .select('disposition, note, created_at, users(full_name)')
      .eq('practice_id', authorizedPracticeId)
      .eq('tenant_id', activityTenantId)
      .order('created_at', { ascending: false })
      .limit(12)

  let saved: WorksheetRow | undefined
  let activities: ActivityRow[] = []
  const knownTenantId = tenantId ?? (roleKey !== 'super_admin' ? me.tenant_id ?? undefined : undefined)

  if (knownTenantId) {
    const [{ data: worksheetRows, error: worksheetError }, { data: activityRows, error: activityError }] = await Promise.all([
      worksheetQuery,
      readActivities(knownTenantId),
    ])
    if (worksheetError || activityError) return { ok: false, message: 'Could not load this worksheet. Please try again.' }
    saved = worksheetRows?.[0] as unknown as WorksheetRow | undefined
    if (saved) activities = (activityRows ?? []) as unknown as ActivityRow[]
  } else {
    const { data: worksheetRows, error: worksheetError } = await worksheetQuery
    if (worksheetError) return { ok: false, message: 'Could not load this worksheet. Please try again.' }
    saved = worksheetRows?.[0] as unknown as WorksheetRow | undefined
    if (saved) {
      const { data: activityRows, error: activityError } = await readActivities(saved.tenant_id)
      if (activityError) return { ok: false, message: 'Could not load this worksheet. Please try again.' }
      activities = (activityRows ?? []) as unknown as ActivityRow[]
    }
  }

  return {
    ok: true,
    data: {
      worksheet: saved ? {
        callDetails: saved.call_details,
        additionalPhone: saved.additional_phone,
        email: saved.email,
        concernedPerson: saved.concerned_person,
        directLine: saved.direct_line,
        callbackAt: saved.callback_at,
        timezone: saved.timezone,
        disposition: saved.disposition,
        updatedAt: saved.updated_at,
        updatedByName: saved.users?.full_name ?? null,
        companyName: saved.tenants?.name ?? null,
      } : null,
      activities: activities.map(activity => ({
        disposition: activity.disposition,
        note: activity.note,
        createdAt: activity.created_at,
        userName: activity.users?.full_name ?? null,
      })),
    },
  }
}

// Save the worksheet for the caller's company. The database function performs
// the worksheet write, optional claim, reminder, activity and status update in
// one transaction so two companies cannot claim the same lead concurrently.
// Call details are required — this is the core record of what happened on the
// call, so it can't be skipped. If a callback date is provided, also create a
// reminder for the caller. The database reminder trigger updates the existing
// incomplete reminder for this company/lead instead of creating duplicates.
export async function saveWorksheet(practiceCode: string, ws: WorksheetData): Promise<{ ok: boolean; message: string }> {
  if (!ws.callDetails || !ws.callDetails.trim()) {
    return { ok: false, message: 'Call details are required before saving.' }
  }

  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)
  if (!me) return { ok: false, message: 'User not found.' }

  const practice = await authorizePractice(supabase, me, practiceCode)
  if (!practice) return { ok: false, message: 'This lead is unavailable or you do not have permission to edit it.' }

  // Once transferred, only the receiving closer — or Super Admin — may keep
  // editing the worksheet; the original transferring agent is locked out.
  // This mirrors the UI's `worksheetLocked` check in practice/[code]/page.tsx
  // (locked unless you're the transfer's recipient or Super Admin), enforced
  // here too so it can't be bypassed by calling this action directly.
  const isSuperAdmin = (me as any).roles?.key === 'super_admin'
  if (!isSuperAdmin) {
    const { data: transferred } = await supabase
      .from('lead_transfers')
      .select('to_user_id')
      .eq('practice_id', practice.id)
      .limit(1)
      .maybeSingle()
    if (transferred && (transferred as any).to_user_id !== (me as any).id) {
      return { ok: false, message: 'This lead has already been transferred — only the receiving closer (or Super Admin) can edit the worksheet now.' }
    }
  }

  let callbackIso: string | null = null
  if (ws.callbackAt) {
    const parsed = new Date(ws.callbackAt)
    if (Number.isNaN(parsed.getTime())) return { ok: false, message: 'Choose a valid callback date and time.' }
    callbackIso = parsed.toISOString()
  }

  const { data, error } = await supabase.rpc('save_company_worksheet', {
    p_practice_id: practice.id,
    p_call_details: ws.callDetails.trim(),
    p_additional_phone: ws.additionalPhone,
    p_email: ws.email,
    p_concerned_person: ws.concernedPerson,
    p_direct_line: ws.directLine,
    p_callback_at: callbackIso,
    p_timezone: ws.timezone,
    p_disposition: ws.disposition || 'New',
  })

  if (error) {
    const claimedElsewhere = error.message.toLowerCase().includes('claimed by another company')
    return { ok: false, message: claimedElsewhere
      ? 'This lead was just claimed by another company. Refresh the lead list; your typed details remain on this screen.'
      : `Save failed: ${error.message}` }
  }

  const claimed = Boolean((data as { claimed?: boolean } | null)?.claimed)
  return { ok: true, message: claimed
    ? 'Worksheet saved. This lead is now reserved for your company.'
    : 'Worksheet saved.' }
}
