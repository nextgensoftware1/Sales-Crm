'use server'

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../lib/supabase-server'
import { providerDisplayName, leadNpi } from '../lib/provider-identity'

const CAN_VIEW = ['company_admin', 'manager', 'team_lead', 'super_admin', 'agent', 'closer']

export type Transfer = {
  id: string
  practiceCode: string | null
  practiceName: string
  /** Real provider name (imported worksheet / provider record), not a "Practice (PR-…)" placeholder. */
  providerName: string | null
  /** 10-digit NPI, when known. */
  npi: string | null
  state: string | null
  specialty: string | null
  isRoster: boolean
  orgName: string | null
  fromUserName: string | null
  toUserName: string | null
  companyName: string | null
  handoffStatus: string | null
  createdAt: string | null
  practiceDeleted: boolean
  wsCallDetails: string | null
  wsAdditionalPhone: string | null
  wsEmail: string | null
  wsConcernedPerson: string | null
  wsDirectLine: string | null
  wsTimezone: string | null
  wsDisposition: string | null
  wsUpdatedAt: string | null
  /** Transfer KPI decision: verified (PKR 500 to the agent) or rejected (no KPI), with the reviewer's note. */
  kpi: { status: 'verified' | 'rejected'; note: string | null; verifiedAt: string; verifiedByName: string | null; amount: number; currency: string } | null
  /** Whether the signed-in user may verify it (same rules as verify_transfer). */
  canVerify: boolean
  /** False until database/transfer-kpi.sql has been run. */
  kpiAvailable: boolean
}

