// 'use server'

// import { createSupabaseServer } from '../lib/supabase-server'

// export type RosterMember = {
//   npi: string
//   name: string
//   specialty: string | null
//   city: string | null
//   state: string | null
//   mips: string | null
//   is_clicked: boolean
//   org_pac_id: string | null
//   org_name: string | null
//   num_org_members: number | null
// }

// // Given one clicked NPI, return the full org roster (clicked clinician first).
// // Returns hasOrg=false when the clinician is solo (no Org_PAC_ID).
// export async function getOrgRoster(clickedNpi: string): Promise<{
//   ok: boolean
//   message?: string
//   hasOrg: boolean
//   orgName: string | null
//   members: RosterMember[]
// }> {
//   const supabase = await createSupabaseServer()

//   const { data, error } = await supabase.rpc('get_org_roster', { clicked_npi: clickedNpi })
//   if (error) {
//     return { ok: false, message: error.message, hasOrg: false, orgName: null, members: [] }
//   }

//   const members = (data ?? []) as RosterMember[]
//   const first = members[0]
//   const hasOrg = !!(first?.org_pac_id && members.length > 1)

//   return {
//     ok: true,
//     hasOrg,
//     orgName: first?.org_name ?? null,
//     members,
//   }
// }
'use server'

import { createSupabaseServer } from '../lib/supabase-server'

export type RosterMember = {
  npi: string
  name: string
  specialty: string | null
  city: string | null
  state: string | null
  mips: string | null
  is_clicked: boolean
  org_pac_id: string | null
  org_name: string | null
  num_org_members: number | null
  workedBy?: string | null
}

// Given one clicked NPI, return the full org roster (clicked clinician first).
// Returns hasOrg=false when the clinician is solo (no Org_PAC_ID).
export async function getOrgRoster(clickedNpi: string): Promise<{
  ok: boolean
  message?: string
  hasOrg: boolean
  orgName: string | null
  members: RosterMember[]
}> {
  const supabase = await createSupabaseServer()

  const { data, error } = await supabase.rpc('get_org_roster', { clicked_npi: clickedNpi })
  if (error) {
    return { ok: false, message: error.message, hasOrg: false, orgName: null, members: [] }
  }

  const members = (data ?? []) as RosterMember[]
  const first = members[0]
  const hasOrg = !!(first?.org_pac_id && members.length > 1)

  // "Worked By" — the person who last saved each member's Worksheet.
  // Each roster member's NPI → its practice (PR-<npi>) → ws_updated_by → name.
  const codes = members.map((m) => `PR-${m.npi}`)
  if (codes.length) {
    const { data: pracs } = await supabase
      .from('master_practices')
      .select('practice_code, ws_updated_by')
      .in('practice_code', codes)
    const editorIds = Array.from(new Set((pracs ?? []).map((p: any) => p.ws_updated_by).filter(Boolean)))
    const nameById: Record<string, string> = {}
    if (editorIds.length) {
      const { data: users } = await supabase.from('users').select('id, full_name').in('id', editorIds)
      for (const u of (users ?? []) as any[]) nameById[u.id] = u.full_name
    }
    const workedByCode: Record<string, string | null> = {}
    for (const p of (pracs ?? []) as any[]) {
      workedByCode[p.practice_code] = p.ws_updated_by ? (nameById[p.ws_updated_by] ?? null) : null
    }
    for (const m of members) {
      m.workedBy = workedByCode[`PR-${m.npi}`] ?? null
    }
  }

  return {
    ok: true,
    hasOrg,
    orgName: first?.org_name ?? null,
    members,
  }
}