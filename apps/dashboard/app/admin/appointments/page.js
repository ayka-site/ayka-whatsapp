'use client'
import { useState, useMemo } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, SlideOver } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatDate } from '../../../lib/format'

export default function AdminAppointments() {
  const [statusFilter, setStatusFilter] = useState('')
  const [client, setClient] = useState('')
  const { data, loading } = useFetch('/api/admin/appointments', [])
  const { data: clientList } = useFetch('/api/admin/clients', [])
  const [detailOpen, setDetailOpen] = useState(false)
  const [selected, setSelected] = useState(null)

  const filtered = useMemo(() => {
    if (!data?.appointments) return []
    return data.appointments.filter(a => {
      if (statusFilter && a.status !== statusFilter) return false
      if (client && a.businessId !== client) return false
      return true
    })
  }, [data, statusFilter, client])

  const statuses = ['confirmed', 'pending', 'cancelled', 'completed', 'rescheduled']

  return (
    <DashboardLayout requiredRole="reseller">
      <TopBar title="Appointments" breadcrumbs={['Home', 'Appointments']} />

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={client} onChange={e => setClient(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-transparent" style={{ color: 'var(--color-text)' }}>
          <option value="">All Clients</option>
          {(clientList?.clients || []).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        {['', ...statuses].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-full border ${statusFilter === s ? 'bg-white/10 border-white/20' : 'border-white/10'}`}
            style={{ color: 'var(--color-text)' }}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}</button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-surface)' }}>
          {!filtered.length ? (
            <div className="p-8 text-center text-xs opacity-40">No appointments</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs uppercase tracking-wider opacity-40 border-b border-white/10">
                <th className="p-3 text-left">Parent</th>
                <th className="p-3 text-left">Client</th>
                <th className="p-3 text-left">Student</th>
                <th className="p-3 text-left">Preference</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Documents</th>
                <th className="p-3 text-left">Created</th>
              </tr></thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a._id} className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => { setSelected(a); setDetailOpen(true) }}>
                    <td className="p-3"><p className="font-medium" style={{ color: 'var(--color-text)' }}>{a.parentName}</p><p className="text-xs opacity-40">{a.phone}</p></td>
                    <td className="p-3 text-xs">{a.businessName || '—'}</td>
                    <td className="p-3">{a.studentName || '—'}</td>
                    <td className="p-3 text-xs">{a.rawPreference || '—'}</td>
                    <td className="p-3"><Badge score={a.status} /></td>
                    <td className="p-3 text-xs max-w-[180px] truncate">{a.documentsAdvised?.join(', ') || '—'}</td>
                    <td className="p-3 text-xs opacity-50">{formatDate(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <SlideOver open={detailOpen} onClose={() => setDetailOpen(false)} title="Appointment Details">
        {selected && (
          <div className="space-y-4 text-sm text-gray-800">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-500">Parent</p><p className="font-medium">{selected.parentName}</p></div>
              <div><p className="text-xs text-gray-500">Phone</p><p>{selected.phone}</p></div>
              <div><p className="text-xs text-gray-500">Client</p><p>{selected.businessName || '—'}</p></div>
              <div><p className="text-xs text-gray-500">Student</p><p>{selected.studentName || '—'}</p></div>
              <div><p className="text-xs text-gray-500">Status</p><Badge score={selected.status} /></div>
              <div><p className="text-xs text-gray-500">Preference</p><p>{selected.rawPreference || '—'}</p></div>
              <div><p className="text-xs text-gray-500">Scheduled</p><p>{selected.scheduledAt ? formatDate(selected.scheduledAt) : '—'}</p></div>
            </div>
            <hr />
            <div>
              <p className="text-xs text-gray-500 mb-1">Documents Advised</p>
              {selected.documentsAdvised?.length ? (
                <div className="flex flex-wrap gap-1">{selected.documentsAdvised.map((d, i) => <span key={i} className="px-2 py-0.5 bg-gray-100 rounded text-xs">{d}</span>)}</div>
              ) : <p className="opacity-40">None</p>}
            </div>
          </div>
        )}
      </SlideOver>
    </DashboardLayout>
  )
}