export async function getTransfers(): Promise<{
  ok: boolean; message?: string; transfers?: Transfer[]; scope?: 'all' | 'company' | 'mine'
  allCompanies?: { id: string; name: string }[]
}> {
  const supabase = await createSupabaseServer()

  const { data: { user } } = await getCurrentUser()
  if (!user) return { ok: false, message: 'Not signed in.' }

  const { data: me } = await getCurrentProfile(user.id)
  const roleKey = (me as any)?.roles?.key ?? ''
  if (!CAN_VIEW.includes(roleKey)) return { ok: false, message: 'Not allowed.' }

  const isSuperAdmin = roleKey === 'super_admin'
  const isAgentOrCloser = roleKey === 'agent' || roleKey === 'closer'
  const myTenantId = (me as any)?.tenant_id
  const myUserId = (me as any)?.id
  const scope: 'all' | 'company' | 'mine' = isSuperAdmin ? 'all' : isAgentOrCloser ? 'mine' : 'company'

  let transferQ = supabase
    .from('lead_transfers')
    .select('id, practice_id, tenant_id, from_user_id, to_user_id, note, created_at')
    .order('created_at', { ascending: false })
  if (isAgentOrCloser) {
    transferQ = transferQ.or(`from_user_id.eq.${myUserId},to_user_id.eq.${myUserId}`)
  } else if (!isSuperAdmin) {
    transferQ = transferQ.eq('tenant_id', myTenantId)
  }
  const [{ data: companyTenants }, { data: rows, error }] = await Promise.all([
    isSuperAdmin
      ? supabase.from('tenants').select('id, name').order('name')
      : Promise.resolve({ data: [] }),
    transferQ,
  ])
  const allCompanies: { id: string; name: string }[] | undefined = isSuperAdmin ? (companyTenants ?? []) as any[] : undefined
  if (error) return { ok: false, message: error.message }
  if (!rows || rows.length === 0) return { ok: true, transfers: [], scope, allCompanies }

  const practiceIds = Array.from(new Set(rows.map((r: any) => r.practice_id).filter(Boolean)))
  const userIds = Array.from(new Set([
    ...rows.map((r: any) => r.from_user_id),
    ...rows.map((r: any) => r.to_user_id),
  ].filter(Boolean)))
  const tenantIds = Array.from(new Set(rows.map((r: any) => r.tenant_id).filter(Boolean)))

  // Transfer KPI status for these leads (Row Level Security applies). If the
  // KPI table isn't installed yet, the page simply shows no Verify buttons.
  const kpiQ = supabase.from('transfer_kpi_credits')
    .select('practice_id, tenant_id, verified_at, verified_by_name, amount, currency, status, note')
    .in('practice_id', practiceIds)

  let worksheetQ = supabase.from('lead_worksheets').select(`
    practice_id, tenant_id, call_details, additional_phone, email,
    concerned_person, direct_line, timezone, disposition, updated_at, import_data
  `).in('practice_id', practiceIds)
  if (!isSuperAdmin) worksheetQ = worksheetQ.eq('tenant_id', myTenantId)

  const [{ data: practices }, { data: users }, { data: tenantRows }, { data: worksheets }, kpiResult] = await Promise.all([
    practiceIds.length
      ? supabase.from('master_practices').select(`
          id, practice_code, name, state, specialty, is_roster,
          practice_providers ( providers ( org_name, name, npi ) )
        `).in('id', practiceIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? supabase.from('users').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] }),
    isSuperAdmin ? Promise.resolve({ data: companyTenants ?? [] }) : isAgentOrCloser && tenantIds.length
      ? supabase.from('tenants').select('id, name').in('id', tenantIds)
      : Promise.resolve({ data: [] }),
    worksheetQ,
    kpiQ.then((r) => r, () => ({ data: null, error: { message: 'unavailable' } })),
  ])
  const kpiAvailable = !kpiResult.error
  const kpiByKey = new Map<string, Transfer['kpi']>()
  for (const k of (kpiResult.data ?? []) as any[]) {
    kpiByKey.set(`${k.practice_id}:${k.tenant_id}`, { status: k.status === 'rejected' ? 'rejected' : 'verified', note: k.note ?? null, verifiedAt: k.verified_at, verifiedByName: k.verified_by_name ?? null, amount: Number(k.amount) || 0, currency: k.currency || 'PKR' })
  }
  // Mirrors verify_transfer(): own company; receiving closer, manager or
  // company admin; never your own transfer; not already verified.
  const canVerifyRow = (r: any, kpi: Transfer['kpi']) => kpiAvailable && !kpi
    && !!r.from_user_id && r.from_user_id !== myUserId && r.tenant_id === myTenantId
    && (roleKey === 'company_admin' || roleKey === 'manager' || (roleKey === 'closer' && r.to_user_id === myUserId))

  const practiceById: Record<string, any> = {}
  for (const p of (practices ?? []) as any[]) practiceById[p.id] = p

  const nameByUserId: Record<string, string> = {}
  for (const u of (users ?? []) as any[]) nameByUserId[u.id] = u.full_name

  const nameByTenantId: Record<string, string> = {}
  for (const t of (tenantRows ?? []) as any[]) nameByTenantId[t.id] = t.name
  const worksheetByKey = new Map<string, any>()
  for (const worksheet of (worksheets ?? []) as any[]) {
    worksheetByKey.set(`${worksheet.practice_id}:${worksheet.tenant_id}`, worksheet)
  }

  const transfers: Transfer[] = rows
    .map((r: any) => {
      const p = practiceById[r.practice_id]
      const worksheet = worksheetByKey.get(`${r.practice_id}:${r.tenant_id}`)
      const kpi = kpiByKey.get(`${r.practice_id}:${r.tenant_id}`) ?? null
      const kpiFields = { kpi, canVerify: !!p && canVerifyRow(r, kpi), kpiAvailable }
      if (!p) {
        return {
          id: r.id,
          practiceCode: null,
          practiceName: '(deleted lead)',
          providerName: null,
          npi: null,
          state: null,
          specialty: null,
          isRoster: false,
          orgName: null,
          fromUserName: r.from_user_id ? (nameByUserId[r.from_user_id] ?? null) : null,
          toUserName: r.to_user_id ? (nameByUserId[r.to_user_id] ?? null) : null,
          companyName: (isSuperAdmin || isAgentOrCloser) ? (nameByTenantId[r.tenant_id] ?? null) : null,
          handoffStatus: r.note ?? null,
          createdAt: r.created_at ?? null,
          practiceDeleted: true,
          wsCallDetails: null, wsAdditionalPhone: null, wsEmail: null, wsConcernedPerson: null,
          wsDirectLine: null, wsTimezone: null, wsDisposition: null, wsUpdatedAt: null,
          ...kpiFields,
        }
      }
      return {
        id: r.id,
        practiceCode: p.practice_code,
        practiceName: p.name,
        providerName: providerDisplayName({
          importData: worksheet?.import_data ?? null,
          providerName: p.practice_providers?.[0]?.providers?.name ?? null,
          practiceName: p.name,
          orgName: p.practice_providers?.[0]?.providers?.org_name ?? null,
        }),
        npi: leadNpi(p.practice_providers?.[0]?.providers?.npi ?? null, p.practice_code),
        state: p.state,
        specialty: p.specialty,
        isRoster: !!p.is_roster,
        orgName: p.practice_providers?.[0]?.providers?.org_name ?? null,
        fromUserName: r.from_user_id ? (nameByUserId[r.from_user_id] ?? null) : null,
        toUserName: r.to_user_id ? (nameByUserId[r.to_user_id] ?? null) : null,
        companyName: (isSuperAdmin || isAgentOrCloser) ? (nameByTenantId[r.tenant_id] ?? null) : null,
        handoffStatus: r.note ?? null,
        createdAt: r.created_at ?? null,
        practiceDeleted: false,
        wsCallDetails: worksheet?.call_details ?? null,
        wsAdditionalPhone: worksheet?.additional_phone ?? null,
        wsEmail: worksheet?.email ?? null,
        wsConcernedPerson: worksheet?.concerned_person ?? null,
        wsDirectLine: worksheet?.direct_line ?? null,
        wsTimezone: worksheet?.timezone ?? null,
        wsDisposition: worksheet?.disposition ?? null,
        wsUpdatedAt: worksheet?.updated_at ?? null,
        ...kpiFields,
      }
    })

  return { ok: true, transfers, scope, allCompanies }
}
