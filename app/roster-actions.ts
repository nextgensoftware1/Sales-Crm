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

  return {
    ok: true,
    hasOrg,
    orgName: first?.org_name ?? null,
    members,
  }
}