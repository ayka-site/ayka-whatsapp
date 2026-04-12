'use client'
import { useState, useMemo } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, SlideOver } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatDate, formatAppointmentPreference } from '../../../lib/format'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getMonthDays(year, month) {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const days = []
  const startPad = first.getDay()
  for (let i = 0; i < startPad; i++) days.push(null)
  for (let d = 1; d <= last.getDate(); d++) days.push(d)
  return days
}

export default function ClientAppointments() {
  const [view, setView] = useState('list') // list or calendar
  const [statusFilter, setStatusFilter] = useState('')
  const [calDate, setCalDate] = useState(new Date())
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedAppt, setSelectedAppt] = useState(null)

  const { data, loading } = useFetch('/api/client/appointments', [])

  const filtered = useMemo(() => {
    if (!data?.appointments) return []
    return data.appointments.filter(a => !statusFilter || a.status === statusFilter)
  }, [data, statusFilter])

  const calYear = calDate.getFullYear()
  const calMonth = calDate.getMonth()
  const days = getMonthDays(calYear, calMonth)

  const calEvents = useMemo(() => {
    const map = {}
    if (!data?.appointments) return map
    data.appointments.forEach(a => {
      const d = new Date(a.scheduledAt || a.createdAt)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map[key]) map[key] = []
      map[key].push(a)
    })
    return map
  }, [data])

  function openDetail(appt) {
    setSelectedAppt(appt)
    setDetailOpen(true)
  }

  const statuses = ['confirmed', 'pending', 'cancelled', 'completed', 'rescheduled']

  return (
    <DashboardLayout requiredRole="client">
      <TopBar title="Appointments" breadcrumbs={['Home', 'Appointments']}
        action={
          <div className="flex items-center gap-2">
            <button onClick={() => setView('list')} className={`px-3 py-1.5 text-xs rounded-lg border ${view === 'list' ? 'bg-white/10 border-white/20' : 'border-white/10'}`} style={{ color: 'var(--color-text)' }}>List</button>
            <button onClick={() => setView('calendar')} className={`px-3 py-1.5 text-xs rounded-lg border ${view === 'calendar' ? 'bg-white/10 border-white/20' : 'border-white/10'}`} style={{ color: 'var(--color-text)' }}>Calendar</button>
          </div>
        }
      />

      {/* Status filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['', ...statuses].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-full border ${statusFilter === s ? 'bg-white/10 border-white/20' : 'border-white/10'}`}
            style={{ color: 'var(--color-text)' }}
          >{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}</button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-20 w-full rounded-xl" />)}
        </div>
      ) : view === 'list' ? (
        /* ─── List View ─── */
        <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-surface)' }}>
          {!filtered.length ? (
            <div className="p-8 text-center text-xs opacity-60" style={{ color: 'var(--color-text)' }}>No appointments found</div>
          ) : (
            <table className="w-full text-sm" style={{ color: 'var(--color-text)' }}>
              <thead>
                <tr className="text-xs uppercase tracking-wider opacity-70 border-b border-white/10">
                  <th className="p-3 text-left">Parent</th>
                  <th className="p-3 text-left">Student</th>
                  <th className="p-3 text-left">Preference</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-left">Documents</th>
                  <th className="p-3 text-left">Created</th>
                  <th className="p-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a._id} className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => openDetail(a)}>
                    <td className="p-3">
                      <p className="font-medium" style={{ color: 'var(--color-text)' }}>{a.parentName}</p>
                      <p className="text-xs opacity-60" style={{ color: 'var(--color-text)' }}>{a.phone}</p>
                    </td>
                    <td className="p-3">{a.studentName || '-'}</td>
                    <td className="p-3 text-xs">{formatAppointmentPreference(a.scheduledAt, a.rawPreference)}</td>
                    <td className="p-3"><Badge score={a.status} /></td>
                    <td className="p-3 text-xs max-w-[200px] truncate">{a.documentsAdvised?.join(', ') || '-'}</td>
                    <td className="p-3 text-xs opacity-70">{formatDate(a.createdAt)}</td>
                    <td className="p-3 text-center">
                      <button className="text-xs underline opacity-70 hover:opacity-100" style={{ color: 'var(--color-text)' }} onClick={e => { e.stopPropagation(); openDetail(a) }}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        /* ─── Calendar View ─── */
        <div className="rounded-xl border border-white/10 p-4" style={{ background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCalDate(new Date(calYear, calMonth - 1))} className="text-sm px-2 py-1 rounded hover:bg-white/5" style={{ color: 'var(--color-text)' }}>←</button>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{MONTHS[calMonth]} {calYear}</h3>
            <button onClick={() => setCalDate(new Date(calYear, calMonth + 1))} className="text-sm px-2 py-1 rounded hover:bg-white/5" style={{ color: 'var(--color-text)' }}>→</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] mb-2 opacity-40">
            {DAYS.map(d => <div key={d}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d, i) => {
              if (!d) return <div key={i} />
              const key = `${calYear}-${calMonth}-${d}`
              const events = calEvents[key] || []
              const isToday = d === new Date().getDate() && calMonth === new Date().getMonth() && calYear === new Date().getFullYear()
              return (
                <div
                  key={i}
                  className={`min-h-[60px] p-1 rounded border text-xs ${isToday ? 'border-white/30' : 'border-white/5'}`}
                  style={{ background: events.length ? 'rgba(var(--primary-rgb, 139, 92, 246), 0.1)' : 'transparent' }}
                >
                  <span className={`text-[10px] ${isToday ? 'font-bold' : 'opacity-50'}`} style={{ color: 'var(--color-text)' }}>{d}</span>
                  {events.slice(0, 2).map((ev, j) => (
                    <div key={j} onClick={() => openDetail(ev)}
                      className="mt-0.5 px-1 py-0.5 rounded text-[9px] truncate cursor-pointer hover:opacity-100 opacity-80"
                      style={{
                        background: ev.status === 'confirmed' ? 'rgba(34,197,94,0.3)' : ev.status === 'cancelled' ? 'rgba(239,68,68,0.3)' : 'rgba(234,179,8,0.3)',
                        color: 'var(--color-text)'
                      }}
                    >
                      {ev.parentName?.split(' ')[0] || 'Appt'}
                    </div>
                  ))}
                  {events.length > 2 && <p className="text-[8px] text-center opacity-40">+{events.length - 2}</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Detail Slide-Over */}
      <SlideOver open={detailOpen} onClose={() => setDetailOpen(false)} title="Appointment Details">
        {selectedAppt && (
          <div className="space-y-4 text-sm" style={{ color: 'var(--color-text)' }}>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Parent Name</p><p className="font-medium">{selectedAppt.parentName || '-'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Phone</p><p className="font-medium">{selectedAppt.phone || '-'}</p></div>
              <div><p className="text-xs opacity-60" style={{ color: 'var(--color-text)' }}>Student Name</p><p className="font-medium">{selectedAppt.studentName || '-'}</p></div>
              <div><p className="text-xs opacity-60" style={{ color: 'var(--color-text)' }}>Class</p><p className="font-medium">{selectedAppt.interestedClass || '-'}</p></div>
            </div>
            <hr />
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs opacity-60" style={{ color: 'var(--color-text)' }}>Status</p><Badge score={selectedAppt.status} /></div>
              <div><p className="text-xs opacity-60" style={{ color: 'var(--color-text)' }}>Preference</p><p>{formatAppointmentPreference(selectedAppt.scheduledAt, selectedAppt.rawPreference)}</p></div>
              <div><p className="text-xs opacity-60" style={{ color: 'var(--color-text)' }}>Scheduled At</p><p>{selectedAppt.scheduledAt ? formatDate(selectedAppt.scheduledAt) : '-'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Source</p><p>{selectedAppt.source || 'bot'}</p></div>
            </div>
            <hr />
            <div>
              <p className="text-xs opacity-60 mb-1" style={{ color: 'var(--color-text)' }}>Documents Advised</p>
              {selectedAppt.documentsAdvised?.length ? (
                <div className="flex flex-wrap gap-1">
                  {selectedAppt.documentsAdvised.map((d, i) => (
                    <span key={i} className="px-2 py-0.5 bg-gray-100 rounded text-xs">{d}</span>
                  ))}
                </div>
              ) : <p className="text-xs opacity-40">None</p>}
            </div>
            {selectedAppt.notes && (
              <>
                <hr />
                <div><p className="text-xs opacity-60 mb-1" style={{ color: 'var(--color-text)' }}>Notes</p><p>{selectedAppt.notes}</p></div>
              </>
            )}
            <div className="pt-2">
              <p className="text-[10px] opacity-60" style={{ color: 'var(--color-text)' }}>Created: {formatDate(selectedAppt.createdAt)}</p>
              {selectedAppt.updatedAt && <p className="text-[10px] opacity-60" style={{ color: 'var(--color-text)' }}>Updated: {formatDate(selectedAppt.updatedAt)}</p>}
            </div>
          </div>
        )}
      </SlideOver>
    </DashboardLayout>
  )
}
