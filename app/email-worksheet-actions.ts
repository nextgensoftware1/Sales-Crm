'use server'

// ← ADDED (new file) — Email leads: save the email worksheet, and read the
// Email Sheet Report. Permission checks for saving live in the database
// function save_email_worksheet (database/email-leads.sql).

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { EMAIL_RESPONSES, EMAIL_REQUIRED_FOR, EMAIL_RE } from '../lib/email-leads'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function saveEmailWorksheet(input: {
  practiceId: string
  email: string
  response: string
  note: string
}): Promise<{ ok: boolean; message: string }> {
  const practiceId = String(input?.practiceId ?? '')
  const email = String(input?.email ?? '').trim().toLowerCase().slice(0, 254)
  const response = String(input?.response ?? '').trim()
  const note = String(input?.note ?? '').slice(0, 5000)
  if (!UUID.test(practiceId)) return { ok: false, message: 'Invalid lead.' }
  if (!(EMAIL_RESPONSES as readonly string[]).includes(response)) return { ok: false, message: 'Choose a response.' }
  if (!email && (EMAIL_REQUIRED_FOR as readonly string[]).includes(response)) {
    return { ok: false, message: `An email address is required for "${response}".` }
  }
  if (email && !EMAIL_RE.test(email)) return { ok: false, message: 'Enter a valid email address.' }

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }
  const supabase = await createSupabaseServer()
  const { error } = await supabase.rpc('save_email_worksheet', {
    p_practice_id: practiceId, p_email: email || null, p_response: response, p_note: note || null,
  })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return { ok: false, message: 'Email worksheets are not set up yet — run database/email-leads.sql in Supabase.' }
    }
    return { ok: false, message: error.message }
  }
  revalidatePath('/email-reports')
  return { ok: true, message: 'Email worksheet saved.' }
}

export type EmailReportRow = {
  practiceId: string
  tenantId: string
  practiceCode: string
  practiceName: string
  state: string | null
  specialty: string | null
  email: string | null
  response: string
  note: string | null
  agentName: string | null
  companyName: string | null
  updatedAt: string
}

const REPORT_LIMIT = 2000

// Latest email worksheet per lead. Super Admin: every company. Company Admin /
// Manager / Team Lead: their company. Agent / Closer: what they saved.
export async function getEmailReports(): Promise<
  { ok: true; rows: EmailReportRow[]; truncated: boolean; scope: 'all' | 'company' | 'mine' } | { ok: false; message: string }
> {
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }
  const { data: me } = await getCurrentProfile(user.id)
  if (!me || me.status !== 'active') return { ok: false, message: 'User not found.' }
  const roleKey = me.roles?.key ?? ''
  if (!['super_admin', 'company_admin', 'manager', 'team_lead', 'agent', 'closer'].includes(roleKey)) {
    return { ok: false, message: 'You do not have permission to view email reports.' }
  }
  const scope: 'all' | 'company' | 'mine' = roleKey === 'super_admin' ? 'all'
    : roleKey === 'agent' || roleKey === 'closer' ? 'mine' : 'company'

  const supabase = await createSupabaseServer()
  let query = supabase.from('lead_email_worksheets')
    .select('practice_id, tenant_id, email, response, note, updated_at, users(full_name), tenants(name), master_practices!inner(practice_code, name, state, specialty, deleted_at)')
    .is('master_practices.deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(REPORT_LIMIT + 1)
  if (scope === 'company') query = query.eq('tenant_id', me.tenant_id!)
  if (scope === 'mine') query = query.eq('updated_by', me.id)

  const { data, error } = await query
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return { ok: false, message: 'Email reports are not set up yet — run database/email-leads.sql in Supabase.' }
    }
    return { ok: false, message: error.message }
  }
  type Raw = {
    practice_id: string; tenant_id: string; email: string | null; response: string; note: string | null; updated_at: string
    users: { full_name: string | null } | null; tenants: { name: string | null } | null
    master_practices: { practice_code: string; name: string | null; state: string | null; specialty: string | null }
  }
  const all = (data ?? []) as unknown as Raw[]
  return {
    ok: true,
    truncated: all.length > REPORT_LIMIT,
    scope,
    rows: all.slice(0, REPORT_LIMIT).map((r) => ({
      practiceId: r.practice_id,
      tenantId: r.tenant_id,
      practiceCode: r.master_practices.practice_code,
      practiceName: r.master_practices.name ?? r.master_practices.practice_code,
      state: r.master_practices.state,
      specialty: r.master_practices.specialty,
      email: r.email,
      response: r.response,
      note: r.note,
      agentName: r.users?.full_name ?? null,
      companyName: r.tenants?.name ?? null,
      updatedAt: r.updated_at,
    })),
  }
}
