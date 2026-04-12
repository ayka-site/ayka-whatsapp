'use client'
import { useState } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, DataTable, SlideOver } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { relativeTime, formatNumber } from '../../../lib/format'

export default function SuperAdminLeads() {
  const [page, setPage] = useState(1)
  const [score, setScore] = useState('')
  const [search, setSearch] = useState('')
  const [reseller, setReseller] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [lead, setLead] = useState(null)

  const url = `/api/superadmin/leads?page=${page}&limit=25${score ? `&score=${score}` : ''}${search ? `&search=${search}` : ''}${reseller ? `&resellerId=${reseller}` : ''}`
  const { data, loading } = useFetch(url, [page, score, search, reseller])
  const { data: resellerList } = useFetch('/api/superadmin/resellers', [])

  const columns = [
    { key: 'parentName', label: 'Parent', render: r => <div><p className="font-medium" style={{ color: 'var(--color-text)' }}>{r.parentName || '-'}</p><p className="text-[10px] opacity-40">{r.phone}</p></div> },
    { key: 'businessName', label: 'Client', render: r => <span className="text-xs">{r.businessName || '-'}</span> },
    { key: 'resellerName', label: 'Reseller', render: r => <span className="text-xs">{r.resellerName || '-'}</span> },
    { key: 'leadScore', label: 'Score', render: r => <Badge score={r.leadScore} /> },
    { key: 'messageCount', label: 'Msgs', render: r => r.messageCount || 0 },
    { key: 'visitConfirmed', label: 'Visit', render: r => r.visitConfirmed ? '✅' : '' },
    { key: 'lastMessageAt', label: 'Last Active', render: r => <span className="text-xs opacity-50">{relativeTime(r.lastMessageAt)}</span> },
  ]

  const scores = ['hot', 'warm', 'cold']

  return (
    <DashboardLayout requiredRole="superadmin">
      <TopBar title="All Leads" breadcrumbs={['Home', 'Leads']} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          placeholder="Search name or phone…"
          className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-transparent outline-none w-60"
          style={{ color: 'var(--color-text)' }} />
        <select value={reseller} onChange={e => { setReseller(e.target.value); setPage(1) }}
          className="px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-transparent" style={{ color: 'var(--color-text)' }}>
          <option value="">All Resellers</option>
          {(Array.isArray(resellerList) ? resellerList : []).map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
        </select>
        <div className="flex gap-1">
          {['', ...scores].map(s => (
            <button key={s} onClick={() => { setScore(s); setPage(1) }}
              className={`px-3 py-1.5 text-xs rounded-full border ${score === s ? 'bg-white/10 border-white/20' : 'border-white/10'}`}
              style={{ color: 'var(--color-text)' }}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}</button>
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

      <SlideOver open={profileOpen} onClose={() => setProfileOpen(false)} title="Lead Details">
        {lead && (
          <div className="space-y-4 text-sm text-gray-800">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-gray-500">Parent</p><p className="font-medium">{lead.parentName || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Phone</p><p>{lead.phone}</p></div>
              <div><p className="text-xs text-gray-500">Client</p><p>{lead.businessName || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Reseller</p><p>{lead.resellerName || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Score</p><Badge score={lead.leadScore} /></div>
              <div><p className="text-xs text-gray-500">Reason</p><p>{lead.leadScoreReason || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Messages</p><p>{lead.messageCount}</p></div>
              <div><p className="text-xs text-gray-500">Visit</p><p>{lead.visitConfirmed ? 'Yes' : 'No'}</p></div>
            </div>
          </div>
        )}
      </SlideOver>
    </DashboardLayout>
  )
}
