import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { timedSupabaseFetch } from './supabase-fetch'

// React memoization lasts for this server render only, never across users.
export const createSupabaseServer = cache(async () => {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: timedSupabaseFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // called from a Server Component — proxy.ts persists refreshed cookies
          }
        },
      },
    }
  )
})

// Authentication stays at the data entry point. Never trust session.user or
// a caller-supplied identity header. Nested page/action reads share this check.
export const getCurrentUser = cache(async () => {
  const supabase = await createSupabaseServer()
  return supabase.auth.getUser()
})

export type CurrentProfile = {
  id: string
  auth_id: string
  email: string
  full_name: string
  tenant_id: string | null
  status: string
  roles: { key: string; label: string; level: number } | null
  tenants: { name: string; status: string } | null
}

// One projection avoids repeating slightly different profile queries when a
// server page calls a data action. It is not a persistent profile cache.
// Call only with the ID returned by getCurrentUser(), never with input IDs.
export const getCurrentProfile = cache(async (verifiedAuthId: string) => {
  const supabase = await createSupabaseServer()
  return supabase.from('users')
    .select('id, auth_id, email, full_name, tenant_id, status, roles(key, label, level), tenants(name, status)')
    .eq('auth_id', verifiedAuthId)
    .maybeSingle()
    .overrideTypes<CurrentProfile | null, { merge: false }>()
})
