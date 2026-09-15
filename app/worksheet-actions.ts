'use server'

import { createSupabaseServer } from '../lib/supabase-server'

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

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_id', user.id)
    .single()
  if (!me) return { ok: false, message: 'User not found.' }

  const { data: practice } = await supabase
    .from('master_practices')
    .select('id')
    .eq('practice_code', practiceCode)
    .maybeSingle()
  if (!practice) return { ok: false, message: 'This lead could not be found — it may have been deleted.' }

  // Once transferred, the whole worksheet is frozen — matches the UI, but
  // enforced here too so it can't be bypassed by calling this action directly.
  const { data: transferred } = await supabase
    .from('lead_transfers')
    .select('id')
    .eq('practice_id', practice.id)
    .limit(1)
    .maybeSingle()
  if (transferred) {
    return { ok: false, message: 'This lead has already been transferred — the worksheet is locked and can no longer be edited.' }
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

  // If a callback date was set, also create a reminder for the caller.
  if (callbackIso) {
    await supabase.from('lead_reminders').insert({
      practice_id: (practice as any).id,
      tenant_id: (me as any).tenant_id,
      agent_id: (me as any).id,
      remind_at: callbackIso,
      note: ws.disposition ? `Callback (${ws.disposition})` : 'Worksheet callback',
    })
  }

  return { ok: true, message: 'Worksheet saved.' }
}