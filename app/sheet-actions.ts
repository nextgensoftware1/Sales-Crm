'use server'

// ← ADDED (new file) — Leads Engine spreadsheet view.
//
// getSheetDetails: for the leads shown on ONE page of the spreadsheet, the
//   few extra things the grid needs that the lead list does not carry: the
//   practice phone (to dial), the company's existing worksheet (so a lead
//   that a previous agent already worked is not overwritten with blanks),
//   the existing email worksheet for Email leads, and whether the lead is
//   locked by a transfer. One small read per page — never the whole list.
//
// forgetSavedLeads: after a row is saved, removes that lead from this
//   user's cached lead list on the server (memory only, no database read),
//   exactly like the queue rule that already applies after a save, and
//   returns the updated counts for the cards at the top.
//
// Saving itself uses the SAME actions as the practice page (saveWorksheet /
// saveEmailWorksheet), so permissions, reminders, claims and Active Call /
// Active Email all behave exactly as before.

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { removeLeadsFromSnapshots } from '../lib/lead-snapshots'
import type { LeadOverview } from '../lib/lead-filters'

const CODE_RE = /^[A-Za-z0-9_.:-]{1,64}$/
const MAX_CODES = 200

export type SheetWorksheet = {
  callDetails: string; additionalPhone: string; email: string; concernedPerson: string
  directLine: string; callbackAt: string | null; timezone: string | null; disposition: string
}
export type SheetEmailWorksheet = { email: string; response: string; note: string }
// ← ADDED: the Authorized Official, as on the practice page.
export type SheetOfficial = { name: string | null; title: string | null; credential: string | null; phone: string | null }
export type SheetDetail = {
  practiceCode: string
  practiceId: string
  phone: string | null
  official: SheetOfficial | null // ← ADDED
  isEmailLead: boolean
  locked: boolean
  worksheet: SheetWorksheet | null
  emailWorksheet: SheetEmailWorksheet | null
}

function cleanCodes(codes: unknown): string[] {
  if (!Array.isArray(codes)) return []
  return Array.from(new Set(codes.filter((c): c is string => typeof c === 'string' && CODE_RE.test(c)))).slice(0, MAX_CODES)
}

// ← CHANGED: + the linked provider's Authorized Official fields
type ProviderBits = {
  name: string | null; phone: string | null; entity_type: string | null; is_anchor: boolean | null
  auth_official_name: string | null; auth_official_title: string | null; auth_official_credential: string | null; auth_official_phone: string | null
}
type PracticeRow = {
  id: string; practice_code: string; phone: string | null; lead_category: string | null
  practice_providers?: { providers: ProviderBits | ProviderBits[] | null }[] | null
}

// ← ADDED: same rule as the practice page's "Authorized Official" panel:
// the NPPES Authorized Official of the lead's first provider; an individual
// (NPI-1) has no separate official, so their own name and phone are shown.
function officialFor(p: PracticeRow): SheetOfficial | null {
  const link = (p.practice_providers ?? [])[0]
  const provider = Array.isArray(link?.providers) ? link?.providers[0] : link?.providers
  if (!provider) return null
  const entity = (provider.entity_type ?? '').toString().trim().toLowerCase()
  const type2 = entity ? entity.includes('2') || entity.includes('org') : !!provider.is_anchor
  const type1 = entity ? entity.includes('1') || entity.includes('ind') : !provider.is_anchor
  const individual = type1 && !type2
  const clean = (v: string | null | undefined) => (v ?? '').toString().trim() || null
  const official = {
    name: clean(provider.auth_official_name) ?? (individual ? clean(provider.name) : null),
    title: clean(provider.auth_official_title),
    credential: clean(provider.auth_official_credential),
    phone: clean(provider.auth_official_phone) ?? (individual ? clean(provider.phone) ?? clean(p.phone) : null),
  }
  return official.name || official.phone || official.title ? official : null
}

