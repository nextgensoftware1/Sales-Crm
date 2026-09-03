'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '../lib/supabase-browser'

export default function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const signOut = async () => {
    setBusy(true)
    try {
      const supabase = createSupabaseBrowser()
      await supabase.auth.signOut()
      router.push('/login')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      style={{
        marginTop: 10,
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'transparent',
        color: '#8a99a8',
        border: '1px solid #1c2836',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 13,
        cursor: busy ? 'default' : 'pointer',
      }}
    >
      <span aria-hidden>⇥</span>{busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}