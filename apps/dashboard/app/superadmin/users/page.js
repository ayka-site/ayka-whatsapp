'use client'
import { useState } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, SlideOver, ConfirmDialog, FormField, FormInput, FormSelect } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatDate, relativeTime } from '../../../lib/format'
const { apiFetch } = require('../../../lib/api')

export default function SuperAdminUsers() {
  const [roleFilter, setRoleFilter] = useState('')
  const [search, setSearch] = useState('')
  const url = `/api/superadmin/users?${roleFilter ? `role=${roleFilter}&` : ''}${search ? `search=${search}` : ''}`
  const { data, loading, refetch } = useFetch(url, [roleFilter, search])
  const { data: resellerList } = useFetch('/api/superadmin/resellers', [])
  const { data: clientList } = useFetch('/api/superadmin/clients', [])

  const [editOpen, setEditOpen] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [resetPwdOpen, setResetPwdOpen] = useState(false)
  const [resetTarget, setResetTarget] = useState(null)
  const [newPwd, setNewPwd] = useState('')

  const users = Array.isArray(data) ? data : []
  const resellers = Array.isArray(resellerList) ? resellerList : (resellerList?.resellers || resellerList || [])
  const clients = Array.isArray(clientList) ? clientList : (clientList?.clients || clientList || [])

  function openCreate() {
    setForm({ email: '', password: '', role: 'client', displayName: '', businessId: '', resellerId: '' })
    setIsNew(true); setMsg(''); setEditOpen(true)
  }

  function openEdit(u) {
    setForm({
      _id: u._id, email: u.email || '', role: u.role || 'client',
      displayName: u.displayName || '',
      businessId: u.businessId || '', resellerId: u.resellerId || '',
    })
    setIsNew(false); setMsg(''); setEditOpen(true)
  }

  async function save() {
    setMsg(''); setSaving(true)
    try {
      if (isNew) {
        const body = { ...form }
        if (!body.businessId) delete body.businessId
        if (!body.resellerId) delete body.resellerId
        await apiFetch('/api/superadmin/users', { method: 'POST', body: JSON.stringify(body) })
      } else {
        const { _id, password, ...body } = form
        if (!body.businessId) body.businessId = null
        if (!body.resellerId) body.resellerId = null
        await apiFetch(`/api/superadmin/users/${_id}`, { method: 'PATCH', body: JSON.stringify(body) })
      }
      setEditOpen(false); refetch()
    } catch (err) { setMsg(err.message) }
    setSaving(false)
  }

  async function toggleActive(u) {
    try {
      if (u.isActive) {
        await apiFetch(`/api/superadmin/users/${u._id}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/superadmin/users/${u._id}/reactivate`, { method: 'POST' })
      }
      refetch()
    } catch (err) { alert(err.message) }
    setConfirmOpen(false); setConfirmTarget(null)
  }

  async function resetPassword() {
    if (!newPwd || newPwd.length < 8) { alert('Password must be at least 8 characters'); return }
    try {
      await apiFetch(`/api/superadmin/users/${resetTarget._id}`, { method: 'PATCH', body: JSON.stringify({ newPassword: newPwd }) })
      setResetPwdOpen(false); setNewPwd(''); setResetTarget(null)
      alert('Password reset successfully')
    } catch (err) { alert(err.message) }
  }

  const roleColors = { superadmin: 'bg-purple-600 text-white', reseller: 'bg-blue-600 text-white', client: 'bg-emerald-600 text-white' }

  return (
    <DashboardLayout requiredRole="superadmin">
      <TopBar title="Users" breadcrumbs={['Home', 'Users']}
        action={<button onClick={openCreate} className="px-4 py-2 text-sm rounded-lg font-medium text-white" style={{ background: 'var(--color-primary)' }}>+ New User</button>} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or email…"
          className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-transparent outline-none w-60"
          style={{ color: 'var(--color-text)' }} />
        <div className="flex gap-1">
          {['', 'superadmin', 'reseller', 'client'].map(r => (
            <button key={r} onClick={() => setRoleFilter(r)}
              className={`px-3 py-1.5 text-xs rounded-full border ${roleFilter === r ? 'bg-white/10 border-white/20' : 'border-white/10'}`}
              style={{ color: 'var(--color-text)' }}>{r ? r.charAt(0).toUpperCase() + r.slice(1) : 'All'}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-surface)' }}>
          <table className="w-full text-sm">
            <thead><tr className="text-xs uppercase tracking-wider opacity-40 border-b border-white/10">
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Role</th>
              <th className="p-3 text-left">Reseller</th>
              <th className="p-3 text-left">Client</th>
              <th className="p-3 text-left">Last Login</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u._id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3">
                    <p className="font-medium" style={{ color: 'var(--color-text)' }}>{u.displayName}</p>
                    <p className="text-[10px] opacity-40">{u.email}</p>
                  </td>
                  <td className="p-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[u.role] || 'bg-gray-500 text-white'}`}>{u.role}</span></td>
                  <td className="p-3 text-xs opacity-60">{u.resellerName || '-'}</td>
                  <td className="p-3 text-xs opacity-60">{u.businessName || '-'}</td>
                  <td className="p-3 text-xs opacity-50">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'Never'}</td>
                  <td className="p-3"><Badge score={u.isActive ? 'active' : 'cancelled'} /></td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => openEdit(u)} className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10" style={{ color: 'var(--color-primary)' }}>Edit</button>
                      <button onClick={() => { setResetTarget(u); setNewPwd(''); setResetPwdOpen(true) }} className="text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10 text-yellow-400">Reset Pwd</button>
                      <button onClick={() => { setConfirmTarget(u); setConfirmOpen(true) }} className={`text-xs px-2 py-1 rounded border border-white/10 hover:bg-white/10 ${u.isActive ? 'text-red-400' : 'text-green-400'}`}>
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-xs opacity-40">No users found</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit User */}
      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title={isNew ? 'Create User' : 'Edit User'}>
        <div className="space-y-4">
          <FormField label="Display Name"><FormInput value={form.displayName} onChange={v => setForm(p => ({ ...p, displayName: v }))} required /></FormField>
          <FormField label="Email"><FormInput value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} type="email" required disabled={!isNew} /></FormField>
          {isNew && <FormField label="Password" hint="Minimum 8 characters"><FormInput value={form.password} onChange={v => setForm(p => ({ ...p, password: v }))} type="password" required /></FormField>}
          <FormField label="Role">
            <FormSelect value={form.role} onChange={v => setForm(p => ({ ...p, role: v, businessId: '', resellerId: '' }))}
              options={[{value:'superadmin',label:'Super Admin'},{value:'reseller',label:'Reseller (Admin)'},{value:'client',label:'Client'}]} />
          </FormField>

          {form.role === 'superadmin' && (
            <p className="text-[11px] opacity-50 px-1" style={{ color: 'var(--color-text)' }}>
              Super admins have full platform access. No additional assignment needed.
            </p>
          )}

          {form.role === 'reseller' && (
            <FormField label="Reseller Organization" hint="Which reseller org does this user manage?">
              <FormSelect value={form.resellerId} onChange={v => setForm(p => ({ ...p, resellerId: v }))} placeholder="Select reseller org…"
                options={resellers.filter(r => r.isActive).map(r => ({ value: r._id, label: r.name }))} />
              <p className="text-[11px] opacity-50 mt-1" style={{ color: 'var(--color-text)' }}>
                Create the reseller first from the <a href="/superadmin/resellers" className="underline" style={{ color: 'var(--color-primary)' }}>Resellers page</a> if not listed.
              </p>
            </FormField>
          )}

          {form.role === 'client' && (
            <>
              <FormField label="Client Business" hint="Which business does this user belong to?">
                <FormSelect value={form.businessId} onChange={v => {
                  const biz = clients.find(c => c._id === v)
                  setForm(p => ({ ...p, businessId: v, resellerId: biz?.resellerId || biz?.resellerId?._id || p.resellerId }))
                }} placeholder="Select client business…"
                  options={clients.filter(c => c.isActive).map(c => ({ value: c._id, label: `${c.name}${c.resellerName ? ` (${c.resellerName})` : ' - Direct'}` }))} />
                <p className="text-[11px] opacity-50 mt-1" style={{ color: 'var(--color-text)' }}>
                  Create the client business first from the <a href="/superadmin/clients" className="underline" style={{ color: 'var(--color-primary)' }}>Clients page</a> if not listed.
                </p>
              </FormField>
            </>
          )}

          {msg && <p className="text-xs text-red-500">{msg}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>Cancel</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-50" style={{ background: 'var(--color-primary)' }}>{saving ? 'Saving…' : isNew ? 'Create User' : 'Save Changes'}</button>
          </div>
        </div>
      </SlideOver>

      {/* Reset Password Dialog */}
      <SlideOver open={resetPwdOpen} onClose={() => setResetPwdOpen(false)} title="Reset Password">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>Resetting password for <strong>{resetTarget?.displayName}</strong> ({resetTarget?.email})</p>
          <FormField label="New Password" hint="Minimum 8 characters">
            <FormInput value={newPwd} onChange={setNewPwd} type="password" required />
          </FormField>
          <div className="flex justify-end gap-3">
            <button onClick={() => setResetPwdOpen(false)} className="px-4 py-2 text-sm rounded-lg border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>Cancel</button>
            <button onClick={resetPassword} className="px-4 py-2 text-sm rounded-lg font-medium text-white bg-yellow-600 hover:bg-yellow-700">Reset Password</button>
          </div>
        </div>
      </SlideOver>

      {/* Toggle Confirm */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => { setConfirmOpen(false); setConfirmTarget(null) }}
        onConfirm={() => toggleActive(confirmTarget)}
        title={confirmTarget?.isActive ? 'Deactivate User?' : 'Reactivate User?'}
        message={confirmTarget?.isActive
          ? `"${confirmTarget?.displayName}" will lose dashboard access immediately.`
          : `"${confirmTarget?.displayName}" will regain dashboard access.`}
        confirmLabel={confirmTarget?.isActive ? 'Deactivate' : 'Reactivate'}
        destructive={confirmTarget?.isActive}
      />
    </DashboardLayout>
  )
}