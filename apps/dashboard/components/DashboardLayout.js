'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
const { getUser, getToken } = require('../lib/api')

export default function DashboardLayout({ children, requiredRole }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = getToken()
    const user = getUser()
    if (!token || !user) {
      router.replace('/login')
      return
    }
    if (requiredRole && user.role !== requiredRole) {
      router.replace('/login?error=unauthorized')
      return
    }

    // Inject theme CSS variables from user's themeConfig
    const theme = user.themeConfig || {}
    const root = document.documentElement
    if (theme.primaryColor) root.style.setProperty('--color-primary', theme.primaryColor)
    if (theme.accentColor) root.style.setProperty('--color-accent', theme.accentColor)
    if (theme.backgroundColor) root.style.setProperty('--color-background', theme.backgroundColor)
    if (theme.sidebarColor) root.style.setProperty('--color-sidebar', theme.sidebarColor)
    if (theme.textColor) root.style.setProperty('--color-text', theme.textColor)

    // Set page title to brand name
    if (theme.brandName) document.title = `${theme.brandName} Dashboard`
    // Set favicon
    if (theme.faviconUrl) {
      let fav = document.querySelector("link[rel='icon']")
      if (!fav) { fav = document.createElement('link'); fav.rel = 'icon'; document.head.appendChild(fav) }
      fav.href = theme.faviconUrl
    }

    setReady(true)
  }, [router, requiredRole])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="skeleton h-8 w-32" />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--color-background)' }}>
      <Sidebar />
      <main className="md:ml-64 p-4 md:p-8 pb-24 md:pb-8 min-h-screen">
        {children}
      </main>
    </div>
  )
}
