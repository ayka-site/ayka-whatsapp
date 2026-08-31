'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
const { apiFetch, getUser, setUser, removeToken } = require('../lib/api')

const REAL_ESTATE_DEMO_BUSINESS_ID = '6a3157f348f8877f957279bd'

const NAV_ITEMS = {
  client: [
    { href: '/client/dashboard', label: 'Dashboard', icon: '📊' },
    { href: '/client/leads', label: 'Leads', icon: '👥' },
    { href: '/client/conversations', label: 'Conversations', icon: '💬' },
    { href: '/client/appointments', label: 'Appointments', icon: '📅' },
    { href: '/client/settings', label: 'Settings', icon: '⚙️' },
  ],
  reseller: [
    { href: '/admin/dashboard', label: 'Dashboard', icon: '📊' },
    { href: '/admin/clients', label: 'Clients', icon: '🏢' },
    { href: '/admin/leads', label: 'Leads', icon: '👥' },
    { href: '/admin/conversations', label: 'Conversations', icon: '💬' },
    { href: '/admin/appointments', label: 'Appointments', icon: '📅' },
    { href: '/admin/analytics', label: 'Analytics', icon: '📈' },
    { href: '/admin/widget', label: 'Web Widget', icon: '🔌' },
    { href: '/admin/settings', label: 'Settings', icon: '⚙️' },
  ],
  superadmin: [
    { href: '/superadmin/dashboard', label: 'Dashboard', icon: '📊' },
    { href: '/superadmin/resellers', label: 'Resellers', icon: '🏢' },
    { href: '/superadmin/clients', label: 'Clients', icon: '🏫' },
    { href: '/superadmin/users', label: 'Users', icon: '👤' },
    { href: '/superadmin/leads', label: 'Leads', icon: '👥' },
    { href: '/superadmin/system', label: 'System', icon: '🖥️' },
    { href: '/superadmin/settings', label: 'Settings', icon: '⚙️' },
  ],
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUserState] = useState(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const u = getUser()
    if (!u) { router.push('/login'); return }
    setUserState(u)

    apiFetch('/api/auth/me')
      .then(freshUser => {
        setUser(freshUser)
        setUserState(freshUser)
      })
      .catch(() => {})
  }, [router])

  if (!user) return null

  const items = [...(NAV_ITEMS[user.role] || [])]
  const isRealEstateClient = user.businessVertical === 'realestate'
    || String(user.businessId || '') === REAL_ESTATE_DEMO_BUSINESS_ID
  if (user.role === 'client' && isRealEstateClient) {
    items.splice(2, 0, { href: '/client/properties', label: 'Properties', icon: '🏘️' })
  }
  const theme = user.themeConfig || {}

  function handleLogout() {
    removeToken()
    router.push('/login')
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col fixed left-0 top-0 h-full z-40 transition-all duration-200 ${collapsed ? 'w-16' : 'w-64'}`}
        style={{ background: 'var(--color-sidebar)', borderRight: '1px solid rgba(255,255,255,0.08)' }}
      >
        {/* Brand */}
        <div className="p-4 flex items-center gap-3 border-b border-white/10">
          {theme.logoUrl ? (
            <img src={theme.logoUrl} alt="" className="w-8 h-8 rounded" />
          ) : (
            <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-white text-sm" style={{ background: 'var(--color-primary)' }}>
              {(theme.brandName || 'D')[0]}
            </div>
          )}
          {!collapsed && <span className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>{theme.brandName || 'Dashboard'}</span>}
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
          {items.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  active
                    ? 'font-medium'
                    : 'opacity-70 hover:opacity-100'
                }`}
                style={{
                  background: active ? 'var(--color-primary)' : 'transparent',
                  color: active ? '#fff' : 'var(--color-text)',
                }}
              >
                <span className="text-base">{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-white/10">
          {!collapsed && (
            <div className="mb-2">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{user.displayName}</p>
              <p className="text-xs opacity-50 truncate">{user.email}</p>
            </div>
          )}
          <button onClick={handleLogout} className="text-xs opacity-60 hover:opacity-100 transition-opacity" style={{ color: 'var(--color-text)' }}>
            {collapsed ? '🚪' : 'Sign Out'}
          </button>
        </div>

        {!collapsed && (
          <div className="px-4 pb-3 text-[10px] opacity-40" style={{ color: 'var(--color-text)' }}>
            Powered by Welltechup x Ayka
          </div>
        )}
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t" style={{ background: 'var(--color-sidebar)', borderColor: 'rgba(255,255,255,0.08)' }}>
        {items.slice(0, 5).map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center py-2 text-xs transition-colors"
              style={{ color: active ? 'var(--color-primary)' : 'var(--color-text)', opacity: active ? 1 : 0.5 }}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="mt-0.5 truncate">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
