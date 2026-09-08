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
// If a callback date is provided, also create a reminder for the caller.
export async function saveWorksheet(practiceCode: string, ws: WorksheetData): Promise<{ ok: boolean; message: string }> {
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
    .single()
  if (!practice) return { ok: false, message: 'Practice not found.' }

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