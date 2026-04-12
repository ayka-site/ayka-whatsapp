'use client'
import { useState, useMemo } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, SlideOver, DataTable } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { relativeTime, formatNumber } from '../../../lib/format'
const { apiFetch } = require('../../../lib/api')

export default function AdminLeads() {
  const [page, setPage] = useState(1)
  const [score, setScore] = useState('')
  const [search, setSearch] = useState('')
  const [client, setClient] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [lead, setLead] = useState(null)

  const url = `/api/admin/leads?page=${page}&limit=25${score ? `&score=${score}` : ''}${search ? `&search=${search}` : ''}${client ? `&businessId=${client}` : ''}`
  const { data, loading } = useFetch(url, [page, score, search, client])
  const { data: clientList } = useFetch('/api/admin/clients', [])

  async function openLead(convoId) {
    try {
      const res = await apiFetch(`/api/admin/leads?search=${convoId}`)
      if (res?.leads?.[0]) { setLead(res.leads[0]); setProfileOpen(true) }
    } catch {}
  }

  const columns = [
    { key: 'parentName', label: 'Parent', render: r => <div><p className="font-medium" style={{ color: 'var(--color-text)' }}>{r.parentName || '-'}</p><p className="text-[10px] opacity-40">{r.phone}</p></div> },
    { key: 'client', label: 'Client', render: r => <span className="text-xs">{r.businessName || '-'}</span> },
    { key: 'studentName', label: 'Student' },
    { key: 'interestedClass', label: 'Class' },
    { key: 'leadScore', label: 'Score', render: r => <Badge score={r.leadScore} /> },
    { key: 'messageCount', label: 'Msgs', render: r => r.messageCount || 0 },
    { key: 'visitConfirmed', label: 'Visit', render: r => r.visitConfirmed ? '✅' : '' },
    { key: 'handoffTriggered', label: 'Handoff', render: r => r.handoffTriggered ? '🤝' : '' },
    { key: 'lastMessageAt', label: 'Last Active', render: r => <span className="text-xs opacity-50">{relativeTime(r.lastMessageAt)}</span> },
  ]

  const scores = ['hot', 'warm', 'cold']

  return (
    <DashboardLayout requiredRole="reseller">
      <TopBar title="All Leads" breadcrumbs={['Home', 'Leads']} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name or phone…"
          className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-transparent outline-none w-60"
          style={{ color: 'var(--color-text)' }}
        />
        <select value={client} onChange={e => { setClient(e.target.value); setPage(1) }}
          className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-transparent outline-none"
          style={{ color: 'var(--color-text)' }}
        >
          <option value="">All Clients</option>
          {(Array.isArray(clientList) ? clientList : []).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <div className="flex gap-1">
          {['', ...scores].map(s => (
            <button key={s} onClick={() => { setScore(s); setPage(1) }}
              className={`px-3 py-1.5 text-xs rounded-full border ${score === s ? 'bg-white/10 border-white/20' : 'border-white/10'}`}
              style={{ color: 'var(--color-text)' }}
            >{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}</button>
          ))}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={data?.leads || []}
        loading={loading}
        page={page}
        totalPages={data?.totalPages || 1}
        onPageChange={setPage}
        onRowClick={r => { setLead(r); setProfileOpen(true) }}
      />

      <SlideOver open={profileOpen} onClose={() => setProfileOpen(false)} title="Lead Profile">
        {lead && (
          <div className="space-y-4 text-sm text-gray-800">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-500">Parent</p><p className="font-medium">{lead.parentName || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Phone</p><p>{lead.phone}</p></div>
              <div><p className="text-xs text-gray-500">Student</p><p>{lead.studentName || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Class</p><p>{lead.interestedClass || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Client</p><p>{lead.businessName || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Score</p><Badge score={lead.leadScore} /></div>
              <div><p className="text-xs text-gray-500">Reason</p><p>{lead.leadScoreReason || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Messages</p><p>{lead.messageCount}</p></div>
              <div><p className="text-xs text-gray-500">Visit</p><p>{lead.visitConfirmed ? 'Yes' : 'No'}</p></div>
              <div><p className="text-xs text-gray-500">Handoff</p><p>{lead.handoffTriggered ? 'Yes' : 'No'}</p></div>
            </div>
          </div>
        )}
      </SlideOver>
    </DashboardLayout>
  )
}
