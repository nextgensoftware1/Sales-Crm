export type ShellUser = {
  fullName: string
  role: string
  company: string
  isSuperAdmin: boolean
  showTransfers: boolean
  canManageUsers: boolean
}
export async function getShellUser(): Promise<ShellUser | null> {
  return { fullName: 'Super Admin', role: 'Super Admin', company: 'Platform', isSuperAdmin: true, showTransfers: true, canManageUsers: true }
}
