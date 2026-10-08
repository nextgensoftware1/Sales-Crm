// Where each role lands right after signing in.
// Agents start on the Leads page (their work queue); everyone else —
// Super Admin, Company Admin, Manager, Team Lead, Closer — on the Dashboard.
export function homePathForRole(roleKey: string | null | undefined): string {
  return roleKey === 'agent' ? '/' : '/dashboard'
}
