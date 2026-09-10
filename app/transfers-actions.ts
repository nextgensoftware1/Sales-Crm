'use server'

import { createSupabaseServer } from '../lib/supabase-server'

// Everyone signed in can view transfers now — scope differs by role:
//   super_admin: every company's transfers
//   company_admin / manager / team_lead: their own company's transfers
//   agent / closer: only transfers they made or received themselves
const CAN_VIEW = ['company_admin', 'manager', 'team_lead', 'super_admin', 'agent', 'closer']

export type Transfer = {
  id: string
  practiceCode: string | null
  practiceName: string
  state: string | null
  specialty: string | null
  fromUserName: string | null
  toUserName: string | null
  companyName: string | null
  handoffStatus: string | null
  createdAt: string | null
  // True when the underlying lead has since been permanently deleted — the
  // transfer record itself is kept for audit history, but there's no live
  // practice to link to or worksheet to show.
  practiceDeleted: boolean
  // Worksheet snapshot — the full call record for this lead, so whoever is
  // reviewing the transfer can see exactly what was filled in, not just the
  // handoff status. This is the practice's current worksheet (the same
  // fields shown on the practice detail page), not a separate history log.
  wsCallDetails: string | null
  wsAdditionalPhone: string | null
  wsEmail: string | null
  wsConcernedPerson: string | null
  wsDirectLine: string | null
  wsTimezone: string | null
  wsDisposition: string | null
  wsUpdatedAt: string | null
}

export async function getTransfers(): Promise<{
  ok: boolean; message?: string; transfers?: Transfer[]; scope?: 'all' | 'company' | 'mine'
}> {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await supabase
    .from('users')
    .select('id, tenant_id, roles(key)')
    .eq('auth_id', user.id)
    .single()
  const roleKey = (me as any)?.roles?.key ?? ''
  if (!CAN_VIEW.includes(roleKey)) return { ok: false, message: 'Not allowed.' }

  const isSuperAdmin = roleKey === 'super_admin'
  const isAgentOrCloser = roleKey === 'agent' || roleKey === 'closer'
  const myTenantId = (me as any)?.tenant_id
  const myUserId = (me as any)?.id
  const scope: 'all' | 'company' | 'mine' = isSuperAdmin ? 'all' : isAgentOrCloser ? 'mine' : 'company'

  // Base transfer rows, scoped per role.
  let transferQ = supabase
    .from('lead_transfers')
    .select('id, practice_id, tenant_id, from_user_id, to_user_id, note, created_at')
    .order('created_at', { ascending: false })
  if (isAgentOrCloser) {
    transferQ = transferQ.or(`from_user_id.eq.${myUserId},to_user_id.eq.${myUserId}`)
  } else if (!isSuperAdmin) {
    transferQ = transferQ.eq('tenant_id', myTenantId)
  }
  const { data: rows, error } = await transferQ
  if (error) return { ok: false, message: error.message }
  if (!rows || rows.length === 0) return { ok: true, transfers: [], scope }

  // Batch-resolve practice (incl. worksheet fields), user, and tenant names —
  // same pattern as getAgentAssignedLeads: separate lookups by collected IDs.
  const practiceIds = Array.from(new Set(rows.map((r: any) => r.practice_id).filter(Boolean)))
  const userIds = Array.from(new Set([
    ...rows.map((r: any) => r.from_user_id),
    ...rows.map((r: any) => r.to_user_id),
  ].filter(Boolean)))
  const tenantIds = Array.from(new Set(rows.map((r: any) => r.tenant_id).filter(Boolean)))

  const practiceById: Record<string, any> = {}
  if (practiceIds.length) {
    const { data: practices } = await supabase
      .from('master_practices')
      .select(`
        id, practice_code, name, state, specialty,
        ws_call_details, ws_additional_phone, ws_email, ws_concerned_person,
        ws_direct_line, ws_timezone, ws_disposition, ws_updated_at
      `)
      .in('id', practiceIds)
    for (const p of (practices ?? []) as any[]) practiceById[p.id] = p
  }

  const nameByUserId: Record<string, string> = {}
  if (userIds.length) {
    const { data: users } = await supabase.from('users').select('id, full_name').in('id', userIds)
    for (const u of (users ?? []) as any[]) nameByUserId[u.id] = u.full_name
  }

  const nameByTenantId: Record<string, string> = {}
  if ((isSuperAdmin || isAgentOrCloser) && tenantIds.length) {
    const { data: tenants } = await supabase.from('tenants').select('id, name').in('id', tenantIds)
    for (const t of (tenants ?? []) as any[]) nameByTenantId[t.id] = t.name
  }

  const transfers: Transfer[] = rows
    .map((r: any) => {
      const p = practiceById[r.practice_id]
      // Keep the transfer record even if the underlying lead has since been
      // permanently deleted — it's still real history of who handed off
      // what to whom, it just has nothing live to link to or show anymore.
      if (!p) {
        return {
          id: r.id,
          practiceCode: null,
          practiceName: '(deleted lead)',
          state: null,
          specialty: null,
          fromUserName: r.from_user_id ? (nameByUserId[r.from_user_id] ?? null) : null,
          toUserName: r.to_user_id ? (nameByUserId[r.to_user_id] ?? null) : null,
          companyName: (isSuperAdmin || isAgentOrCloser) ? (nameByTenantId[r.tenant_id] ?? null) : null,
          handoffStatus: r.note ?? null,
          createdAt: r.created_at ?? null,
          practiceDeleted: true,
          wsCallDetails: null, wsAdditionalPhone: null, wsEmail: null, wsConcernedPerson: null,
          wsDirectLine: null, wsTimezone: null, wsDisposition: null, wsUpdatedAt: null,
        }
      }
      return {
        id: r.id,
        practiceCode: p.practice_code,
        practiceName: p.name,
        state: p.state,
        specialty: p.specialty,
        fromUserName: r.from_user_id ? (nameByUserId[r.from_user_id] ?? null) : null,
        toUserName: r.to_user_id ? (nameByUserId[r.to_user_id] ?? null) : null,
        // Company name is useful whenever the view spans more than one
        // company — Super Admin always, and agent/closer since a closer may
        // receive transfers that originated at a different company.
        companyName: (isSuperAdmin || isAgentOrCloser) ? (nameByTenantId[r.tenant_id] ?? null) : null,
        handoffStatus: r.note ?? null,
        createdAt: r.created_at ?? null,
        practiceDeleted: false,
        wsCallDetails: p.ws_call_details ?? null,
        wsAdditionalPhone: p.ws_additional_phone ?? null,
        wsEmail: p.ws_email ?? null,
        wsConcernedPerson: p.ws_concerned_person ?? null,
        wsDirectLine: p.ws_direct_line ?? null,
        wsTimezone: p.ws_timezone ?? null,
        wsDisposition: p.ws_disposition ?? null,
        wsUpdatedAt: p.ws_updated_at ?? null,
      }
    })

  return { ok: true, transfers, scope }
}

