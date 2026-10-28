import { loadLeadsData } from './leads-data'
import { DEFAULT_LEAD_FILTERS, filterLeads, type LeadRow } from './lead-filters'

export async function getNotWorkedLeadNavigation(userId: string): Promise<string[] | null> {
  const data = await loadLeadsData()
  if (data.kind !== 'ok' || data.authUserId !== userId) return null

  return filterLeads(data.practices as LeadRow[], {
    ...DEFAULT_LEAD_FILTERS,
    poolTab: 'Not Worked Leads',
  }, {
    isSuperAdmin: data.isSuperAdmin,
    prioritySet: new Set(data.myAssignedCodes),
    newLeadSet: new Set(data.newLeadCodes),
    workedLeadSet: new Set(data.workedLeadCodes),
  }).map((practice) => practice.practiceCode)
}
