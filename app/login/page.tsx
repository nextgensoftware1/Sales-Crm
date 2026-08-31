'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '../../lib/supabase-browser'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setError('')
    if (!email.trim() || !password) {
      setError('Please enter both email and password.')
      return
    }
    setLoading(true)
    const supabase = createSupabaseBrowser()
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  const box = { padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 15, width: '100%', boxSizing: 'border-box' as const, color: '#000' }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ width: 340, padding: 32, border: '1px solid #ddd', borderRadius: 12 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Sign in</h1>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 24 }}>LeadCRM</p>

        <label style={{ fontSize: 13, color: '#666' }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ ...box, margin: '6px 0 16px' }}
          placeholder="you@example.com"
          autoComplete="off"
        />

        <label style={{ fontSize: 13, color: '#666' }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}
          style={{ ...box, margin: '6px 0 16px' }}
          placeholder="password"
          autoComplete="off"
        />

        {error && <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <button onClick={handleLogin} disabled={loading} style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: 'none', background: '#2563eb', color: '#fff', fontSize: 15, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  )
}