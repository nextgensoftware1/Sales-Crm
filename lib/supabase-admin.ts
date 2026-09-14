import { createClient } from '@supabase/supabase-js'

// IMPORTANT: this client uses the Supabase SERVICE ROLE key, which bypasses
// Row Level Security entirely and can perform Admin API operations like
// creating auth users directly. It must only ever be used inside 'use server'
// actions, never in a client component, and the key itself must never be
// prefixed with NEXT_PUBLIC_ (that would bundle it into browser JS).
//
// Add this to your .env.local (and your deployment's server-side env vars):
//   SUPABASE_SERVICE_ROLE_KEY=<the "service_role" secret from
//   Supabase Dashboard → Project Settings → API>
export function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to your server environment ' +
      '(Supabase Dashboard → Project Settings → API → service_role secret) to enable creating users.'
    )
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
