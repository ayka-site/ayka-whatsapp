'use client'
import { useState } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, SlideOver, ConfirmDialog, FormField, FormInput, FormSelect } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatNumber, relativeTime } from '../../../lib/format'
const { apiFetch, API_URL } = require('../../../lib/api')

const VERTICALS = [
  { value: 'school', label: 'School' },
  { value: 'realestate', label: 'Real Estate' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'msme', label: 'MSME' },
  { value: 'coaching', label: 'Coaching' },
]

const EMPTY_CLIENT = {
  resellerId: '', name: '', slug: '', vertical: 'school',
  whatsapp: { phoneNumberId: '', accessToken: '', wabaId: '', verifyToken: '' },
  settings: {
    displayName: '',
    timezone: 'Asia/Kolkata',
    language: 'en',
    handoffPhone: '',
    dashboardHandoffReplyEnabled: true,
    allowPaidReplies: false,
  },
  subscription: { status: 'active' },
  pricing: { totalPrice: 0, note: '' },
  isDirect: false,
  widget: { enabled: false },
}

export default function SuperAdminClients() {
  const [reseller, setReseller] = useState('')
  const url = `/api/superadmin/clients${reseller ? `?resellerId=${reseller}` : ''}`
  const { data, loading, refetch } = useFetch(url, [reseller])
  const { data: resellerList } = useFetch('/api/superadmin/resellers', [])

  const [editOpen, setEditOpen] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState(EMPTY_CLIENT)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [copiedClientId, setCopiedClientId] = useState('')

  const clients = Array.isArray(data) ? data : (data?.clients || data || [])
  const resellers = Array.isArray(resellerList) ? resellerList : (resellerList?.resellers || resellerList || [])

  function openCreate() {
    setForm(JSON.parse(JSON.stringify(EMPTY_CLIENT)))
    setIsNew(true); setMsg(''); setEditOpen(true)
  }

  function openEdit(c) {
    const isDirect = !c.resellerId && !c.resellerId?._id
    setForm({
      _id: c._id,
      resellerId: c.resellerId?._id || c.resellerId || '',
      name: c.name || '', slug: c.slug || '', vertical: c.vertical || 'school',
      whatsapp: {
        phoneNumberId: c.whatsapp?.phoneNumberId || '',
        accessToken: c.whatsapp?.accessToken || '',
        wabaId: c.whatsapp?.wabaId || '',
        verifyToken: c.whatsapp?.verifyToken || '',
      },
      settings: {
        displayName: c.settings?.displayName || '',
        timezone: c.settings?.timezone || 'Asia/Kolkata',
        language: c.settings?.language || 'en',
        handoffPhone: c.settings?.handoffPhone || '',
        agentName: c.settings?.agentName || '',
        dashboardHandoffReplyEnabled: c.settings?.dashboardHandoffReplyEnabled !== false,
        allowPaidReplies: !!c.settings?.allowPaidReplies,
      },
      subscription: { status: c.subscription?.status || 'active' },
      pricing: { totalPrice: c.pricing?.totalPrice || 0, note: c.pricing?.note || '' },
      isDirect,
      widget: { enabled: c.widget?.enabled || false },
    })
    setIsNew(false); setMsg(''); setEditOpen(true)
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

  async function save() {
    setMsg(''); setSaving(true)
    try {
      const body = { ...form }
      // If direct client, remove resellerId
      if (body.isDirect) { body.resellerId = null }
      delete body.isDirect
      if (!body.resellerId) delete body.resellerId

      if (isNew) {
        await apiFetch('/api/superadmin/clients', { method: 'POST', body: JSON.stringify(body) })
      } else {
        const { _id, ...rest } = body
        await apiFetch(`/api/superadmin/clients/${_id}`, { method: 'PATCH', body: JSON.stringify(rest) })
      }
      setEditOpen(false); refetch()
    } catch (err) { setMsg(err.message) }
    setSaving(false)
  }

  async function toggleActive(c) {
    try {
      if (c.isActive) {
        await apiFetch(`/api/superadmin/clients/${c._id}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/superadmin/clients/${c._id}/reactivate`, { method: 'POST' })
      }
      refetch()
    } catch (err) { alert(err.message) }
    setConfirmOpen(false); setConfirmTarget(null)
  }

  function getWidgetEmbedCode(client) {
    return `<script src="${API_URL}/widget/embed/ayka-widget.js"\n  data-business-id="${client._id}"\n  data-api-url="${API_URL}"></script>`
  }

  async function copyWidgetCode(client) {
    try {
      await navigator.clipboard.writeText(getWidgetEmbedCode(client))
      setCopiedClientId(client._id)
      setTimeout(() => setCopiedClientId(''), 2000)
    } catch (err) {
      alert('Copy failed. Please copy manually from browser permissions enabled environment.')
    }
  }

  return (
    <DashboardLayout requiredRole="superadmin">
      <TopBar title="All Clients" breadcrumbs={['Home', 'Clients']}
        action={<button onClick={openCreate} className="px-4 py-2 text-sm rounded-lg font-medium text-white" style={{ background: 'var(--color-primary)' }}>+ New Client</button>} />

      <div className="flex gap-3 mb-4">
        <select value={reseller} onChange={e => setReseller(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-lg border border-white/10"
          style={{ color: 'var(--color-text)', backgroundColor: '#1a1a2e' }}>
          <option value="" style={{ background: '#1a1a2e', color: '#e2e8f0' }}>All Resellers</option>
          <option value="direct" style={{ background: '#1a1a2e', color: '#e2e8f0' }}>⚡ Direct Clients</option>
          {resellers.map(r => <option key={r._id} value={r._id} style={{ background: '#1a1a2e', color: '#e2e8f0' }}>{r.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-surface)' }}>
          <table className="w-full text-sm">
            <thead><tr className="text-xs uppercase tracking-wider opacity-40 border-b border-white/10">
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Reseller</th>
              <th className="p-3 text-left">Vertical</th>
              <th className="p-3 text-left">Leads</th>
              <th className="p-3 text-left">Hot</th>
              <th className="p-3 text-left">Last Active</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Widget</th>
              <th className="p-3 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {clients.map(c => (
                <tr key={c._id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3"><p className="font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</p><p className="text-[10px] opacity-40">{c.slug}</p></td>
                  <td className="p-3 text-xs opacity-60">{c.resellerName || <span className="text-yellow-400">Direct</span>}</td>
                  <td className="p-3 text-xs capitalize" style={{ color: 'var(--color-text)' }}>{c.vertical || '-'}</td>
                  <td className="p-3" style={{ color: 'var(--color-text)' }}>{formatNumber(c.leads?.total || 0)}</td>
                  <td className="p-3"><span className="text-red-400 font-medium">{formatNumber(c.leads?.hot || 0)}</span></td>
                  <td className="p-3 text-xs opacity-50">{c.lastActivity ? relativeTime(c.lastActivity) : '-'}</td>
                  <td className="p-3"><Badge score={c.isActive ? 'active' : 'cancelled'} /></td>
                  <td className="p-3">
                    {c.widget?.enabled
                      ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400">🔌 On</span>
                      : <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 opacity-40">Off</span>}
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openEdit(c)} className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10" style={{ color: 'var(--color-primary)' }}>Edit</button>
                      <button onClick={() => copyWidgetCode(c)} className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-cyan-400">
                        {copiedClientId === c._id ? 'Copied' : 'Copy Code'}
                      </button>
                      <button onClick={() => { setConfirmTarget(c); setConfirmOpen(true) }} className={`text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10 ${c.isActive ? 'text-red-400' : 'text-green-400'}`}>
                        {c.isActive ? 'Pause' : 'Resume'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-xs opacity-40">No clients found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Form */}
      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title={isNew ? 'Create Client' : 'Edit Client'}>
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Client Type</h3>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={!!form.isDirect} onChange={e => {
              const d = e.target.checked
              setForm(p => ({ ...p, isDirect: d, resellerId: d ? '' : p.resellerId }))
            }} className="rounded" />
            Direct Client (no reseller - single bot, flat pricing)
          </label>

          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Basic Info</h3>
          <div className="grid grid-cols-2 gap-3">
            {!form.isDirect && (
              <FormField label="Reseller">
                <FormSelect value={form.resellerId} onChange={v => set('resellerId', v)} placeholder="Select reseller…"
                  options={resellers.filter(r => r.isActive).map(r => ({ value: r._id, label: r.name }))} />
              </FormField>
            )}
            <FormField label="Vertical"><FormSelect value={form.vertical} onChange={v => set('vertical', v)} options={VERTICALS} /></FormField>
            <FormField label="Business Name"><FormInput value={form.name} onChange={v => set('name', v)} placeholder="DPS Bahraich" required /></FormField>
            <FormField label="Slug"><FormInput value={form.slug} onChange={v => set('slug', v)} placeholder="dps-bahraich" required disabled={!isNew} /></FormField>
          </div>

          <hr className="border-white/10" />
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">WhatsApp Config</h3>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Phone Number ID"><FormInput value={form.whatsapp?.phoneNumberId} onChange={v => set('whatsapp.phoneNumberId', v)} required /></FormField>
            <FormField label="Access Token"><FormInput value={form.whatsapp?.accessToken} onChange={v => set('whatsapp.accessToken', v)} type="password" required /></FormField>
            <FormField label="WABA ID"><FormInput value={form.whatsapp?.wabaId} onChange={v => set('whatsapp.wabaId', v)} required /></FormField>
            <FormField label="Verify Token"><FormInput value={form.whatsapp?.verifyToken} onChange={v => set('whatsapp.verifyToken', v)} required /></FormField>
          </div>

          <hr className="border-white/10" />
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Settings</h3>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Display Name"><FormInput value={form.settings?.displayName} onChange={v => set('settings.displayName', v)} /></FormField>
            <FormField label="Agent Name"><FormInput value={form.settings?.agentName} onChange={v => set('settings.agentName', v)} /></FormField>
            <FormField label="Timezone"><FormInput value={form.settings?.timezone} onChange={v => set('settings.timezone', v)} /></FormField>
            <FormField label="Language"><FormSelect value={form.settings?.language} onChange={v => set('settings.language', v)} options={[{value:'en',label:'English'},{value:'hi',label:'Hindi'},{value:'hinglish',label:'Hinglish'}]} /></FormField>
          <div className="grid grid-cols-1 gap-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={form.settings?.dashboardHandoffReplyEnabled !== false} onChange={e => set('settings.dashboardHandoffReplyEnabled', e.target.checked)} className="rounded" />
              Enable dashboard handoff reply
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={!!form.settings?.allowPaidReplies} onChange={e => set('settings.allowPaidReplies', e.target.checked)} className="rounded" />
              Allow paid replies after 24-hour free window
            </label>
          </div>
            <FormField label="Handoff Phone"><FormInput value={form.settings?.handoffPhone} onChange={v => set('settings.handoffPhone', v)} placeholder="+91..." /></FormField>
          </div>

          <hr className="border-white/10" />
          {form.isDirect ? (
            <>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Pricing (Direct Client)</h3>
              <p className="text-[11px] opacity-50" style={{ color: 'var(--color-text)' }}>Single bot - set total price instead of breakdown.</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Total Price (₹)"><FormInput value={form.pricing?.totalPrice} onChange={v => set('pricing.totalPrice', parseInt(v) || 0)} type="number" /></FormField>
                <FormField label="Pricing Note"><FormInput value={form.pricing?.note} onChange={v => set('pricing.note', v)} placeholder="Custom deal terms…" /></FormField>
              </div>
            </>
          ) : (
            <>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Subscription</h3>
              <p className="text-[11px] opacity-50" style={{ color: 'var(--color-text)' }}>Pricing inherited from reseller. Only manage status here.</p>
            </>
          )}
          <FormField label="Status"><FormSelect value={form.subscription?.status} onChange={v => set('subscription.status', v)} options={[{value:'active',label:'Active'},{value:'expired',label:'Expired'},{value:'cancelled',label:'Cancelled'}]} /></FormField>

          <hr className="border-white/10" />
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Web Widget</h3>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={!!form.widget?.enabled} onChange={e => set('widget.enabled', e.target.checked)} className="rounded" />
            Enable embeddable web chat widget for this client
          </label>

          {msg && <p className="text-xs text-red-500">{msg}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>Cancel</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{saving ? 'Saving…' : isNew ? 'Create Client' : 'Save Changes'}</button>
          </div>
        </div>
      </SlideOver>

      {/* Toggle Confirm */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmTarget(null) }}
        onConfirm={() => toggleActive(confirmTarget)}
        title={confirmTarget?.isActive ? 'Pause Client Bot?' : 'Resume Client Bot?'}
        message={confirmTarget?.isActive
          ? `This will deactivate "${confirmTarget?.name}" and their bot will stop responding. Users will also be deactivated.`
          : `This will reactivate "${confirmTarget?.name}" and their bot.`}
        confirmLabel={confirmTarget?.isActive ? 'Pause Bot' : 'Resume Bot'}
        destructive={confirmTarget?.isActive}
      />
    </DashboardLayout>
  )
}
