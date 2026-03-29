'use client'
import { useState, useRef } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, FormField, FormInput, FormSelect } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
const { apiFetch } = require('../../../lib/api')

const DEFAULT_THEME = {
  primaryColor: '#0ea5e9', headerBg: '#0f172a', headerText: '#ffffff',
  chatBg: '#f8fafc', userBubble: '#0ea5e9', userText: '#ffffff',
  botBubble: '#ffffff', botText: '#1e293b', fontFamily: 'system-ui, -apple-system, sans-serif',
  borderRadius: '16px', buttonSize: '60px',
}

export default function AdminWidgetPage() {
  const { data: clients, loading } = useFetch('/api/admin/clients', [])
  const [selectedClient, setSelectedClient] = useState(null)
  const [widgetData, setWidgetData] = useState(null)
  const [widgetLoading, setWidgetLoading] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const clientList = Array.isArray(clients) ? clients : (clients?.clients || [])

  async function loadWidget(clientId) {
    setWidgetLoading(true)
    setMsg('')
    try {
      const data = await apiFetch(`/api/admin/clients/${clientId}/widget`)
      setWidgetData(data)
      setForm({
        enabled: data.widget?.enabled ?? false,
        position: data.widget?.position || 'bottom-right',
        welcomeMessage: data.widget?.welcomeMessage || 'Hi there! How can I help you today?',
        placeholder: data.widget?.placeholder || 'Type a message…',
        agentName: data.widget?.agentName || '',
        agentAvatar: data.widget?.agentAvatar || '',
        brandName: data.widget?.brandName || data.name || '',
        poweredBy: data.widget?.poweredBy ?? true,
        collectName: data.widget?.collectName ?? true,
        collectEmail: data.widget?.collectEmail ?? false,
        collectPhone: data.widget?.collectPhone ?? false,
        allowedOrigins: (data.widget?.allowedOrigins || []).join('\n'),
        theme: { ...DEFAULT_THEME, ...(data.widget?.theme || {}) },
      })
    } catch (err) { setMsg(err.message) }
    setWidgetLoading(false)
  }

  function selectClient(id) {
    const c = clientList.find(c => c._id === id)
    setSelectedClient(c)
    if (c) loadWidget(c._id)
  }

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

  async function saveWidget() {
    setSaving(true); setMsg('')
    try {
      const body = {
        ...form,
        allowedOrigins: form.allowedOrigins
          ? form.allowedOrigins.split('\n').map(s => s.trim()).filter(Boolean)
          : [],
      }
      await apiFetch(`/api/admin/clients/${selectedClient._id}/widget`, {
        method: 'PATCH',
        body: JSON.stringify({ widget: body }),
      })
      setMsg('Widget settings saved successfully!')
      setTimeout(() => setMsg(''), 3000)
    } catch (err) { setMsg(err.message) }
    setSaving(false)
  }

  const t = form.theme || DEFAULT_THEME

  return (
    <DashboardLayout requiredRole="reseller">
      <TopBar title="Web Widget" breadcrumbs={['Home', 'Web Widget']} />

      {/* Client Selector */}
      <div className="mb-6">
        <div className="rounded-xl border border-white/10 p-4" style={{ background: 'var(--color-surface)' }}>
          <label className="block text-xs font-semibold mb-2 opacity-60" style={{ color: 'var(--color-text)' }}>Select Client</label>
          <select
            value={selectedClient?._id || ''}
            onChange={e => selectClient(e.target.value)}
            className="w-full max-w-md px-3 py-2 text-sm rounded-lg border border-white/10"
            style={{ color: 'var(--color-text)', backgroundColor: '#1a1a2e' }}
          >
            <option value="" style={{ background: '#1a1a2e', color: '#e2e8f0' }}>Choose a client…</option>
            {clientList.map(c => (
              <option key={c._id} value={c._id} style={{ background: '#1a1a2e', color: '#e2e8f0' }}>
                {c.name} {c.isActive ? '' : '(Paused)'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedClient && !loading && (
        <div className="text-center py-16 opacity-40">
          <p className="text-4xl mb-3">🔌</p>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>Select a client above to configure their web chat widget</p>
        </div>
      )}

      {widgetLoading && (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}
        </div>
      )}

      {selectedClient && !widgetLoading && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">

            {/* Enable / General */}
            <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Widget Status</h2>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs" style={{ color: 'var(--color-text)' }}>{form.enabled ? 'Enabled' : 'Disabled'}</span>
                  <div className="relative">
                    <input type="checkbox" className="sr-only peer" checked={!!form.enabled} onChange={e => set('enabled', e.target.checked)} />
                    <div className="w-10 h-5 rounded-full peer-focus:ring-2 transition-colors" style={{ background: form.enabled ? 'var(--color-primary)' : 'rgba(255,255,255,0.15)' }} />
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.enabled ? 'translate-x-5' : ''}`} />
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Agent Name" hint="Name shown in widget header">
                  <FormInput value={form.agentName} onChange={v => set('agentName', v)} placeholder="AI Assistant" />
                </FormField>
                <FormField label="Brand Name" hint="Subtitle in header">
                  <FormInput value={form.brandName} onChange={v => set('brandName', v)} placeholder="Your Company" />
                </FormField>
                <FormField label="Welcome Message">
                  <FormInput value={form.welcomeMessage} onChange={v => set('welcomeMessage', v)} />
                </FormField>
                <FormField label="Input Placeholder">
                  <FormInput value={form.placeholder} onChange={v => set('placeholder', v)} />
                </FormField>
                <FormField label="Agent Avatar URL">
                  <FormInput value={form.agentAvatar} onChange={v => set('agentAvatar', v)} placeholder="https://..." />
                </FormField>
                <FormField label="Position">
                  <FormSelect value={form.position} onChange={v => set('position', v)}
                    options={[{ value: 'bottom-right', label: 'Bottom Right' }, { value: 'bottom-left', label: 'Bottom Left' }]} />
                </FormField>
              </div>

              <div className="flex gap-6 mt-4">
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={!!form.collectName} onChange={e => set('collectName', e.target.checked)} className="rounded" />
                  Collect Name
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={!!form.collectEmail} onChange={e => set('collectEmail', e.target.checked)} className="rounded" />
                  Collect Email
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={!!form.collectPhone} onChange={e => set('collectPhone', e.target.checked)} className="rounded" />
                  Collect Phone
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={form.poweredBy !== false} onChange={e => set('poweredBy', e.target.checked)} className="rounded" />
                  Show "Powered by AyKa"
                </label>
              </div>
            </div>

            {/* Theme Colors */}
            <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Theme & Colors</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {[
                  { key: 'primaryColor', label: 'Primary / Button' },
                  { key: 'headerBg', label: 'Header Background' },
                  { key: 'headerText', label: 'Header Text' },
                  { key: 'chatBg', label: 'Chat Background' },
                  { key: 'userBubble', label: 'User Bubble' },
                  { key: 'userText', label: 'User Text' },
                  { key: 'botBubble', label: 'Bot Bubble' },
                  { key: 'botText', label: 'Bot Text' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-[11px] mb-1 opacity-50" style={{ color: 'var(--color-text)' }}>{label}</label>
                    <div className="flex items-center gap-2">
                      <input type="color" value={t[key] || '#000000'} onChange={e => set(`theme.${key}`, e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-white/10 bg-transparent" />
                      <input type="text" value={t[key] || ''} onChange={e => set(`theme.${key}`, e.target.value)}
                        className="flex-1 px-2 py-1.5 text-xs rounded border border-white/10 bg-transparent outline-none"
                        style={{ color: 'var(--color-text)' }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4">
                <FormField label="Font Family" hint="CSS font-family value"><FormInput value={t.fontFamily} onChange={v => set('theme.fontFamily', v)} /></FormField>
                <FormField label="Border Radius" hint="e.g. 16px"><FormInput value={t.borderRadius} onChange={v => set('theme.borderRadius', v)} /></FormField>
                <FormField label="Button Size" hint="e.g. 60px"><FormInput value={t.buttonSize} onChange={v => set('theme.buttonSize', v)} /></FormField>
              </div>
            </div>

            {/* Security — Allowed Origins */}
            <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
              <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Security — Allowed Origins</h2>
              <p className="text-[11px] opacity-40 mb-3" style={{ color: 'var(--color-text)' }}>
                Enter one origin per line (e.g. https://example.com). Leave blank to allow all origins.
              </p>
              <textarea value={form.allowedOrigins || ''} onChange={e => set('allowedOrigins', e.target.value)}
                rows={4} className="w-full px-3 py-2 text-sm rounded-lg border border-white/10 bg-transparent outline-none focus:border-white/30 font-mono"
                style={{ color: 'var(--color-text)' }} placeholder={"https://yoursite.com\nhttps://www.yoursite.com"} />
            </div>

            {/* Embed Code */}
            <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Embed Code</h2>
              <p className="text-xs opacity-70" style={{ color: 'var(--color-text)' }}>
                For security and provisioning control, widget embed code is shared by Superadmin only.
              </p>
              <p className="text-[11px] opacity-40 mt-2" style={{ color: 'var(--color-text)' }}>
                Ask Superadmin for your business embed snippet.
              </p>
            </div>

            {/* Save Button */}
            <div className="flex items-center gap-3">
              <button onClick={saveWidget} disabled={saving} className="px-6 py-2.5 text-sm rounded-lg font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--color-primary)' }}>
                {saving ? 'Saving…' : '💾 Save Widget Settings'}
              </button>
              {msg && <span className={`text-xs ${msg.includes('success') ? 'text-green-500' : 'text-red-400'}`}>{msg}</span>}
            </div>
          </div>

          {/* Preview Column */}
          <div className="xl:col-span-1">
            <div className="sticky top-6">
              <h3 className="text-xs font-semibold mb-3 opacity-60" style={{ color: 'var(--color-text)' }}>LIVE PREVIEW</h3>
              <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-surface)', height: '560px' }}>
                <div className="h-full flex flex-col">
                  {/* Header */}
                  <div className="flex items-center gap-3 p-4" style={{ background: t.headerBg, color: t.headerText }}>
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: t.primaryColor, color: '#fff' }}>
                      {form.agentAvatar
                        ? <img src={form.agentAvatar} alt="" className="w-full h-full rounded-full object-cover" />
                        : (form.agentName || 'A').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{form.agentName || 'AI Assistant'}</p>
                      <p className="text-[10px] opacity-70">{form.brandName || 'Online'}</p>
                    </div>
                  </div>
                  {/* Messages */}
                  <div className="flex-1 p-4 space-y-2 overflow-y-auto" style={{ background: t.chatBg }}>
                    {form.welcomeMessage && (
                      <div className="max-w-[80%] px-3 py-2 rounded-xl text-xs" style={{ background: t.botBubble, color: t.botText, borderBottomLeftRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                        {form.welcomeMessage}
                      </div>
                    )}
                    <div className="max-w-[80%] px-3 py-2 rounded-xl text-xs ml-auto" style={{ background: t.userBubble, color: t.userText, borderBottomRightRadius: '4px' }}>
                      I'm interested in learning more
                    </div>
                    <div className="max-w-[80%] px-3 py-2 rounded-xl text-xs" style={{ background: t.botBubble, color: t.botText, borderBottomLeftRadius: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                      Great! I'd be happy to help. Could you tell me a bit more about what you're looking for?
                    </div>
                  </div>
                  {/* Input */}
                  <div className="flex gap-2 p-3 border-t" style={{ borderColor: '#e5e7eb', background: '#fff' }}>
                    <input type="text" readOnly placeholder={form.placeholder || 'Type a message…'}
                      className="flex-1 px-3 py-2 text-xs rounded-full border outline-none"
                      style={{ borderColor: '#e5e7eb', background: '#f9fafb', color: '#333', fontFamily: t.fontFamily }} />
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: t.primaryColor }}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </div>
                  </div>
                  {form.poweredBy !== false && (
                    <div className="text-center py-1 text-[9px]" style={{ color: '#94a3b8', background: '#fff', borderTop: '1px solid #f1f5f9' }}>
                      Powered by AyKa AI
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex items-center justify-center rounded-full"
                  style={{ width: t.buttonSize || '60px', height: t.buttonSize || '60px', background: t.primaryColor, boxShadow: '0 4px 24px rgba(0,0,0,0.25)' }}>
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="#fff"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/><path d="M7 9h10v2H7zm0-3h10v2H7z"/></svg>
                </div>
                <span className="text-xs opacity-50" style={{ color: 'var(--color-text)' }}>← Floating button</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
