'use client'

import { useState } from 'react'
import BrandLogo from '../BrandLogo'
import { createSupabaseBrowser } from '../../lib/supabase-browser'
import { checkAccountStatus } from '../auth-actions'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)

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
    if (error) {
      setLoading(false)
      setError(error.message)
      return
    }

    // Auth succeeded, but that only proves the credentials are right — it
    // says nothing about whether this account (or its company) has since
    // been suspended, or whether the profile still exists at all. Check
    // before letting the person any further in.
    const status = await checkAccountStatus()
    if (!status.ok) {
      await supabase.auth.signOut()
      setLoading(false)
      if (status.reason === 'suspended') {
        setError('Your account has been suspended. Please contact your admin to have this fixed.')
      } else {
        setError('Invalid email or password.')
      }
      return
    }

    setLoading(false)
    // One navigation after the auth boundary, clearing any previous user's
    // browser/router caches. push + refresh used to request the home page twice.
    window.location.replace('/')
  }

  return (
    <div className="login-page">
      <div className="login-brand">
        <BrandLogo className="login-logo" />
        <div className="login-brand-copy">
          <h2>More Practices.<br />More Revenue.</h2>
          <p>We help medical practices grow with expert billing support. Our team handles the revenue cycle, so you can focus on patient care.</p>
        </div>
        <svg className="login-waves" viewBox="0 0 480 340" fill="none" aria-hidden="true">
          {Array.from({ length: 15 }, (_, i) => <path key={i} d={`M-50 ${260 + i * 9} C90 ${310 + i * 5}, 125 ${20 + i * 9}, 270 ${40 + i * 11} S420 ${220 + i * 6}, 470 390`} stroke="#00C896" strokeWidth="1" opacity={0.36 - i * 0.015} />)}
        </svg>
      </div>
      <div className="login-form-area">
      <div className="login-card">
        <div className="login-head">
          <h1>Welcome back</h1>
          <p className="login-sub">Sign in to your HBS CRM account</p>
        </div>

        <div className="login-form">
          <div className="login-field">
            <label className="login-label" htmlFor="login-email">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Email address</span>
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="login-input"
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="login-password">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>Password</span>
            </label>
            <div className="login-pw-wrap">
              <input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}
                className="login-input"
                placeholder="Enter your password"
                autoComplete="current-password"
              />
              <button type="button" className="login-pw-toggle" onClick={() => setShowPw((v) => !v)} tabIndex={-1} aria-label={showPw ? 'Hide password' : 'Show password'}>
                {showPw ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" x2="22" y1="2" y2="22" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Purely a UI convenience — Supabase's client already persists the
              session regardless of this checkbox's state. */}
          <div className="login-remember-row">
            <label className="login-remember">
              <input type="checkbox" defaultChecked />
              <span>Remember me</span>
            </label>
            <button type="button" className="login-forgot">Forgot password?</button>
          </div>

          {error && <p className="login-error">{error}</p>}

          <button onClick={handleLogin} disabled={loading} className="login-submit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="m10 17 5-5-5-5" />
              <path d="M15 12H3" />
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            </svg>
            <span>{loading ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </div>
      </div>
      <p className="login-copyright">© {new Date().getFullYear()} Hired Billing Support. All rights reserved.</p>
      </div>
    </div>
  )
}
