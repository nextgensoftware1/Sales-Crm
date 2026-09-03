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
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Hired Billing Support<small>PRACTICE REVENUE CRM</small></div>
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
              <b>{currentUser.full_name}</b>
              <span>{currentUser.role} · {currentUser.company}</span>
            </div>
          )}
          <SignOutButton />
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {headerRight}
            <ThemeToggle />
            {currentUser && (
              <div className="who"><b>{currentUser.full_name}</b>{currentUser.role}</div>
            )}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}