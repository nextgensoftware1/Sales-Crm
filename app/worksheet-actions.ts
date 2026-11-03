'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { authorizePractice } from '../lib/lead-access'
import { normalizeZone, zonedWallTimeToUtcIso } from '../lib/us-time' // ← ADDED

export type WorksheetData = {
  callDetails: string
  additionalPhone: string
  email: string
  concernedPerson: string
  directLine: string
  callbackAt: string   // ← CHANGED: "YYYY-MM-DDTHH:mm" on the chosen zone's clock (or a full ISO time), or ''
  timezone: string     // ← CHANGED: Eastern | Central | Mountain | Arizona | Pacific
  disposition: string
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

  // ← CHANGED: the callback time is the PRACTICE'S clock in the chosen US
  // zone (EST / CST / MST / PST). It used to be read on the server's own
  // clock (your PC or UTC), ignoring the zone — so "10:00 EST" was stored
  // hours too early and showed as Overdue for everyone else.
  const zone = normalizeZone(ws.timezone)
  let callbackIso: string | null = null
  if (ws.callbackAt) {
    if (!zone) return { ok: false, message: 'Choose the callback time zone (EST, CST, MST or PST).' }
    const raw = ws.callbackAt.trim()
    // A full timestamp with its own offset (e.g. "…Z") is already exact.
    callbackIso = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw)
      ? (Number.isNaN(new Date(raw).getTime()) ? null : new Date(raw).toISOString())
      : zonedWallTimeToUtcIso(raw, zone)
    if (!callbackIso) return { ok: false, message: 'Choose a valid callback date and time.' }
  }

  const { data, error } = await supabase.rpc('save_company_worksheet', {
    p_practice_id: practice.id,
    p_call_details: ws.callDetails.trim(),
    p_additional_phone: ws.additionalPhone,
    p_email: ws.email,
    p_concerned_person: ws.concernedPerson,
    p_direct_line: ws.directLine,
    p_callback_at: callbackIso,
    p_timezone: zone ?? (ws.timezone || null), // ← CHANGED: stored as Eastern / Central / …
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
