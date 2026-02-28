'use client'
import { useState } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, SlideOver, Modal, ConfirmDialog, FormField, FormInput, FormSelect } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatNumber, formatDate } from '../../../lib/format'
const { apiFetch } = require('../../../lib/api')

const EMPTY_RESELLER = {
  name: '', slug: '', email: '', phone: '',
  pricing: { setupCost: 0, perBotCost: 0, monthlyPerBot: 0, botSlots: 5 },
  platformFeeStatus: 'trial',
  themeConfig: { brandName: 'Dashboard', primaryColor: '#0ea5e9', accentColor: '#38bdf8', backgroundColor: '#f0f9ff', sidebarColor: '#ffffff', textColor: '#0f172a', showPlatformCredit: false },
}

export default function SuperAdminResellers() {
  const { data, loading, refetch } = useFetch('/api/superadmin/resellers', [])
  const [editOpen, setEditOpen] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState(EMPTY_RESELLER)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState(null)

  const resellers = Array.isArray(data) ? data : (data?.resellers || data || [])

  function openCreate() {
    setForm(JSON.parse(JSON.stringify(EMPTY_RESELLER)))
    setIsNew(true); setMsg(''); setEditOpen(true)
  }

  function openEdit(r) {
    setForm({
      _id: r._id, name: r.name || '', slug: r.slug || '', email: r.email || '', phone: r.phone || '',
      pricing: { setupCost: r.pricing?.setupCost || 0, perBotCost: r.pricing?.perBotCost || 0, monthlyPerBot: r.pricing?.monthlyPerBot || 0, botSlots: r.pricing?.botSlots || 5 },
      platformFeeStatus: r.platformFeeStatus || 'trial',
      themeConfig: { brandName: r.themeConfig?.brandName || '', primaryColor: r.themeConfig?.primaryColor || '#0ea5e9', accentColor: r.themeConfig?.accentColor || '#38bdf8', backgroundColor: r.themeConfig?.backgroundColor || '#f0f9ff', sidebarColor: r.themeConfig?.sidebarColor || '#ffffff', textColor: r.themeConfig?.textColor || '#0f172a', logoUrl: r.themeConfig?.logoUrl || '', faviconUrl: r.themeConfig?.faviconUrl || '', supportEmail: r.themeConfig?.supportEmail || '', supportPhone: r.themeConfig?.supportPhone || '', showPlatformCredit: !!r.themeConfig?.showPlatformCredit },
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
      if (isNew) {
        await apiFetch('/api/superadmin/resellers', { method: 'POST', body: JSON.stringify(form) })
      } else {
        const { _id, ...body } = form
        await apiFetch(`/api/superadmin/resellers/${_id}`, { method: 'PATCH', body: JSON.stringify(body) })
      }
      setEditOpen(false); refetch()
    } catch (err) { setMsg(err.message) }
    setSaving(false)
  }

  async function toggleActive(r) {
    try {
      if (r.isActive) {
        await apiFetch(`/api/superadmin/resellers/${r._id}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/superadmin/resellers/${r._id}/reactivate`, { method: 'POST' })
      }
      refetch()
    } catch (err) { alert(err.message) }
    setConfirmOpen(false); setConfirmTarget(null)
  }

  return (
    <DashboardLayout requiredRole="superadmin">
      <TopBar title="Resellers" breadcrumbs={['Home', 'Resellers']}
        action={<button onClick={openCreate} className="px-4 py-2 text-sm rounded-lg font-medium text-white" style={{ background: 'var(--color-primary)' }}>+ New Reseller</button>} />

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 w-full rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-surface)' }}>
          <table className="w-full text-sm">
            <thead><tr className="text-xs uppercase tracking-wider opacity-40 border-b border-white/10">
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Pricing</th>
              <th className="p-3 text-left">Bots</th>
              <th className="p-3 text-left">Clients</th>
              <th className="p-3 text-left">Leads</th>
              <th className="p-3 text-left">Revenue</th>
              <th className="p-3 text-left">Fee</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {resellers.map(r => (
                <tr key={r._id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3"><p className="font-medium" style={{ color: 'var(--color-text)' }}>{r.name}</p><p className="text-[10px] opacity-40">{r.slug}</p></td>
                  <td className="p-3 text-xs" style={{ color: 'var(--color-text)' }}>₹{formatNumber(r.pricing?.monthlyPerBot || 0)}/mo/bot</td>
                  <td className="p-3 text-xs" style={{ color: 'var(--color-text)' }}>{r.botSlotsUsed ?? r.activeClients ?? 0}/{r.pricing?.botSlots || 5}</td>
                  <td className="p-3" style={{ color: 'var(--color-text)' }}>{formatNumber(r.activeClients)}</td>
                  <td className="p-3" style={{ color: 'var(--color-text)' }}>{formatNumber(r.leadsThisMonth)}</td>
                  <td className="p-3 font-medium" style={{ color: 'var(--color-primary)' }}>₹{formatNumber(r.revenue)}</td>
                  <td className="p-3"><Badge score={r.platformFeeStatus === 'paid' ? 'confirmed' : r.platformFeeStatus === 'overdue' ? 'error' : 'pending'} /></td>
                  <td className="p-3"><Badge score={r.isActive ? 'active' : 'cancelled'} /></td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => { setSelected(r); setDetailOpen(true) }} className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10" style={{ color: 'var(--color-text)' }}>View</button>
                      <button onClick={() => openEdit(r)} className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10" style={{ color: 'var(--color-primary)' }}>Edit</button>
                      <button onClick={() => { setConfirmTarget(r); setConfirmOpen(true) }} className={`text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10 ${r.isActive ? 'text-red-400' : 'text-green-400'}`}>
                        {r.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {resellers.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-xs opacity-40">No resellers yet</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Form */}
      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title={isNew ? 'Create Reseller' : 'Edit Reseller'}>
        <div className="space-y-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Basic Info</h3>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Name"><FormInput value={form.name} onChange={v => set('name', v)} placeholder="WellTechUp" required /></FormField>
            <FormField label="Slug"><FormInput value={form.slug} onChange={v => set('slug', v)} placeholder="welltechup" required disabled={!isNew} /></FormField>
            <FormField label="Email"><FormInput value={form.email} onChange={v => set('email', v)} placeholder="admin@welltechup.com" type="email" required /></FormField>
            <FormField label="Phone"><FormInput value={form.phone} onChange={v => set('phone', v)} placeholder="+91 9876543210" /></FormField>
          </div>

          <hr className="border-white/10" />
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Custom Pricing</h3>
          <p className="text-[11px] opacity-50" style={{ color: 'var(--color-text)' }}>Set custom pricing for this reseller. All prices in ₹.</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="One-Time Setup Cost (₹)" hint="Charged once for whole system"><FormInput value={form.pricing?.setupCost} onChange={v => set('pricing.setupCost', parseInt(v) || 0)} type="number" /></FormField>
            <FormField label="One-Time Per Bot (₹)" hint="Charged once per new bot"><FormInput value={form.pricing?.perBotCost} onChange={v => set('pricing.perBotCost', parseInt(v) || 0)} type="number" /></FormField>
            <FormField label="Monthly Per Bot (₹)" hint="Recurring monthly maintenance"><FormInput value={form.pricing?.monthlyPerBot} onChange={v => set('pricing.monthlyPerBot', parseInt(v) || 0)} type="number" /></FormField>
            <FormField label="Max Bot Slots"><FormInput value={form.pricing?.botSlots} onChange={v => set('pricing.botSlots', parseInt(v) || 1)} type="number" /></FormField>
          </div>
          <FormField label="Platform Fee Status"><FormSelect value={form.platformFeeStatus} onChange={v => set('platformFeeStatus', v)} options={[{value:'trial',label:'Trial'},{value:'paid',label:'Paid'},{value:'overdue',label:'Overdue'}]} /></FormField>

          <hr className="border-white/10" />
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">White-Label Theme</h3>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Brand Name"><FormInput value={form.themeConfig?.brandName} onChange={v => set('themeConfig.brandName', v)} /></FormField>
            <FormField label="Logo URL"><FormInput value={form.themeConfig?.logoUrl} onChange={v => set('themeConfig.logoUrl', v)} placeholder="https://..." /></FormField>
            <FormField label="Primary Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.themeConfig?.primaryColor || '#0ea5e9'} onChange={e => set('themeConfig.primaryColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                <FormInput value={form.themeConfig?.primaryColor} onChange={v => set('themeConfig.primaryColor', v)} />
              </div>
            </FormField>
            <FormField label="Accent Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.themeConfig?.accentColor || '#38bdf8'} onChange={e => set('themeConfig.accentColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                <FormInput value={form.themeConfig?.accentColor} onChange={v => set('themeConfig.accentColor', v)} />
              </div>
            </FormField>
            <FormField label="Background Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.themeConfig?.backgroundColor || '#f0f9ff'} onChange={e => set('themeConfig.backgroundColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                <FormInput value={form.themeConfig?.backgroundColor} onChange={v => set('themeConfig.backgroundColor', v)} />
              </div>
            </FormField>
            <FormField label="Sidebar Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.themeConfig?.sidebarColor || '#ffffff'} onChange={e => set('themeConfig.sidebarColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                <FormInput value={form.themeConfig?.sidebarColor} onChange={v => set('themeConfig.sidebarColor', v)} />
              </div>
            </FormField>
            <FormField label="Text Color">
              <div className="flex gap-2 items-center">
                <input type="color" value={form.themeConfig?.textColor || '#0f172a'} onChange={e => set('themeConfig.textColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
                <FormInput value={form.themeConfig?.textColor} onChange={v => set('themeConfig.textColor', v)} />
              </div>
            </FormField>
            <FormField label="Favicon URL"><FormInput value={form.themeConfig?.faviconUrl} onChange={v => set('themeConfig.faviconUrl', v)} /></FormField>
            <FormField label="Support Email"><FormInput value={form.themeConfig?.supportEmail} onChange={v => set('themeConfig.supportEmail', v)} /></FormField>
            <FormField label="Support Phone"><FormInput value={form.themeConfig?.supportPhone} onChange={v => set('themeConfig.supportPhone', v)} /></FormField>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={!!form.themeConfig?.showPlatformCredit} onChange={e => set('themeConfig.showPlatformCredit', e.target.checked)} className="rounded" />
            Show &quot;Platform by AyKa&quot; credit
          </label>

          {msg && <p className="text-xs text-red-500">{msg}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>Cancel</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{saving ? 'Saving…' : isNew ? 'Create Reseller' : 'Save Changes'}</button>
          </div>
        </div>
      </SlideOver>

      {/* Detail View — text forced to white for dark bg */}
      <SlideOver open={detailOpen} onClose={() => setDetailOpen(false)} title="Reseller Details">
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-400">Name</p><p className="font-medium text-white">{selected.name}</p></div>
              <div><p className="text-xs text-gray-400">Slug</p><p className="text-white">{selected.slug}</p></div>
              <div><p className="text-xs text-gray-400">Email</p><p className="text-white">{selected.email}</p></div>
              <div><p className="text-xs text-gray-400">Phone</p><p className="text-white">{selected.phone || '—'}</p></div>
            </div>
            <hr className="border-white/10" />
            <h3 className="font-semibold text-xs text-gray-400 uppercase">Custom Pricing</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-400">Setup Cost</p><p className="text-white">₹{formatNumber(selected.pricing?.setupCost || 0)}</p></div>
              <div><p className="text-xs text-gray-400">Per Bot (One-Time)</p><p className="text-white">₹{formatNumber(selected.pricing?.perBotCost || 0)}</p></div>
              <div><p className="text-xs text-gray-400">Monthly / Bot</p><p className="text-white">₹{formatNumber(selected.pricing?.monthlyPerBot || 0)}</p></div>
              <div><p className="text-xs text-gray-400">Max Bot Slots</p><p className="text-white">{selected.pricing?.botSlots || 5}</p></div>
            </div>
            <hr className="border-white/10" />
            <h3 className="font-semibold text-xs text-gray-400 uppercase">Stats</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-400">Active Clients</p><p className="font-bold text-lg text-white">{formatNumber(selected.activeClients)}</p></div>
              <div><p className="text-xs text-gray-400">Leads This Month</p><p className="font-bold text-lg text-white">{formatNumber(selected.leadsThisMonth)}</p></div>
              <div><p className="text-xs text-gray-400">Hot Leads</p><p className="font-bold text-lg text-red-400">{formatNumber(selected.hotLeads)}</p></div>
              <div><p className="text-xs text-gray-400">Revenue</p><p className="font-bold text-lg text-green-400">₹{formatNumber(selected.revenue)}</p></div>
            </div>
            <hr className="border-white/10" />
            <h3 className="font-semibold text-xs text-gray-400 uppercase">Theme Preview</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-400">Brand</p><p className="text-white">{selected.themeConfig?.brandName || '—'}</p></div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-400">Colors</p>
                <span className="w-4 h-4 rounded-full border border-white/20" style={{ background: selected.themeConfig?.primaryColor }} />
                <span className="w-4 h-4 rounded-full border border-white/20" style={{ background: selected.themeConfig?.accentColor }} />
                <span className="w-4 h-4 rounded-full border border-white/20" style={{ background: selected.themeConfig?.backgroundColor }} />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => { setDetailOpen(false); openEdit(selected) }} className="flex-1 px-4 py-2 text-sm rounded-lg font-medium text-white" style={{ background: 'var(--color-primary)' }}>Edit Reseller</button>
            </div>
          </div>
        )}
      </SlideOver>

      {/* Deactivate Confirm */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmTarget(null) }}
        onConfirm={() => toggleActive(confirmTarget)}
        title={confirmTarget?.isActive ? 'Deactivate Reseller?' : 'Reactivate Reseller?'}
        message={confirmTarget?.isActive
          ? `This will deactivate "${confirmTarget?.name}" and ALL their clients and users. They will lose dashboard access immediately.`
          : `This will reactivate "${confirmTarget?.name}". You'll need to reactivate their clients separately.`}
        confirmLabel={confirmTarget?.isActive ? 'Deactivate' : 'Reactivate'}
        destructive={confirmTarget?.isActive}
      />
    </DashboardLayout>
  )
}
