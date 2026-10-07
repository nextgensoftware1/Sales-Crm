'use server'

// Transfer KPI: an agent earns PKR 500 for each lead they transferred that the
// receiving closer, a manager or a company admin verifies. All rules are
// enforced in the database (database/transfer-kpi.sql → verify_transfer).

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'

export type KpiCredit = {
  agentId: string | null
  agentName: string | null
  amount: number
  currency: string
  verifiedAt: string
  practiceCode: string | null
  practiceName: string | null
  verifiedByName: string | null
  /** 'verified' (counts as KPI) or 'rejected' (PKR 0, no KPI). */
  status: 'verified' | 'rejected'
  /** The reviewer's note explaining the decision. */
  note: string | null
  /** Company of the credit (shown to Super Admin, who sees every company). */
  tenantId: string | null
  companyName: string | null
}

const TEAM_ROLES = ['super_admin', 'company_admin', 'manager', 'team_lead']

/** True when the KPI table/function hasn't been installed yet. */
function isMissing(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code ?? '')
    || /does not exist|could not find/i.test(error.message ?? '')
}

export type KpiDecision = { status: 'verified' | 'rejected'; note: string | null; verifiedAt: string; verifiedByName: string | null; amount: number; currency: string }

/**
 * Verify (PKR 500 to the transferring agent) or reject (no KPI) a transfer,
 * with a required note explaining the decision. One decision per lead.
 */
export async function verifyTransfer(transferId: string, decision: 'verified' | 'rejected', note: string): Promise<{
  ok: boolean; message: string; kpi?: KpiDecision
}> {
  if (!transferId || typeof transferId !== 'string') return { ok: false, message: 'Choose a transfer to review.' }
  if (decision !== 'verified' && decision !== 'rejected') return { ok: false, message: 'Choose Verify or Reject.' }
  const cleanNote = String(note ?? '').trim()
  if (cleanNote.length < 3) return { ok: false, message: 'Please add a note explaining your decision.' }
  if (cleanNote.length > 1000) return { ok: false, message: 'The note is too long (1000 characters max).' }
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }
  const supabase = await createSupabaseServer()

  const { data, error } = await supabase.rpc('verify_transfer', { p_transfer_id: transferId, p_decision: decision, p_note: cleanNote })
  if (error) {
    if (isMissing(error)) return { ok: false, message: 'Transfer KPI needs a database update. Run database/transfer-kpi-v2.sql in Supabase.' }
    return { ok: false, message: error.message || 'Could not save your decision.' }
  }
  const result = (data ?? {}) as { decided?: boolean; status?: string }

  const { data: credit } = await supabase.from('transfer_kpi_credits')
    .select('agent_name, amount, currency, verified_at, verified_by_name, status, note')
    .eq('transfer_id', transferId).maybeSingle()
  const c = credit as { agent_name: string | null; amount: number; currency: string; verified_at: string; verified_by_name: string | null; status: string; note: string | null } | null
  const kpi: KpiDecision | undefined = c ? {
    status: c.status === 'rejected' ? 'rejected' : 'verified', note: c.note ?? null, verifiedAt: c.verified_at,
    verifiedByName: c.verified_by_name, amount: Number(c.amount), currency: c.currency,
  } : undefined

  if (!result.decided) {
    return { ok: true, message: `This transfer was already ${result.status === 'rejected' ? 'rejected' : 'verified'} earlier, so nothing changed.`, kpi }
  }
  return {
    ok: true,
    message: result.status === 'rejected'
      ? 'Transfer rejected — no KPI was added.'
      : `Verified — PKR ${Number(c?.amount ?? 500).toLocaleString()} added to ${c?.agent_name ?? 'the agent'}'s KPI.`,
    kpi,
  }
}

export async function getTransferKpi(): Promise<{
  ok: boolean; message?: string; available: boolean; scope: 'own' | 'team'; credits: KpiCredit[]; isSuperAdmin: boolean
}> {
  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.', available: false, scope: 'own', credits: [], isSuperAdmin: false }
  const { data: me } = await getCurrentProfile(user.id)
  const roleKey = (me as { roles?: { key?: string } } | null)?.roles?.key ?? ''
  const myId = (me as { id?: string } | null)?.id
  const scope: 'own' | 'team' = TEAM_ROLES.includes(roleKey) ? 'team' : 'own'
  const isSuperAdmin = roleKey === 'super_admin'
  const supabase = await createSupabaseServer()

  // Row Level Security limits rows to what this user may see; "own" scope
  // (agents, closers) shows only the user's own earnings.
  let query = supabase.from('transfer_kpi_credits')
    .select('agent_id, agent_name, amount, currency, verified_at, practice_code, practice_name, verified_by_name, tenant_id, status, note')
    .order('verified_at', { ascending: false })
    .limit(5000)
  if (scope === 'own') query = query.eq('agent_id', myId ?? '')
  const { data, error } = await query
  if (error) {
    if (isMissing(error)) return { ok: true, available: false, scope, credits: [], isSuperAdmin }
    return { ok: false, message: error.message, available: true, scope, credits: [], isSuperAdmin }
  }
  // Company names (only needed for Super Admin, who sees every company).
  const nameByTenant = new Map<string, string>()
  if (isSuperAdmin) {
    const tenantIds = Array.from(new Set(((data ?? []) as { tenant_id?: string }[]).map((r) => r.tenant_id).filter(Boolean))) as string[]
    if (tenantIds.length) {
      const { data: tenants } = await supabase.from('tenants').select('id, name').in('id', tenantIds)
      for (const t of (tenants ?? []) as { id: string; name: string }[]) nameByTenant.set(t.id, t.name)
    }
  }
  const credits: KpiCredit[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    agentId: (r.agent_id as string | null) ?? null,
    agentName: (r.agent_name as string | null) ?? null,
    amount: Number(r.amount) || 0,
    currency: (r.currency as string) || 'PKR',
    verifiedAt: r.verified_at as string,
    practiceCode: (r.practice_code as string | null) ?? null,
    practiceName: (r.practice_name as string | null) ?? null,
    verifiedByName: (r.verified_by_name as string | null) ?? null,
    status: r.status === 'rejected' ? 'rejected' : 'verified',
    note: (r.note as string | null) ?? null,
    tenantId: (r.tenant_id as string | null) ?? null,
    companyName: r.tenant_id ? nameByTenant.get(r.tenant_id as string) ?? null : null,
  }))
  return { ok: true, available: true, scope, credits, isSuperAdmin }
}
