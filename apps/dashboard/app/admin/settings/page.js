'use client'
import { useState, useEffect } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, FormField, FormInput } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
const { apiFetch, getUser, setUser } = require('../../../lib/api')

export default function AdminSettings() {
  const { data, loading, refetch } = useFetch('/api/admin/settings', [])
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [pwdForm, setPwdForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwdMsg, setPwdMsg] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)

  useEffect(() => {
    if (data) {
      setForm({
        name: data.name || '', email: data.email || '', phone: data.phone || '',
        themeConfig: {
          brandName: data.themeConfig?.brandName || '',
          logoUrl: data.themeConfig?.logoUrl || '',
          primaryColor: data.themeConfig?.primaryColor || '#0ea5e9',
          accentColor: data.themeConfig?.accentColor || '#38bdf8',
          backgroundColor: data.themeConfig?.backgroundColor || '#f0f9ff',
          sidebarColor: data.themeConfig?.sidebarColor || '#ffffff',
          textColor: data.themeConfig?.textColor || '#0f172a',
          faviconUrl: data.themeConfig?.faviconUrl || '',
          supportEmail: data.themeConfig?.supportEmail || '',
          supportPhone: data.themeConfig?.supportPhone || '',
          showPlatformCredit: !!data.themeConfig?.showPlatformCredit,
        }
      })
    }
  }, [data])

  function set(path, val) {
    setForm(prev => {
      const next = JSON.parse(JSON.stringify(prev))
      const keys = path.split('.')
      let obj = next
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]]
      obj[keys[keys.length - 1]] = val
      return next
    })
  }

  async function saveSettings() {
    setMsg(''); setSaving(true)
    try {
      await apiFetch('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(form) })
      // Update localStorage so theme applies immediately without re-login
      const user = getUser()
      if (user && form.themeConfig) {
        user.themeConfig = { ...user.themeConfig, ...form.themeConfig }
        setUser(user)
        // Re-inject CSS variables immediately
        const root = document.documentElement
        const tc = form.themeConfig
        if (tc.primaryColor) root.style.setProperty('--color-primary', tc.primaryColor)
        if (tc.accentColor) root.style.setProperty('--color-accent', tc.accentColor)
        if (tc.backgroundColor) root.style.setProperty('--color-background', tc.backgroundColor)
        if (tc.sidebarColor) root.style.setProperty('--color-sidebar', tc.sidebarColor)
        if (tc.textColor) root.style.setProperty('--color-text', tc.textColor)
        if (tc.brandName) document.title = `${tc.brandName} Dashboard`
      }
      setMsg('Settings saved successfully - theme updated')
      setEditing(false); refetch()
    } catch (err) { setMsg(err.message) }
    setSaving(false)
  }

  async function changePassword(e) {
    e.preventDefault(); setPwdMsg('')
    if (pwdForm.newPassword !== pwdForm.confirmPassword) { setPwdMsg('Passwords do not match'); return }
    if (pwdForm.newPassword.length < 8) { setPwdMsg('Minimum 8 characters'); return }
    setPwdSaving(true)
    try {
      await apiFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: pwdForm.currentPassword, newPassword: pwdForm.newPassword }) })
      setPwdMsg('Password updated successfully')
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) { setPwdMsg(err.message) }
    setPwdSaving(false)
  }

  const theme = data?.themeConfig || {}

  return (
    <DashboardLayout requiredRole="reseller">
      <TopBar title="Settings" breadcrumbs={['Home', 'Settings']}
        action={!editing ? <button onClick={() => setEditing(true)} className="px-4 py-2 text-sm rounded-lg font-medium text-white" style={{ background: 'var(--color-primary)' }}>Edit Settings</button> : null} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile Section */}
        <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Reseller Profile</h2>
          {loading ? (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 w-full rounded" />)}</div>
          ) : editing ? (
            <div className="space-y-3">
              <FormField label="Name"><FormInput value={form.name} onChange={v => set('name', v)} /></FormField>
              <FormField label="Email"><FormInput value={form.email} onChange={v => set('email', v)} type="email" /></FormField>
              <FormField label="Phone"><FormInput value={form.phone} onChange={v => set('phone', v)} /></FormField>
              <F label="Slug" value={data?.slug || '-'} />
              <F label="Setup Cost" value={data?.pricing?.setupCost != null ? `₹${data.pricing.setupCost.toLocaleString()}` : '-'} />
              <F label="Per Bot Cost" value={data?.pricing?.perBotCost != null ? `₹${data.pricing.perBotCost.toLocaleString()}` : '-'} />
              <F label="Monthly/Bot" value={data?.pricing?.monthlyPerBot != null ? `₹${data.pricing.monthlyPerBot.toLocaleString()}/mo` : '-'} />
              <F label="Bot Slots" value={data?.pricing?.botSlots || '-'} />
              <F label="Platform Fee" value={data?.platformFeeStatus || '-'} />
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <F label="Name" value={data?.name || '-'} />
              <F label="Slug" value={data?.slug || '-'} />
              <F label="Email" value={data?.email || '-'} />
              <F label="Phone" value={data?.phone || '-'} />
              <F label="Setup Cost" value={data?.pricing?.setupCost != null ? `₹${data.pricing.setupCost.toLocaleString()}` : '-'} />
              <F label="Per Bot Cost" value={data?.pricing?.perBotCost != null ? `₹${data.pricing.perBotCost.toLocaleString()}` : '-'} />
              <F label="Monthly/Bot" value={data?.pricing?.monthlyPerBot != null ? `₹${data.pricing.monthlyPerBot.toLocaleString()}/mo` : '-'} />
              <F label="Bot Slots" value={data?.pricing?.botSlots || '-'} />
              <F label="Platform Fee" value={data?.platformFeeStatus || '-'} />
              <F label="Status" value={data?.isActive ? 'Active' : 'Inactive'} />
            </div>
          )}
        </div>

        {/* Theme Section */}
        <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Theme Configuration</h2>
          {loading ? (
            <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="skeleton h-10 w-full rounded" />)}</div>
          ) : editing ? (
            <div className="space-y-3">
              <FormField label="Brand Name"><FormInput value={form.themeConfig?.brandName} onChange={v => set('themeConfig.brandName', v)} /></FormField>
              <FormField label="Logo URL"><FormInput value={form.themeConfig?.logoUrl} onChange={v => set('themeConfig.logoUrl', v)} /></FormField>
              <FormField label="Primary Color">
                <div className="flex gap-2 items-center">
                  <input type="color" value={form.themeConfig?.primaryColor || '#0ea5e9'} onChange={e => set('themeConfig.primaryColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                  <FormInput value={form.themeConfig?.primaryColor} onChange={v => set('themeConfig.primaryColor', v)} />
                </div>
              </FormField>
              <FormField label="Accent Color">
                <div className="flex gap-2 items-center">
                  <input type="color" value={form.themeConfig?.accentColor || '#38bdf8'} onChange={e => set('themeConfig.accentColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
                  <FormInput value={form.themeConfig?.accentColor} onChange={v => set('themeConfig.accentColor', v)} />
                </div>
              </FormField>
              <FormField label="Background"><FormInput value={form.themeConfig?.backgroundColor} onChange={v => set('themeConfig.backgroundColor', v)} /></FormField>
              <FormField label="Sidebar"><FormInput value={form.themeConfig?.sidebarColor} onChange={v => set('themeConfig.sidebarColor', v)} /></FormField>
              <FormField label="Text"><FormInput value={form.themeConfig?.textColor} onChange={v => set('themeConfig.textColor', v)} /></FormField>
              <FormField label="Favicon URL"><FormInput value={form.themeConfig?.faviconUrl} onChange={v => set('themeConfig.faviconUrl', v)} /></FormField>
              <FormField label="Support Email"><FormInput value={form.themeConfig?.supportEmail} onChange={v => set('themeConfig.supportEmail', v)} /></FormField>
              <FormField label="Support Phone"><FormInput value={form.themeConfig?.supportPhone} onChange={v => set('themeConfig.supportPhone', v)} /></FormField>
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={!!form.themeConfig?.showPlatformCredit} onChange={e => set('themeConfig.showPlatformCredit', e.target.checked)} className="rounded" />
                Show "Platform by AyKa" credit
              </label>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <F label="Brand Name" value={theme.brandName || '-'} />
              <F label="Logo URL" value={theme.logoUrl || '-'} />
              <ColorF label="Primary" color={theme.primaryColor} />
              <ColorF label="Accent" color={theme.accentColor} />
              <F label="Sidebar BG" value={theme.sidebarColor || '-'} />
              <F label="Surface BG" value={theme.backgroundColor || '-'} />
              <F label="Text" value={theme.textColor || '-'} />
              <F label="Favicon" value={theme.faviconUrl || '-'} />
              <F label="Platform Credit" value={theme.showPlatformCredit ? 'Yes' : 'No'} />
            </div>
          )}
        </div>
      </div>

      {/* Save / Cancel bar */}
      {editing && (
        <div className="mt-4 flex items-center gap-3">
          <button onClick={saveSettings} disabled={saving} className="px-6 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{saving ? 'Saving…' : 'Save All Changes'}</button>
          <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm rounded-lg border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>Cancel</button>
          {msg && <span className={`text-xs ${msg.includes('success') ? 'text-green-500' : 'text-red-400'}`}>{msg}</span>}
        </div>
      )}
      {!editing && msg && <p className={`mt-2 text-xs ${msg.includes('success') ? 'text-green-500' : 'text-red-400'}`}>{msg}</p>}

      {/* Password Section */}
      <div className="mt-6 rounded-xl border border-white/10 p-6 max-w-md" style={{ background: 'var(--color-surface)' }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Change Password</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <PwdField label="Current Password" value={pwdForm.currentPassword} onChange={v => setPwdForm(p => ({ ...p, currentPassword: v }))} />
          <PwdField label="New Password" value={pwdForm.newPassword} onChange={v => setPwdForm(p => ({ ...p, newPassword: v }))} />
          <PwdField label="Confirm New Password" value={pwdForm.confirmPassword} onChange={v => setPwdForm(p => ({ ...p, confirmPassword: v }))} />
          {pwdMsg && <p className={`text-xs ${pwdMsg.includes('success') ? 'text-green-500' : 'text-red-400'}`}>{pwdMsg}</p>}
          <button type="submit" disabled={pwdSaving} className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{pwdSaving ? 'Saving…' : 'Update Password'}</button>
        </form>
      </div>
    </DashboardLayout>
  )
}

function F({ label, value }) {
  return <div className="flex items-start gap-4"><span className="text-xs opacity-40 w-28 shrink-0">{label}</span><span className="break-all" style={{ color: 'var(--color-text)' }}>{value}</span></div>
}

function ColorF({ label, color }) {
  return (
    <div className="flex items-start gap-4">
      <span className="text-xs opacity-40 w-28 shrink-0">{label}</span>
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 rounded border border-white/20" style={{ background: color || '#888' }} />
        <span style={{ color: 'var(--color-text)' }}>{color || '-'}</span>
      </div>
    </div>
  )
}

function PwdField({ label, value, onChange }) {
  return <div><label className="block text-xs mb-1 opacity-50" style={{ color: 'var(--color-text)' }}>{label}</label><input type="password" value={value} onChange={e => onChange(e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border border-white/10 bg-transparent outline-none focus:border-white/30" style={{ color: 'var(--color-text)' }} /></div>
}
