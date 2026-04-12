'use client'
import { useState } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, StatCard, SlideOver, ConfirmDialog, FormField, FormInput, FormSelect } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatNumber, relativeTime } from '../../../lib/format'
const { apiFetch } = require('../../../lib/api')

export default function AdminClients() {
  const { data, loading, refetch } = useFetch('/api/admin/clients', [])
  const [scopedClient, setScopedClient] = useState(null)
  const scopedStats = useFetch(scopedClient ? `/api/admin/clients/${scopedClient._id}/stats` : null, [scopedClient])

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [editMsg, setEditMsg] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState(null)

  const clients = Array.isArray(data) ? data : (data?.clients || data || [])

  function openEdit(c) {
    setEditForm({
      _id: c._id, name: c.name || '',
      settings: {
        displayName: c.settings?.displayName || '',
        timezone: c.settings?.timezone || 'Asia/Kolkata',
        language: c.settings?.language || 'en',
        handoffPhone: c.settings?.handoffPhone || '',
        dashboardHandoffReplyEnabled: c.settings?.dashboardHandoffReplyEnabled !== false,
        allowPaidReplies: !!c.settings?.allowPaidReplies,
      },
      subscription: {
        plan: c.subscription?.plan || 'basic',
        status: c.subscription?.status || 'active',
      },
    })
    setEditMsg(''); setEditOpen(true)
  }

  async function saveEdit() {
    setEditMsg(''); setSaving(true)
    try {
      const { _id, ...body } = editForm
      await apiFetch(`/api/admin/clients/${_id}`, { method: 'PATCH', body: JSON.stringify(body) })
      setEditOpen(false); refetch()
      if (scopedClient?._id === _id) setScopedClient(null)
    } catch (err) { setEditMsg(err.message) }
    setSaving(false)
  }

  async function toggleBot(c) {
    try {
      await apiFetch(`/api/admin/clients/${c._id}/bot`, { method: 'PATCH', body: JSON.stringify({ isActive: !c.isActive }) })
      refetch()
    } catch (err) { alert(err.message) }
    setConfirmOpen(false); setConfirmTarget(null)
  }

  if (scopedClient) {
    const s = scopedStats.data || {}
    const st = s.stats || {}
    return (
      <DashboardLayout requiredRole="reseller">
        <TopBar title={scopedClient.name} breadcrumbs={['Home', 'Clients', scopedClient.name]}
          action={<button onClick={() => setScopedClient(null)} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>← Back to Clients</button>}
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Total Leads" value={formatNumber(st.totalLeads)} loading={scopedStats.loading} />
          <StatCard label="Hot Leads" value={formatNumber(st.hotLeads)} loading={scopedStats.loading} />
          <StatCard label="Visits" value={formatNumber(st.visitsConfirmed)} loading={scopedStats.loading} />
          <StatCard label="Handoffs" value={formatNumber(st.handoffs)} loading={scopedStats.loading} />
        </div>
        <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Client Details</h2>
            <div className="flex gap-2">
              <button onClick={() => openEdit(scopedClient)} className="text-xs px-3 py-1.5 rounded-lg font-medium text-white" style={{ background: 'var(--color-primary)' }}>Edit Settings</button>
              <button onClick={() => { setConfirmTarget(scopedClient); setConfirmOpen(true) }} className={`text-xs px-3 py-1.5 rounded-lg font-medium ${scopedClient.isActive ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
                {scopedClient.isActive ? '⏸ Pause Bot' : '▶ Resume Bot'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-xs opacity-40">Business ID</p><p className="font-mono text-xs" style={{ color: 'var(--color-text)' }}>{scopedClient._id}</p></div>
            <div><p className="text-xs opacity-40">Vertical</p><p style={{ color: 'var(--color-text)' }}>{scopedClient.vertical || '-'}</p></div>
            <div><p className="text-xs opacity-40">Status</p><Badge score={scopedClient.isActive ? 'active' : 'paused'} /></div>
            <div><p className="text-xs opacity-40">Plan</p><p style={{ color: 'var(--color-text)' }}>{scopedClient.subscription?.plan || 'basic'}</p></div>
            <div><p className="text-xs opacity-40">Timezone</p><p style={{ color: 'var(--color-text)' }}>{scopedClient.settings?.timezone || scopedClient.timezone || '-'}</p></div>
            <div><p className="text-xs opacity-40">Handoff Phone</p><p style={{ color: 'var(--color-text)' }}>{scopedClient.settings?.handoffPhone || '-'}</p></div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout requiredRole="reseller">
      <TopBar title="Clients" breadcrumbs={['Home', 'Clients']} />

      {loading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 w-full rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-surface)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider opacity-40 border-b border-white/10">
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Vertical</th>
                <th className="p-3 text-left">Leads</th>
                <th className="p-3 text-left">Hot</th>
                <th className="p-3 text-left">Last Active</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c._id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3 font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</td>
                  <td className="p-3 text-xs opacity-50">{c.vertical || '-'}</td>
                  <td className="p-3">{formatNumber(c.leads?.total || 0)}</td>
                  <td className="p-3"><span className="text-red-400 font-medium">{formatNumber(c.leads?.hot || 0)}</span></td>
                  <td className="p-3 text-xs opacity-50">{c.lastActivity ? relativeTime(c.lastActivity) : '-'}</td>
                  <td className="p-3"><Badge score={c.isActive ? 'active' : 'paused'} /></td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => setScopedClient(c)} className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10" style={{ color: 'var(--color-text)' }}>View</button>
                      <button onClick={() => openEdit(c)} className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10" style={{ color: 'var(--color-primary)' }}>Edit</button>
                      <button onClick={() => { setConfirmTarget(c); setConfirmOpen(true) }} className={`text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10 ${c.isActive ? 'text-red-400' : 'text-green-400'}`}>
                        {c.isActive ? 'Pause' : 'Resume'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-xs opacity-40">No clients found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Client Settings */}
      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title="Edit Client Settings">
        <div className="space-y-4">
          <FormField label="Business Name"><FormInput value={editForm.name} onChange={v => setEditForm(p => ({ ...p, name: v }))} /></FormField>
          <hr className="border-gray-200" />
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Settings</h3>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Display Name"><FormInput value={editForm.settings?.displayName} onChange={v => setEditForm(p => ({ ...p, settings: { ...p.settings, displayName: v } }))} /></FormField>
            <FormField label="Timezone"><FormInput value={editForm.settings?.timezone} onChange={v => setEditForm(p => ({ ...p, settings: { ...p.settings, timezone: v } }))} /></FormField>
            <FormField label="Language"><FormSelect value={editForm.settings?.language} onChange={v => setEditForm(p => ({ ...p, settings: { ...p.settings, language: v } }))} options={[{value:'en',label:'English'},{value:'hi',label:'Hindi'},{value:'hinglish',label:'Hinglish'}]} /></FormField>
            <FormField label="Handoff Phone"><FormInput value={editForm.settings?.handoffPhone} onChange={v => setEditForm(p => ({ ...p, settings: { ...p.settings, handoffPhone: v } }))} placeholder="+91..." /></FormField>
          </div>
          <div className="grid grid-cols-1 gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={editForm.settings?.dashboardHandoffReplyEnabled !== false}
                onChange={e => setEditForm(p => ({ ...p, settings: { ...p.settings, dashboardHandoffReplyEnabled: e.target.checked } }))}
              />
              Enable dashboard handoff reply for this client
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={!!editForm.settings?.allowPaidReplies}
                onChange={e => setEditForm(p => ({ ...p, settings: { ...p.settings, allowPaidReplies: e.target.checked } }))}
              />
              Allow paid WhatsApp replies after 24-hour free window
            </label>
          </div>
          <hr className="border-gray-200" />
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Subscription</h3>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Plan"><FormSelect value={editForm.subscription?.plan} onChange={v => setEditForm(p => ({ ...p, subscription: { ...p.subscription, plan: v } }))} options={[{value:'basic',label:'Basic'},{value:'pro',label:'Pro'},{value:'enterprise',label:'Enterprise'}]} /></FormField>
            <FormField label="Status"><FormSelect value={editForm.subscription?.status} onChange={v => setEditForm(p => ({ ...p, subscription: { ...p.subscription, status: v } }))} options={[{value:'active',label:'Active'},{value:'expired',label:'Expired'},{value:'cancelled',label:'Cancelled'}]} /></FormField>
          </div>

          {editMsg && <p className="text-xs text-red-500">{editMsg}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-50">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="px-4 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </div>
      </SlideOver>

      {/* Bot Toggle Confirm */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmTarget(null) }}
        onConfirm={() => toggleBot(confirmTarget)}
        title={confirmTarget?.isActive ? 'Pause Client Bot?' : 'Resume Client Bot?'}
        message={confirmTarget?.isActive
          ? `"${confirmTarget?.name}" bot will stop responding to WhatsApp messages immediately.`
          : `"${confirmTarget?.name}" bot will start responding to WhatsApp messages again.`}
        confirmLabel={confirmTarget?.isActive ? 'Pause Bot' : 'Resume Bot'}
        destructive={confirmTarget?.isActive}
      />
    </DashboardLayout>
  )
}
