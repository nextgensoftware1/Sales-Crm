'use server'

// Dashboard "Worksheets & Transfers" overview: how many worksheets were saved
// (call worksheets AND email worksheets from Active Email — ← CHANGED),
// how many leads were transferred (and how they were reviewed), the Call
// Disposition breakdown, and the same numbers per agent.
//
// Scope (same as the rest of the Dashboard, and Row Level Security applies):
//   Super Admin → every company (optional company filter)
//   Company Admin / Manager / Team Lead → their company (optional agent filter)
//   Agent / Closer → only their own work
// Every query is paged, so counts are complete (no 1,000-row cut-off).

import { createSupabaseServer, getCurrentUser, getCurrentProfile } from '../../lib/supabase-server'
import { allRows } from '../../lib/practice-navigation'
import { rangeBounds } from '../../lib/date-range'

export type OverviewAgentRow = {
  id: string
  name: string
  company: string | null
  worksheets: number
  transfers: number
  verified: number
  rejected: number
  /** Worksheets per disposition for this agent (for the disposition sub-filter). */
  dispositions: Record<string, number>
  /** ← ADDED: email leads worked (Active Email) and their responses. */
  emails: number
  emailResponses: Record<string, number>
}

export type WorkOverview = {
  ok: boolean
  message?: string
  scope: 'own' | 'team' | 'all'
  worksheets: number
  transfers: number
  verified: number
  rejected: number
  pending: number
  kpiAvailable: boolean
  dispositions: { name: string; count: number }[]
  /** ← ADDED: email leads worked in the range (latest per lead) + responses. */
  emailWorksheets: number
  emailResponses: { name: string; count: number }[]
  handoff: { name: string; count: number }[]
  agents: OverviewAgentRow[]
  companies: { id: string; name: string }[]
  /** People for the Agent filter (team: my company; Super Admin: the chosen company). */
  people: { id: string; name: string }[]
}

const empty = (scope: WorkOverview['scope'], message?: string): WorkOverview => ({
  ok: !message, message, scope, worksheets: 0, transfers: 0, verified: 0, rejected: 0, pending: 0,
  kpiAvailable: true, dispositions: [], emailWorksheets: 0, emailResponses: [], handoff: [], agents: [], companies: [], people: [],
})

