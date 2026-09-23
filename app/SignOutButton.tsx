'use client'

import { useState } from 'react'
import { createSupabaseBrowser } from '../lib/supabase-browser'

export default function SignOutButton({ variant = 'sidebar' }: { variant?: 'sidebar' | 'icon' }) {
  const [busy, setBusy] = useState(false)

  const signOut = async () => {
    setBusy(true)
    try {
      const supabase = createSupabaseBrowser()
      await supabase.auth.signOut()
      window.location.replace('/login')
    } finally {
      setBusy(false)
    }
  }

  const icon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    </svg>
  )

  if (variant === 'icon') {
    return (
      <button
        onClick={signOut}
        disabled={busy}
        className="topbar-signout"
        aria-label="Sign out"
        title="Sign out"
        style={{ opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
      >
        {icon}
      </button>
    )
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="sidebar-signout"
      style={{ opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' }}
    >
      {icon}
      <span>{busy ? 'Signing out…' : 'Sign Out'}</span>
    </button>
  )
}
