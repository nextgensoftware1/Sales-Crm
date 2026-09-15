'use server'

import { createSupabaseServer } from '../lib/supabase-server'

// Called immediately after a successful Supabase Auth sign-in. Auth alone
// doesn't know about our own users.status column or whether the users row
// still exists at all — a company (and its team) can be suspended, or a
// company can be permanently deleted (which may leave the auth account
// valid but orphaned, no matching users row). Both cases must be caught
// here, before the person ever reaches the app, not discovered piecemeal on
// whatever page they happen to land on first.
export async function checkAccountStatus(): Promise<{
  ok: boolean
  reason?: 'not_found' | 'suspended'
}> {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'not_found' }

  const { data: me } = await supabase
    .from('users')
    .select('status, tenants(status)')
    .eq('auth_id', user.id)
    .maybeSingle()

  // No matching profile — most likely the company (or the user itself) was
  // permanently deleted. The auth account may still technically work, but
  // there's nothing left to sign in to.
  if (!me) return { ok: false, reason: 'not_found' }

  const myStatus = (me as any).status
  const companyStatus = (me as any).tenants?.status
  if (myStatus === 'suspended' || companyStatus === 'suspended') {
    return { ok: false, reason: 'suspended' }
  }

  return { ok: true }
}
