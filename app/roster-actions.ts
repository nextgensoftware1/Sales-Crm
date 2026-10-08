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

  // "Worked By" is company-scoped, so one company's worksheet never labels
  // another company's roster view.
  const codes = members.map((m) => `PR-${m.npi}`)
  if (codes.length) {
    const { data: pracs } = await supabase
      .from('master_practices')
      .select('id, practice_code')
      .in('practice_code', codes)
    const ids = (pracs ?? []).map((p: any) => p.id)
    const { data: worksheets } = ids.length ? await supabase.from('lead_worksheets')
      .select('practice_id, users!lead_worksheets_updated_by_fkey(full_name)')
      .in('practice_id', ids).order('updated_at', { ascending: false }) : { data: [] }
    const nameByPractice = new Map<string, string | null>()
    for (const worksheet of (worksheets ?? []) as any[]) {
      if (!nameByPractice.has(worksheet.practice_id)) {
        nameByPractice.set(worksheet.practice_id, worksheet.users?.full_name ?? null)
      }
    }
    const workedByCode: Record<string, string | null> = {}
    for (const p of (pracs ?? []) as any[]) {
      workedByCode[p.practice_code] = nameByPractice.get(p.id) ?? null
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
