'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  ClipboardList, LayoutDashboard, BellRing, Users, ArrowLeftRight, Settings, Trash2,
  Menu, X, PanelLeftClose, PanelLeft,
} from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import SignOutButton from './SignOutButton'
import NotificationBell from './NotificationBell'
import { ChromeProvider, usePageChrome } from './PageChrome'
import type { ShellUser } from '../lib/get-shell-user'
import BrandLogo from './BrandLogo'

type NavItem = { href: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }
const NAV: NavItem[] = [
  { href: '/',              label: 'Leads Engine',   icon: ClipboardList },
  { href: '/dashboard',     label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/reminders',     label: 'My Reminders',   icon: BellRing },
  { href: '/clients',       label: 'Active Clients', icon: Users },
  { href: '/transfers',     label: 'Transfers',      icon: ArrowLeftRight },
  { href: '/admin',         label: 'Admin',          icon: Settings },
  { href: '/deleted-leads', label: 'Deleted Leads',  icon: Trash2 },
]

// First letter of the first two words, e.g. "Hired Billing Support" -> "HB".
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// A fixed varied palette, deterministically hashed from the person's name —
// the same person gets the same avatar color everywhere they appear in the
// app, rather than every avatar just being the brand accent color.
const AVATAR_PALETTE = ['#3B82F6', '#EC4899', '#00C896', '#8B5CF6', '#F59E0B', '#64748B', '#EF4444', '#06B6D4']
function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

function ShellChrome({ user, children }: { user: ShellUser; children: ReactNode }) {
  const { title, subtitle, active, headerRight } = usePageChrome()

  // Deleted Leads is Super Admin only. Admin (user management) is visible to
  // Super Admin plus anyone who can manage users within their own company
  // (Company Admin / Manager / Team Lead). Transfers are visible when enabled.
  const items = NAV.filter((n) => {
    if (n.href === '/deleted-leads') return user.isSuperAdmin
    if (n.href === '/admin') return user.isSuperAdmin || user.canManageUsers
    if (n.href === '/transfers') return user.showTransfers
    return true
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
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

  const currentUser = { full_name: user.fullName, role: user.role, company: user.company }

  return (
    <div className={'app-shell' + (sidebarExpanded ? '' : ' sidebar-collapsed')}>
      <div
        className={'sidebar-backdrop' + (menuOpen ? ' open' : '')}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside className={'sidebar' + (menuOpen ? ' open' : '')}>
        <div className="sidebar-brand">
          <BrandLogo className="sidebar-logo" />
          <div className="sidebar-brand-close-row">
            <button
              className="sidebar-close"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              type="button"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
        <nav className="sidebar-nav">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className={'nav-item' + (active === n.href ? ' active' : '')} title={n.label}>
              <span className="ico"><n.icon size={18} strokeWidth={2} /></span><span className="nav-label">{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <div className="sidebar-avatar" aria-hidden="true" title={currentUser.full_name} style={{ background: avatarColor(currentUser.full_name), borderColor: avatarColor(currentUser.full_name) }}>{initials(currentUser.full_name)}</div>
            <div className="sidebar-user-text">
              <b>{currentUser.full_name}</b>
              <span>{currentUser.role}</span>
            </div>
          </div>
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
              <Menu size={20} strokeWidth={2} />
            </button>
            <button
              className="desktop-collapse"
              onClick={() => setSidebarExpanded((v) => !v)}
              aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
              title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
              type="button"
            >
              {sidebarExpanded ? <PanelLeftClose size={20} strokeWidth={2} /> : <PanelLeft size={20} strokeWidth={2} />}
            </button>
            <span className="topbar-context">Hired Billing Support <span>/</span> {title}</span>
          </div>
          <div className="topbar-right">
            <ThemeToggle />
            <NotificationBell />
            <div className="top-user">
              <div className="who"><b>{currentUser.full_name}</b>{currentUser.role}</div>
              <div className="topbar-avatar" aria-hidden="true" style={{ background: avatarColor(currentUser.full_name), borderColor: avatarColor(currentUser.full_name) }}>{initials(currentUser.full_name)}</div>
            </div>
            <SignOutButton variant="icon" />
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
            {headerRight && <div className="page-heading-actions">{headerRight}</div>}
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}

// Top-level: no shell at all when signed out (e.g. the login page) — just
// the page's own content, full-bleed, exactly as before.
export default function AppChrome({ user, children }: { user: ShellUser | null; children: ReactNode }) {
  const pathname = usePathname()
  if (!user || pathname === '/login') return <>{children}</>
  return (
    <ChromeProvider>
      <ShellChrome user={user}>{children}</ShellChrome>
    </ChromeProvider>
  )
}
