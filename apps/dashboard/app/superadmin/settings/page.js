'use client'
import { useState } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar } from '../../../components/UI'
const { apiFetch } = require('../../../lib/api')

export default function SuperAdminSettings() {
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function changePwd(e) {
    e.preventDefault()
    setMsg('')
    if (newPwd !== confirmPwd) { setMsg('Passwords do not match'); return }
    if (newPwd.length < 8) { setMsg('Minimum 8 characters'); return }
    setSaving(true)
    try {
      await apiFetch('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }) })
      setMsg('Password updated successfully')
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    } catch (err) { setMsg(err.message || 'Failed') }
    setSaving(false)
  }

  return (
    <DashboardLayout requiredRole="superadmin">
      <TopBar title="Settings" breadcrumbs={['Home', 'Settings']} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Platform Info</h2>
          <div className="space-y-3 text-sm">
            <F label="Platform" value="AyKa AI Automation" />
            <F label="Role" value="Super Administrator" />
            <F label="Version" value="1.0.0" />
          </div>
        </div>

        <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Change Password</h2>
          <form onSubmit={changePwd} className="space-y-4">
            <PwdField label="Current Password" value={currentPwd} onChange={setCurrentPwd} />
            <PwdField label="New Password" value={newPwd} onChange={setNewPwd} />
            <PwdField label="Confirm New Password" value={confirmPwd} onChange={setConfirmPwd} />
            {msg && <p className={`text-xs ${msg.includes('success') ? 'text-green-500' : 'text-red-400'}`}>{msg}</p>}
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}>{saving ? 'Saving…' : 'Update Password'}</button>
          </form>
        </div>
      </div>
    </DashboardLayout>
  )
}

function F({ label, value }) {
  return <div className="flex items-start gap-4"><span className="text-xs opacity-40 w-28 shrink-0">{label}</span><span style={{ color: 'var(--color-text)' }}>{value}</span></div>
}

function PwdField({ label, value, onChange }) {
  return <div><label className="block text-xs mb-1 opacity-50">{label}</label><input type="password" value={value} onChange={e => onChange(e.target.value)} required className="w-full px-3 py-2 text-sm rounded-lg border border-white/10 bg-transparent outline-none focus:border-white/30" style={{ color: 'var(--color-text)' }} /></div>
}
