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