export async function getSheetDetails(codes: string[]): Promise<{ ok: boolean; message?: string; details?: SheetDetail[] }> {
  const list = cleanCodes(codes)
  if (!list.length) return { ok: true, details: [] }

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Your session has ended. Please sign in again.' }
  const { data: me } = await getCurrentProfile(user.id)
  if (!me || me.status !== 'active') return { ok: false, message: 'User not found.' }
  const tenantId = me.tenant_id ?? null
  const isSuperAdmin = me.roles?.key === 'super_admin'

  const supabase = await createSupabaseServer()
  const { data: practiceRows, error } = await supabase.from('master_practices')
    .select('id, practice_code, phone, lead_category, practice_providers(providers(name, phone, entity_type, is_anchor, auth_official_name, auth_official_title, auth_official_credential, auth_official_phone))') // ← CHANGED: + Authorized Official
    .in('practice_code', list)
    .is('deleted_at', null)
  if (error) return { ok: false, message: error.message }

  // One row per lead code (an Email-lead copy wins if a code has two copies).
  const byCode = new Map<string, PracticeRow>()
  for (const row of (practiceRows ?? []) as PracticeRow[]) {
    const current = byCode.get(row.practice_code)
    if (!current || (row.lead_category === 'Email' && current.lead_category !== 'Email')) byCode.set(row.practice_code, row)
  }
  const ids = Array.from(byCode.values()).map((p) => p.id)
  if (!ids.length) return { ok: true, details: [] }

  const empty = { data: [] as unknown[], error: null }
  const [worksheets, emailWorksheets, transfers] = await Promise.all([
    tenantId
      ? supabase.from('lead_worksheets')
          .select('practice_id, call_details, additional_phone, email, concerned_person, direct_line, callback_at, timezone, disposition')
          .eq('tenant_id', tenantId).in('practice_id', ids)
      : Promise.resolve(empty),
    tenantId
      ? Promise.resolve(supabase.from('lead_email_worksheets').select('practice_id, email, response, note')
          .eq('tenant_id', tenantId).in('practice_id', ids)).catch(() => empty)
      : Promise.resolve(empty),
    isSuperAdmin
      ? Promise.resolve(empty)
      : supabase.from('lead_transfers').select('practice_id, to_user_id').in('practice_id', ids),
  ])

  type Ws = { practice_id: string; call_details: string | null; additional_phone: string | null; email: string | null; concerned_person: string | null
    direct_line: string | null; callback_at: string | null; timezone: string | null; disposition: string | null }
  const wsById = new Map(((worksheets.data ?? []) as Ws[]).map((w) => [w.practice_id, w]))
  type Ew = { practice_id: string; email: string | null; response: string | null; note: string | null }
  const ewById = new Map(((emailWorksheets.error ? [] : emailWorksheets.data ?? []) as Ew[]).map((w) => [w.practice_id, w]))
  // Same rule as saveWorksheet: once transferred, only the receiving closer
  // may edit (the server re-checks on save; this just greys the row out).
  const transferRows = (transfers.data ?? []) as { practice_id: string; to_user_id: string | null }[]
  const transferredToMe = new Set(transferRows.filter((t) => t.to_user_id === me.id).map((t) => t.practice_id))
  const lockedIds = new Set(transferRows.map((t) => t.practice_id).filter((id) => !transferredToMe.has(id)))

  const details: SheetDetail[] = Array.from(byCode.values()).map((p) => {
    const w = wsById.get(p.id)
    const e = ewById.get(p.id)
    return {
      practiceCode: p.practice_code,
      practiceId: p.id,
      phone: p.phone ?? null,
      official: officialFor(p), // ← ADDED
      isEmailLead: p.lead_category === 'Email',
      locked: lockedIds.has(p.id),
      worksheet: w ? {
        callDetails: w.call_details ?? '', additionalPhone: w.additional_phone ?? '', email: w.email ?? '',
        concernedPerson: w.concerned_person ?? '', directLine: w.direct_line ?? '', callbackAt: w.callback_at,
        timezone: w.timezone, disposition: w.disposition ?? 'New',
      } : null,
      emailWorksheet: e ? { email: e.email ?? '', response: e.response ?? '', note: e.note ?? '' } : null,
    }
  })
  return { ok: true, details }
}

export async function forgetSavedLeads(codes: string[]): Promise<{ ok: boolean; overview: LeadOverview | null }> {
  const list = cleanCodes(codes)
  const { data: { user } } = await getCurrentUser()
  if (!user || !list.length) return { ok: false, overview: null }
  const { data: me } = await getCurrentProfile(user.id)
  // Only Agents and Closers lose a lead from their queue when they save it.
  const role = me?.roles?.key ?? ''
  if (role !== 'agent' && role !== 'closer') return { ok: true, overview: null }
  return { ok: true, overview: removeLeadsFromSnapshots(user.id, list) }
}
