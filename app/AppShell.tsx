'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import ThemeToggle from './ThemeToggle'
import SignOutButton from './SignOutButton'

type NavItem = { href: string; label: string; icon: string }
const NAV: NavItem[] = [
  { href: '/',          label: 'Leads Engine',   icon: '▤' },
  { href: '/dashboard', label: 'Dashboard',      icon: '◫' },
  { href: '/reminders', label: 'My Reminders',   icon: '◷' },
  { href: '/clients',   label: 'Active Clients', icon: '◇' },
  { href: '/admin',     label: 'Admin',          icon: '⚙' },
]

// First letter of the first two words, e.g. "Hired Billing Support" -> "HB".
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export default function AppShell({
  title, subtitle, currentUser, active, children, showAdmin = false, headerRight = null,
}: {
  title: string
  subtitle?: string
  currentUser: { full_name: string; role: string; company: string } | null
  active: string
  children: React.ReactNode
  showAdmin?: boolean
  headerRight?: React.ReactNode
}) {
  const items = NAV.filter((n) => n.href !== '/admin' || showAdmin)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const pathname = usePathname()

  // Close the mobile drawer whenever the route changes (adjust state during
  // render rather than in an effect, per React's guidance for derived state).
  const [lastPathname, setLastPathname] = useState(pathname)
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setMenuOpen(false)
  }

  // Prevent background scroll while the mobile drawer is open.
  useEffect(() => {
    if (menuOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [menuOpen])

  return (
    <div className={'app-shell' + (sidebarVisible ? '' : ' sidebar-collapsed')}>
      <div
        className={'sidebar-backdrop' + (menuOpen ? ' open' : '')}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside className={'sidebar' + (menuOpen ? ' open' : '')}>
        <div className="sidebar-brand">
          <div className="sidebar-mark" aria-hidden="true">HB</div>
          <div className="sidebar-brand-close-row">
            <span className="sidebar-brand-text">Hired Billing Support<small>Practice Revenue CRM</small></span>
            <button
              className="sidebar-close"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              type="button"
            >
              ✕
            </button>
          </div>
        </div>
        <nav className="sidebar-nav">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className={'nav-item' + (active === n.href ? ' active' : '')}>
              <span className="ico">{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          {currentUser && (
            <div className="sidebar-user">
              <div className="sidebar-avatar" aria-hidden="true">{initials(currentUser.full_name)}</div>
              <div className="sidebar-user-text">
                <b>{currentUser.full_name}</b>
                <span>{currentUser.role}</span>
              </div>
            </div>
          )}
          <SignOutButton />
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="menu-toggle"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              type="button"
            >
              ☰
            </button>
            <button
              className="desktop-collapse"
              onClick={() => setSidebarVisible((v) => !v)}
              aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
              title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ transform: sidebarVisible ? 'none' : 'scaleX(-1)' }}>
                <rect width="18" height="18" x="3" y="3" rx="0" />
                <path d="M9 3v18" />
              </svg>
            </button>
            <div className="topbar-title">
              <h1>{title}</h1>
              {subtitle && <div className="sub">{subtitle}</div>}
            </div>
          </div>
          <div className="topbar-right">
            {headerRight}
            <ThemeToggle />
            {currentUser && (
              <div className="top-user">
                <div className="who"><b>{currentUser.full_name}</b>{currentUser.role}</div>
                <div className="topbar-avatar" aria-hidden="true">{initials(currentUser.full_name)}</div>
              </div>
            )}
            <SignOutButton variant="icon" />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
