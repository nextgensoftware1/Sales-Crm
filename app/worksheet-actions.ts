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

// Save the shared per-practice worksheet. Anyone signed in may save (latest wins).
// Call details are required — this is the core record of what happened on the
// call, so it can't be skipped. If a callback date is provided, also create a
// reminder for the caller.
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

  const callbackIso = ws.callbackAt ? new Date(ws.callbackAt).toISOString() : null

  const { error } = await supabase
    .from('master_practices')
    .update({
      ws_call_details: ws.callDetails || null,
      ws_additional_phone: ws.additionalPhone || null,
      ws_email: ws.email || null,
      ws_concerned_person: ws.concernedPerson || null,
      ws_direct_line: ws.directLine || null,
      ws_callback_at: callbackIso,
      ws_timezone: ws.timezone || null,
      ws_disposition: ws.disposition || null,
      ws_updated_at: new Date().toISOString(),
      ws_updated_by: (me as any).id,
    })
    .eq('id', (practice as any).id)

  if (error) return { ok: false, message: `Save failed: ${error.message}` }

  // Save the activity in this same authenticated request. The client used to
  // dispatch a second Server Action, repeating auth/profile/practice reads.
  const shouldLog = !!ws.disposition && ws.disposition !== 'New'
  const [reminderResult, activityResult] = await Promise.all([
    callbackIso ? supabase.from('lead_reminders').insert({
      practice_id: (practice as any).id,
      tenant_id: (me as any).tenant_id,
      agent_id: (me as any).id,
      remind_at: callbackIso,
      note: ws.disposition ? `Callback (${ws.disposition})` : 'Worksheet callback',
    }) : Promise.resolve({ error: null }),
    shouldLog ? supabase.from('lead_activity').insert({
      practice_id: practice.id,
      tenant_id: me.tenant_id,
      agent_id: me.id,
      type: 'call',
      disposition: ws.disposition,
      note: ws.callDetails,
    }) : Promise.resolve({ error: null }),
  ])
  const warnings: string[] = []
  if (reminderResult.error) warnings.push('the callback reminder could not be created')
  if (activityResult.error) warnings.push('the activity log could not be saved')
  if (shouldLog && !activityResult.error) {
    const { error: statusError } = await supabase.from('lead_assignments')
      .update({ current_status: ws.disposition, last_activity_at: new Date().toISOString() })
      .eq('practice_id', practice.id).eq('assigned_to', me.id)
    if (statusError) warnings.push('the assignment status could not be updated')
  }

  return { ok: true, message: warnings.length
    ? `Worksheet saved, but ${warnings.join('; ')}.` : 'Worksheet saved.' }
}
