'use client'
import { useState } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
const { apiFetch } = require('../../../lib/api')

export default function ClientSettings() {
  const { data, loading } = useFetch('/api/client/settings', [])
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
    } catch (err) {
      setMsg(err.message || 'Failed to update password')
    }
    setSaving(false)
  }

  const kb = data?.school || {}
  const bot = data?.bot || {}

  return (
    <DashboardLayout requiredRole="client">
      <TopBar title="Settings" breadcrumbs={['Home', 'Settings']} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* School / Business Info */}
        <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>School Information</h2>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 w-full rounded" />)}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <Field label="Name" value={kb.name || bot.name || '-'} />
              <Field label="Phone" value={kb.contact || '-'} />
              <Field label="Address" value={kb.address || '-'} />
              <Field label="Timings" value={kb.timings || '-'} />
              <Field label="Board" value={kb.board || '-'} />
              <Field label="Classes" value={Array.isArray(kb.classes) ? kb.classes.join(', ') : (kb.classes || '-')} />
              <Field label="Medium" value={Array.isArray(kb.medium) ? kb.medium.join(', ') : (kb.medium || '-')} />
              <Field label="Facilities" value={Array.isArray(kb.facilities) ? kb.facilities.join(', ') : (kb.facilities || '-')} />
              {kb.tagline && <Field label="Tagline" value={kb.tagline} />}
            </div>
          )}
        </div>

        {/* Bot Config (read-only) */}
        <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Bot Configuration</h2>
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10 w-full rounded" />)}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <Field label="Business ID" value={bot._id || '-'} />
              <Field label="Vertical" value={bot.vertical || '-'} />
              <Field label="WhatsApp Number" value={bot.whatsappPhoneId || '-'} />
              <Field label="Status" value={bot.isActive !== undefined ? (bot.isActive ? 'Active' : 'Inactive') : '-'} />
              <Field label="Timezone" value={bot.timezone || '-'} />
              {bot.createdAt && <Field label="Onboarded" value={new Date(bot.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })} />}
            </div>
          )}
        </div>

        {/* Change Password */}
        <div className="rounded-xl border border-white/10 p-6 lg:col-span-2" style={{ background: 'var(--color-surface)' }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Change Password</h2>
          <form onSubmit={changePwd} className="max-w-md space-y-4">
            <PwdField label="Current Password" value={currentPwd} onChange={setCurrentPwd} />
            <PwdField label="New Password" value={newPwd} onChange={setNewPwd} />
            <PwdField label="Confirm New Password" value={confirmPwd} onChange={setConfirmPwd} />
            {msg && <p className={`text-xs ${msg.includes('success') ? 'text-green-500' : 'text-red-400'}`}>{msg}</p>}
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm rounded-lg text-white disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >{saving ? 'Saving…' : 'Update Password'}</button>
          </form>
        </div>
      </div>
    </DashboardLayout>
  )
}

function Field({ label, value }) {
  return (
    <div className="flex items-start gap-4">
      <span className="text-xs opacity-80 w-28 shrink-0" style={{ color: 'var(--color-text)' }}>{label}</span>
      <span style={{ color: 'var(--color-text)' }}>{value}</span>
    </div>
  )
}

function PwdField({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs mb-1 opacity-80" style={{ color: 'var(--color-text)' }}>{label}</label>
      <input type="password" value={value} onChange={e => onChange(e.target.value)} required
        className="w-full px-3 py-2 text-sm rounded-lg border border-white/10 bg-transparent outline-none focus:border-white/30"
        style={{ color: 'var(--color-text)' }}
      />
    </div>
  )
}
