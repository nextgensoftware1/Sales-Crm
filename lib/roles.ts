// The database's roles.label column can drift ("BDM", "BD Executive", etc.)
// since it's free text. The UI should always show the standard role names,
// so every display spot maps through this instead of trusting roles.label
// directly.
export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  company_admin: 'Company Admin',
  manager: 'Manager',
  team_lead: 'Team Lead',
  agent: 'Agent',
  closer: 'Closer',
}

export function roleLabel(key: string | null | undefined): string {
  if (!key) return 'Unknown'
  return ROLE_LABELS[key] ?? key
}

// Purely descriptive — mirrors the assignment hierarchy and scoping rules
// already enforced elsewhere in this app (lead assignment/allocation logic).
// This list doesn't grant or check anything itself; it's a read-only
// summary for the admin page's Roles & Permissions tab.
export const ROLE_PERMISSIONS: { key: string; canAssignTo: string[]; sees: string }[] = [
  { key: 'super_admin',   canAssignTo: [], sees: 'Every company, every lead, platform-wide' },
  { key: 'company_admin', canAssignTo: ['manager', 'team_lead', 'agent', 'closer'], sees: "Their company's full lead pool" },
  { key: 'manager',       canAssignTo: ['team_lead', 'agent', 'closer'], sees: 'Leads assigned to them' },
  { key: 'team_lead',     canAssignTo: ['agent', 'closer'], sees: 'Leads assigned to them' },
  { key: 'agent',         canAssignTo: [], sees: 'Leads assigned to them' },
  { key: 'closer',        canAssignTo: [], sees: 'Leads assigned or transferred to them' },
]
