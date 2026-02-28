'use client'
import { useState, useCallback } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, DataTable, SlideOver } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { relativeTime, formatDate } from '../../../lib/format'
const { apiFetch } = require('../../../lib/api')

export default function ClientLeads() {
  const [page, setPage] = useState(1)
  const [score, setScore] = useState('')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [selectedLead, setSelectedLead] = useState(null)
  const [slideOpen, setSlideOpen] = useState(false)

  // Debounce search
  const handleSearch = useCallback((val) => {
    setSearch(val)
    clearTimeout(window.__searchTimer)
    window.__searchTimer = setTimeout(() => { setSearchDebounced(val); setPage(1) }, 300)
  }, [])

  const url = `/api/client/leads?page=${page}&limit=25${score ? `&score=${score}` : ''}${searchDebounced ? `&search=${searchDebounced}` : ''}`
  const { data, loading, error } = useFetch(url, [page, score, searchDebounced])

  async function openLead(row) {
    try {
      const detail = await apiFetch(`/api/client/leads/${row._id}`)
      setSelectedLead(detail)
      setSlideOpen(true)
    } catch {}
  }

  async function exportCSV() {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/client/export/leads${score ? `?score=${score}` : ''}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('ayka_token')}` }
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
    } catch {}
  }

  const scores = ['hot', 'warm', 'cold']

  const columns = [
    { key: 'parentName', label: 'Parent', render: (v, row) => (
      <div>
        <p className="font-medium">{v || 'Unknown'}</p>
        <p className="text-xs opacity-40">{row.phone}</p>
      </div>
    )},
    { key: 'studentName', label: 'Student', render: v => v || '—' },
    { key: 'interestedClass', label: 'Class', render: v => v || '—' },
    { key: 'leadScore', label: 'Score', render: (v, row) => (
      <span title={row.leadScoreReason}><Badge score={v} /></span>
    )},
    { key: 'source', label: 'Source', render: v => v || 'direct' },
    { key: 'lastMessage', label: 'Last Message', render: v => relativeTime(v) },
    { key: 'visitConfirmed', label: 'Visit', render: v => v ? <span className="text-green-400">✓</span> : <span className="opacity-20">—</span> },
    { key: 'handoffTriggered', label: 'Handoff', render: v => v ? <span className="text-green-400">✓</span> : <span className="opacity-20">—</span> },
    { key: 'messageCount', label: 'Msgs', render: v => v || 0 },
  ]

  return (
    <DashboardLayout requiredRole="client">
      <TopBar title="Leads" breadcrumbs={['Home', 'Leads']}>
        <button onClick={exportCSV} className="text-xs px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>
          📥 Export CSV
        </button>
      </TopBar>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1">
          <button
            onClick={() => { setScore(''); setPage(1) }}
            className={`px-3 py-1.5 text-xs rounded-full border ${!score ? 'border-white/30 bg-white/10' : 'border-white/10'}`}
            style={{ color: 'var(--color-text)' }}
          >All</button>
          {scores.map(s => (
            <button
              key={s}
              onClick={() => { setScore(score === s ? '' : s); setPage(1) }}
              className={`px-3 py-1.5 text-xs rounded-full border ${score === s ? 'border-white/30 bg-white/10' : 'border-white/10'}`}
              style={{ color: 'var(--color-text)' }}
            >{s.charAt(0).toUpperCase() + s.slice(1)}</button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-transparent focus:ring-1 focus:ring-white/20 outline-none"
          style={{ color: 'var(--color-text)', minWidth: 200 }}
        />
      </div>

      <DataTable
        columns={columns}
        data={data?.leads}
        loading={loading}
        onRowClick={openLead}
        page={page}
        totalPages={data?.totalPages}
        total={data?.total}
        limit={25}
        onPageChange={setPage}
        emptyMessage="No leads yet. When parents message the bot, they'll appear here."
      />

      {/* Lead detail slide-over */}
      <SlideOver open={slideOpen} onClose={() => setSlideOpen(false)} title="Lead Profile">
        {selectedLead && (
          <div className="space-y-4 text-sm text-gray-800">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-500">Parent Name</p><p className="font-medium">{selectedLead.flowState?.collectedData?.parentName || '—'}</p></div>
              <div><p className="text-xs text-gray-500">Phone</p><p className="font-medium">{selectedLead.phone}</p></div>
              <div><p className="text-xs text-gray-500">Student Name</p><p className="font-medium">{selectedLead.flowState?.collectedData?.studentName || '—'}</p></div>
              <div><p className="text-xs text-gray-500">Class</p><p className="font-medium">{selectedLead.flowState?.collectedData?.interestedClass || '—'}</p></div>
              <div><p className="text-xs text-gray-500">Alt Phone</p><p className="font-medium">{selectedLead.flowState?.collectedData?.altPhone || '—'}</p></div>
              <div><p className="text-xs text-gray-500">Visit Time</p><p className="font-medium">{selectedLead.flowState?.collectedData?.preferredVisitTime || '—'}</p></div>
            </div>
            <hr />
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-500">Score</p><Badge score={selectedLead.leadScore} /></div>
              <div><p className="text-xs text-gray-500">Reason</p><p>{selectedLead.leadScoreReason}</p></div>
              <div><p className="text-xs text-gray-500">Visit Confirmed</p><p>{selectedLead.flowState?.visitConfirmed ? `Yes (${formatDate(selectedLead.flowState?.visitConfirmedAt)})` : 'No'}</p></div>
              <div><p className="text-xs text-gray-500">Handoff</p><p>{selectedLead.flowState?.handoffTriggered ? `Yes (${formatDate(selectedLead.flowState?.handoffAt)})` : 'No'}</p></div>
              <div><p className="text-xs text-gray-500">Messages</p><p>{selectedLead.messageCount}</p></div>
              <div><p className="text-xs text-gray-500">Source</p><p>{selectedLead.source?.sourceType || 'direct'}</p></div>
              <div><p className="text-xs text-gray-500">First Contact</p><p>{formatDate(selectedLead.openedAt)}</p></div>
            </div>
            {selectedLead.appointment && (
              <>
                <hr />
                <h3 className="font-semibold">Appointment</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs text-gray-500">Scheduled</p><p>{selectedLead.appointment.rawPreference}</p></div>
                  <div><p className="text-xs text-gray-500">Status</p><Badge score={selectedLead.appointment.status} /></div>
                  <div><p className="text-xs text-gray-500">Documents</p><p>{selectedLead.appointment.documentsAdvised?.join(', ') || '—'}</p></div>
                </div>
              </>
            )}
          </div>
        )}
      </SlideOver>
    </DashboardLayout>
  )
}
