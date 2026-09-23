import { getCurrentUser } from './supabase-server'

// Compatibility helper: identity always comes from Supabase verification.
export async function getVerifiedUserId(): Promise<string | null> {
  const { data: { user } } = await getCurrentUser()
  return user?.id ?? null
}
