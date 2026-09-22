'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import ThemeToggle from './ThemeToggle'
import SignOutButton from './SignOutButton'
import NotificationBell from './NotificationBell'
import type { Reminder } from './reminders-actions'

// Hand-authored, stroke-based icons (matches the style already used
// elsewhere in this app, e.g. DashboardView's icon set) rather than adding
// a new icon-library dependency just for the sidebar.
const iconProps = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const IconLeads = () => <svg {...iconProps}><path d="M9 2h6a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" /><path d="M9 6h6M9 10h6M9 14h4" /></svg>
const IconDashboard = () => <svg {...iconProps}><rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" /></svg>
const IconClock = () => <svg {...iconProps}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
const IconUsers = () => <svg {...iconProps}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
const IconTransfer = () => <svg {...iconProps}><path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" /></svg>
const IconSettings = () => <svg {...iconProps}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></svg>
const IconTrash = () => <svg {...iconProps}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
const IconReport = () => <svg {...iconProps}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M15 2v5h5" /><path d="M9 13h6M9 17h6M9 9h1" /></svg>

type NavItem = { href: string; label: string; icon: React.ReactNode; admin?: boolean }
const NAV: NavItem[] = [
  { href: '/',              label: 'Leads Engine',   icon: <IconLeads /> },
  { href: '/dashboard',     label: 'Dashboard',      icon: <IconDashboard /> },
  { href: '/reminders',     label: 'My Reminders',   icon: <IconClock /> },
  { href: '/clients',       label: 'Active Clients', icon: <IconUsers /> },
  { href: '/transfers',     label: 'Transfers',      icon: <IconTransfer /> },
  // Grouped under an "Admin" section header below — same items, hrefs, and
  // visibility rules as before, just visually separated to match the
  // reference image's sidebar grouping.
  { href: '/admin',         label: 'Admin',          icon: <IconSettings />, admin: true },
  { href: '/worksheet-reports', label: 'Worksheet Reports', icon: <IconReport />, admin: true },
  { href: '/deleted-leads', label: 'Deleted Leads',  icon: <IconTrash />, admin: true },
]

// First letter of the first two words, e.g. "Hired Billing Support" -> "HB".
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export default function AppShell({
  title, subtitle, currentUser, active, children, showAdmin = false, showTransfers = false, canManageUsers = false, headerRight = null, initialReminders,
}: {
  title: string
  subtitle?: string
  currentUser: { full_name: string; role: string; company: string } | null
  active: string
  children: React.ReactNode
  showAdmin?: boolean
  showTransfers?: boolean
  canManageUsers?: boolean
  headerRight?: React.ReactNode
  initialReminders?: Reminder[]
}) {
  // Deleted Leads is Super Admin only. Admin (user management) is visible to
  // Super Admin plus anyone who can manage users within their own company
  // (Company Admin / Manager / Team Lead). Transfers are visible when enabled.
  const items = NAV.filter((n) => {
    if (n.href === '/deleted-leads') return showAdmin
    if (n.href === '/admin') return showAdmin || canManageUsers
    if (n.href === '/worksheet-reports') return showAdmin || canManageUsers
    if (n.href === '/transfers') return showTransfers
    return true
  })
  // Same filtered list, split only for rendering — admin-tier items get
  // their own section label, nothing about which items appear changes.
  const mainItems = items.filter((n) => !n.admin)
  const adminItems = items.filter((n) => n.admin)
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

  return (
    <div className={'app-shell' + (sidebarExpanded ? '' : ' sidebar-collapsed')}>
      <div
        className={'sidebar-backdrop' + (menuOpen ? ' open' : '')}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside className={'sidebar' + (menuOpen ? ' open' : '')}>
        <div className="sidebar-brand">
          <div className="sidebar-mark" aria-hidden="true" title="Hired Billing Support">HB</div>
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
          {mainItems.map((n) => (
            <Link key={n.href} href={n.href} className={'nav-item' + (active === n.href ? ' active' : '')} title={n.label}>
              <span className="ico">{n.icon}</span><span className="nav-label">{n.label}</span>
            </Link>
          ))}
          {adminItems.length > 0 && (
            <>
              <div className="nav-section-label">Admin</div>
              {adminItems.map((n) => (
                <Link key={n.href} href={n.href} className={'nav-item' + (active === n.href ? ' active' : '')} title={n.label}>
                  <span className="ico">{n.icon}</span><span className="nav-label">{n.label}</span>
                </Link>
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          {currentUser && (
            <div className="sidebar-user">
              <div className="sidebar-avatar" aria-hidden="true" title={currentUser.full_name}>{initials(currentUser.full_name)}</div>
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
              onClick={() => setSidebarExpanded((v) => !v)}
              aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
              title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
              type="button"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ transform: sidebarExpanded ? 'none' : 'scaleX(-1)' }}>
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
            {currentUser && <NotificationBell initialReminders={initialReminders} />}
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