export async function getWorkOverview(input: { from: string; to: string; companyId?: string; agentId?: string }): Promise<WorkOverview> {
  const { data: { user } } = await getCurrentUser()
  if (!user) return empty('own', 'Not signed in.')
  const { data: me } = await getCurrentProfile(user.id)
  const roleKey = (me as { roles?: { key?: string } } | null)?.roles?.key ?? ''
  const myId = (me as { id?: string } | null)?.id ?? ''
  const myTenantId = (me as { tenant_id?: string | null } | null)?.tenant_id ?? null
  const scope: WorkOverview['scope'] = roleKey === 'super_admin' ? 'all'
    : ['company_admin', 'manager', 'team_lead'].includes(roleKey) ? 'team' : 'own'

  // Plain dates or exact date + time moments (see lib/date-range.ts).
  const bounds = rangeBounds(input?.from, input?.to)
  if (!bounds) return empty(scope, 'Choose a valid date range.')
  const { fromISO, toISO } = bounds
  const companyId = scope === 'all' && typeof input.companyId === 'string' && input.companyId ? input.companyId : ''
  const agentId = scope !== 'own' && typeof input.agentId === 'string' && input.agentId ? input.agentId : ''

  const supabase = await createSupabaseServer()

  // ---- worksheets saved in the range (latest saved worksheet per lead) ----
  type Ws = { practice_id: string; tenant_id: string; updated_by: string | null; disposition: string | null }
  type Tr = { id: string; practice_id: string; tenant_id: string; from_user_id: string | null; to_user_id: string | null; note: string | null }
  const worksheetQuery = () => {
    let q = supabase.from('lead_worksheets').select('practice_id, tenant_id, updated_by, disposition')
      .gte('updated_at', fromISO).lte('updated_at', toISO)
    if (scope === 'own') q = q.eq('updated_by', myId)
    if (scope === 'team') q = q.eq('tenant_id', myTenantId ?? '')
    if (companyId) q = q.eq('tenant_id', companyId)
    if (agentId) q = q.eq('updated_by', agentId)
    return q.order('practice_id').order('tenant_id')
  }
  // ---- transfers made in the range ----
  const transferQuery = () => {
    let q = supabase.from('lead_transfers').select('id, practice_id, tenant_id, from_user_id, to_user_id, note')
      .gte('created_at', fromISO).lte('created_at', toISO)
    if (scope === 'own') q = q.or(`from_user_id.eq.${myId},to_user_id.eq.${myId}`)
    if (scope === 'team') q = q.eq('tenant_id', myTenantId ?? '')
    if (companyId) q = q.eq('tenant_id', companyId)
    if (agentId) q = q.eq('from_user_id', agentId)
    return q.order('id')
  }

  // ← ADDED: email worksheets saved in the range (latest per email lead,
  // same idea as call worksheets above). Same scope + company/agent filters.
  type Em = { practice_id: string; tenant_id: string; updated_by: string | null; response: string | null }
  const emailQuery = () => {
    let q = supabase.from('lead_email_worksheets').select('practice_id, tenant_id, updated_by, response')
      .gte('updated_at', fromISO).lte('updated_at', toISO)
    if (scope === 'own') q = q.eq('updated_by', myId)
    if (scope === 'team') q = q.eq('tenant_id', myTenantId ?? '')
    if (companyId) q = q.eq('tenant_id', companyId)
    if (agentId) q = q.eq('updated_by', agentId)
    return q.order('practice_id').order('tenant_id')
  }
  // If the email tables aren't installed, the dashboard still works (0 emails).
  const emailRows = allRows<Em>(emailQuery as never).catch((e: { code?: string }) =>
    e?.code === '42P01' || e?.code === 'PGRST205' ? [] as Em[] : Promise.reject(e))

  let worksheets: Ws[], transfers: Tr[], emails: Em[] // ← CHANGED: + emails
  try {
    [worksheets, transfers, emails] = await Promise.all([allRows<Ws>(worksheetQuery as never), allRows<Tr>(transferQuery as never), emailRows])
  } catch (error) {
    return empty(scope, error instanceof Error ? error.message : 'Could not load the overview.')
  }

  // ---- KPI review status of those transfers (if the KPI SQL is installed) ----
  const reviewByTransfer = new Map<string, 'verified' | 'rejected'>()
  let kpiAvailable = true
  if (transfers.length) {
    const ids = transfers.map((t) => t.id)
    for (let i = 0; i < ids.length && kpiAvailable; i += 300) {
      const { data, error } = await supabase.from('transfer_kpi_credits').select('transfer_id, status').in('transfer_id', ids.slice(i, i + 300))
      if (error) { kpiAvailable = false; break }
      for (const r of (data ?? []) as { transfer_id: string; status: string | null }[]) {
        reviewByTransfer.set(r.transfer_id, r.status === 'rejected' ? 'rejected' : 'verified')
      }
    }
  }

  // ---- names ----
  // ← CHANGED: email agents are named too
  const userIds = Array.from(new Set([...worksheets.map((w) => w.updated_by), ...transfers.map((t) => t.from_user_id), ...emails.map((e) => e.updated_by)].filter(Boolean))) as string[]
  const tenantIds = Array.from(new Set([...worksheets.map((w) => w.tenant_id), ...transfers.map((t) => t.tenant_id), ...emails.map((e) => e.tenant_id)].filter(Boolean)))
  const names = new Map<string, string>()
  const userTenant = new Map<string, string | null>()
  for (let i = 0; i < userIds.length; i += 300) {
    const { data } = await supabase.from('users').select('id, full_name, tenant_id').in('id', userIds.slice(i, i + 300))
    for (const u of (data ?? []) as { id: string; full_name: string | null; tenant_id: string | null }[]) {
      names.set(u.id, u.full_name ?? 'Unknown'); userTenant.set(u.id, u.tenant_id)
    }
  }
  const tenantNames = new Map<string, string>()
  if (scope === 'all') {
    const { data } = await supabase.from('tenants').select('id, name').eq('is_platform', false).order('name')
    for (const t of (data ?? []) as { id: string; name: string }[]) tenantNames.set(t.id, t.name)
  } else if (tenantIds.length) {
    const { data } = await supabase.from('tenants').select('id, name').in('id', tenantIds)
    for (const t of (data ?? []) as { id: string; name: string }[]) tenantNames.set(t.id, t.name)
  }

  // ---- people for the Agent filter ----
  const peopleTenant = scope === 'team' ? myTenantId : companyId || null
  let people: { id: string; name: string }[] = []
  if (scope !== 'own' && peopleTenant) {
    // ← CHANGED: active people only (deleted users' work still counts above)
    const { data } = await supabase.from('users').select('id, full_name').eq('tenant_id', peopleTenant).eq('status', 'active').order('full_name')
    people = ((data ?? []) as { id: string; full_name: string | null }[]).map((u) => ({ id: u.id, name: u.full_name ?? 'Unknown' }))
  }

  // ---- aggregate ----
  const dispositionCounts = new Map<string, number>()
  const handoffCounts = new Map<string, number>()
  const agents = new Map<string, OverviewAgentRow>()
  const agentRow = (id: string | null) => {
    const key = id ?? 'unknown'
    let row = agents.get(key)
    if (!row) {
      const tenant = id ? userTenant.get(id) ?? null : null
      row = { id: key, name: id ? names.get(id) ?? 'Unknown' : 'Unknown', company: tenant ? tenantNames.get(tenant) ?? null : null,
        worksheets: 0, transfers: 0, verified: 0, rejected: 0, dispositions: {}, emails: 0, emailResponses: {} } // ← CHANGED
      agents.set(key, row)
    }
    return row
  }
  for (const w of worksheets) {
    const d = (w.disposition ?? '').trim() || 'No disposition'
    dispositionCounts.set(d, (dispositionCounts.get(d) ?? 0) + 1)
    const row = agentRow(w.updated_by)
    row.worksheets += 1
    row.dispositions[d] = (row.dispositions[d] ?? 0) + 1
  }
  // ← ADDED: email responses, overall and per agent
  const emailResponseCounts = new Map<string, number>()
  for (const e of emails) {
    const r = (e.response ?? '').trim() || 'No response'
    emailResponseCounts.set(r, (emailResponseCounts.get(r) ?? 0) + 1)
    const row = agentRow(e.updated_by)
    row.emails += 1
    row.emailResponses[r] = (row.emailResponses[r] ?? 0) + 1
  }
  let verified = 0, rejected = 0
  for (const t of transfers) {
    const h = (t.note ?? '').trim() || 'No status'
    handoffCounts.set(h, (handoffCounts.get(h) ?? 0) + 1)
    const row = agentRow(t.from_user_id)
    row.transfers += 1
    const review = reviewByTransfer.get(t.id)
    if (review === 'verified') { verified += 1; row.verified += 1 }
    if (review === 'rejected') { rejected += 1; row.rejected += 1 }
  }
  const sorted = (m: Map<string, number>) => Array.from(m, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return {
    ok: true, scope,
    worksheets: worksheets.length, transfers: transfers.length, verified, rejected,
    pending: transfers.length - verified - rejected, kpiAvailable,
    dispositions: sorted(dispositionCounts), handoff: sorted(handoffCounts),
    emailWorksheets: emails.length, emailResponses: sorted(emailResponseCounts), // ← ADDED
    // ← CHANGED: email work counts toward the agent's ranking too
    agents: scope === 'own' ? [] : Array.from(agents.values()).sort((a, b) => b.worksheets + b.emails + b.transfers - (a.worksheets + a.emails + a.transfers) || a.name.localeCompare(b.name)),
    companies: Array.from(tenantNames, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    people,
  }
}
