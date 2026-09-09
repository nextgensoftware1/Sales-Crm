'use server'

import { createSupabaseServer } from '../lib/supabase-server'

// Everyone above the agent can view this: admin, manager, team_lead, super_admin.
const CAN_VIEW = ['company_admin', 'manager', 'team_lead', 'super_admin']

type Lead = { practiceCode: string; name: string; state: string | null; specialty: string | null; assignedBy: string | null; assignedAt: string | null }
type AgentGroup = { agentId: string; agentName: string; role: string; leads: Lead[] }

// Returns every agent (and closer) in the caller's company with the leads
// assigned to them. Super Admin sees all companies' agents.
export async function getAgentAssignedLeads(): Promise<{
  ok: boolean; message?: string; groups?: AgentGroup[]
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
  const myTenantId = (me as any)?.tenant_id

  // Find agents/closers in scope.
  let usersQ = supabase.from('users').select('id, full_name, tenant_id, roles(key, label)')
  if (!isSuperAdmin) usersQ = usersQ.eq('tenant_id', myTenantId)
  const { data: people } = await usersQ
  const agents = (people ?? []).filter((u: any) => ['agent', 'closer'].includes(u.roles?.key))
  if (agents.length === 0) return { ok: true, groups: [] }

  const agentIds = agents.map((a: any) => a.id)

  // All active assignments to those agents.
  const { data: assigns } = await supabase
    .from('lead_assignments')
    .select('assigned_to, assigned_at, practice_id, master_practices(practice_code, name, state, specialty), assigned_by')
    .in('assigned_to', agentIds)
    .eq('status', 'active')

  // Look up assigner names.
  const assignerIds = Array.from(new Set((assigns ?? []).map((a: any) => a.assigned_by).filter(Boolean)))
  const nameById: Record<string, string> = {}
  if (assignerIds.length) {
    const { data: assigners } = await supabase.from('users').select('id, full_name').in('id', assignerIds)
    for (const u of (assigners ?? []) as any[]) nameById[u.id] = u.full_name
  }

  // Group by agent.
  const groups: AgentGroup[] = agents.map((a: any) => {
    const leads: Lead[] = (assigns ?? [])
      .filter((r: any) => r.assigned_to === a.id)
      .map((r: any) => ({
        practiceCode: r.master_practices?.practice_code,
        name: r.master_practices?.name ?? '',
        state: r.master_practices?.state ?? null,
        specialty: r.master_practices?.specialty ?? null,
        assignedBy: r.assigned_by ? (nameById[r.assigned_by] ?? null) : null,
        assignedAt: r.assigned_at ?? null,
      }))
      .filter((l: Lead) => l.practiceCode)
      .sort((x: Lead, y: Lead) => x.name.localeCompare(y.name))
    return {
      agentId: a.id,
      agentName: a.full_name,
      role: a.roles?.label ?? a.roles?.key,
      leads,
    }
  })

  return { ok: true, groups }
}