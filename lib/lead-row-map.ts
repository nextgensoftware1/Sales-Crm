import { roleLabel } from './roles'

// Builds one Lead Pool row from a lead read by crm_lead_rows / crm_lead_rows_flat
// (decoded). Moved here unchanged from lib/leads-data.ts so the full lead load
// and the database-paged Lead Pool (lib/lead-db-paging.ts) build rows with
// exactly the same code.
export type LeadRowMapContext = {
  canAssign: boolean
  allocatedOn: Record<string, string>
  leadStatus: Record<string, string>
  lastDialed: Record<string, string>
  allocatedCodeSet: Set<string>
  allocatedCompanyByCode: Record<string, { id: string; name: string }[]>
  emailLeadIds: Set<string>
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapLeadRow(p: any, ctx: LeadRowMapContext) {
  const { canAssign, allocatedOn, leadStatus, lastDialed, allocatedCodeSet, allocatedCompanyByCode, emailLeadIds } = ctx
  const provider = p.practice_providers?.[0]?.providers
  const s = provider?.provider_signals ?? {}
  const assignedAwayRows: {
    assigned_at?: string | null
    users?: { full_name: string | null; roles?: { key: string | null } | null } | null
  }[] = Array.isArray(p.assigned_away) ? p.assigned_away : []
  const latestAssignedAway = assignedAwayRows.reduce<(typeof assignedAwayRows)[number] | null>((latest, assignment) =>
    !latest || String(assignment.assigned_at ?? '') > String(latest.assigned_at ?? '') ? assignment : latest, null)
  const mipsRows = Array.isArray(provider?.provider_mips) ? provider.provider_mips : []
  // Both "NPPES - Found" and "NPPES - Not Found" count as having
  // credentialing data — only a genuinely blank Record_Source (no NPPES
  // lookup attempted at all) is excluded from the Credentialing filter.
  // Only a confirmed NPPES match counts as Credentialing — "Not Found"
  // (and blank) are excluded. "NPPES - Not Found" contains the substring
  // "found" too, so it must be checked for explicitly rather than a
  // plain .includes('found').
  const recordSourceLower = (provider?.record_source ?? '').toString().trim().toLowerCase()
  const npiFound = recordSourceLower.includes('found') && !recordSourceLower.includes('not found')
  const mipsByYear: Record<number, string> = {}
  for (const m of mipsRows) {
    const raw = (m.reporting_option ?? m.status ?? '').toString().trim()
    let year = m.performance_year
    if (!year) {
      const match = raw.match(/^(\d{4})/)
      if (match) year = parseInt(match[1], 10)
    }
    if (year) {
      const statusText = raw.replace(/^\d{4}\s*-\s*/, '')
      mipsByYear[year] = statusText || raw
    }
  }

  return {
    practiceCode: p.practice_code,
    allocatedOn: (canAssign ? latestAssignedAway?.assigned_at : null) ?? allocatedOn[p.id] ?? null,
    // allocationDatesByPractice is not used by PracticesTable yet; sending it
    // for every lead only made the page payload bigger. Add it back here
    // (allocationDates: allocationDatesByPractice[p.id] ?? []) when the table needs it.
    status: leadStatus[p.id] ?? null,
    assignedAwayTo: canAssign && latestAssignedAway?.users
      ? { name: latestAssignedAway.users.full_name ?? '', role: roleLabel(latestAssignedAway.users.roles?.key) }
      : null,
    source: allocatedCodeSet.has(p.practice_code) ? 'Allocated' : 'Uploaded',
    allocatedTo: allocatedCompanyByCode[p.practice_code]?.map(company => company.name).join(', ') ?? null,
    allocatedCompanies: allocatedCompanyByCode[p.practice_code] ?? [],
    name: p.name,
    state: p.state,
    specialty: p.specialty,
    sex: provider?.nppes_sex ?? null,
    orgName: provider?.org_name ?? null,
    risk: provider?.at_risk ?? null,
    npiFound,
    isEmailLead: emailLeadIds.has(p.id), // ← ADDED
    entityType: provider?.entity_type ?? null,
    enumerationDate: provider?.enumeration_date ?? null,
    lastUpdated: provider?.nppes_last_updated ?? null,
    paymentAdj: provider?.payment_adj_pct ?? null,
    lastDialed: lastDialed[p.id] ?? null,
    ccm: s.ccm ?? false,
    pcm: s.pcm ?? false,
    awv: s.awv ?? false,
    tcm: s.tcm ?? false,
    bhi: s.bhi ?? false,
    rpm: s.rpm ?? false,
    rcmFit: s.rcm_fit ?? false,
    mipsByYear,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type MappedLeadRow = ReturnType<typeof mapLeadRow>
