'use client'
import { useState } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, StatCard, Badge, ChartWrapper, DataTable } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatNumber, relativeTime, deltaInfo } from '../../../lib/format'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#22c55e', '#ef4444', '#ec4899', '#64748b']

export default function AdminDashboard() {
  const { data: stats, loading: sL } = useFetch('/api/admin/stats', [])
  const { data: leadsByClient } = useFetch('/api/admin/charts/leads-per-client', [])
  const { data: portfolioScore } = useFetch('/api/admin/charts/portfolio-score', [])
  const { data: platformVol } = useFetch('/api/admin/charts/platform-volume', [])
  const { data: topClients } = useFetch('/api/admin/charts/top-clients', [])
  const { data: monthlyGrowth } = useFetch('/api/admin/charts/monthly-growth', [])
  const { data: funnel } = useFetch('/api/admin/charts/conversion-funnel', [])
  const { data: msgByDay } = useFetch('/api/admin/charts/message-by-day', [])
  const { data: activity } = useFetch('/api/admin/activity', [])
  const { data: clients } = useFetch('/api/admin/clients', [])

  const s = stats || {}
  const v = (o) => (o && typeof o === 'object') ? (o.value ?? 0) : (o ?? 0)
  // ── Transform API responses to chart-compatible shapes ──
  const leadsData = (Array.isArray(leadsByClient) ? leadsByClient : []).map(d => ({ ...d, leads: (d.hot || 0) + (d.warm || 0) + (d.cold || 0) }))
  const scoreData = portfolioScore && !Array.isArray(portfolioScore) && typeof portfolioScore === 'object'
    ? [{ name: 'Hot', value: portfolioScore.hot || 0 }, { name: 'Warm', value: portfolioScore.warm || 0 }, { name: 'Cold', value: portfolioScore.cold || 0 }].filter(d => d.value > 0)
    : (Array.isArray(portfolioScore) ? portfolioScore : [])
  const volData = (Array.isArray(platformVol?.current) ? platformVol.current : []).map(d => ({ date: d._id, leads: d.count }))
  const funnelData = (() => {
    const arr = Array.isArray(funnel) ? funnel : []
    const t = arr.reduce((a, d) => ({ total: a.total + (d.total || 0), dc: a.dc + (d.dataCollected || 0), vc: a.vc + (d.visitConfirmed || 0), ho: a.ho + (d.handoff || 0) }), { total: 0, dc: 0, vc: 0, ho: 0 })
    const m = t.total || 1
    return [{ stage: 'Total Leads', value: t.total, pct: 100 }, { stage: 'Data Collected', value: t.dc, pct: Math.round(t.dc / m * 100) }, { stage: 'Visit Confirmed', value: t.vc, pct: Math.round(t.vc / m * 100) }, { stage: 'Handoff', value: t.ho, pct: Math.round(t.ho / m * 100) }]
  })()
  const growthData = (() => {
    const raw = Array.isArray(monthlyGrowth?.data) ? monthlyGrowth.data : Array.isArray(monthlyGrowth) ? monthlyGrowth : []
    const byM = {}
    raw.forEach(d => { const m = d._id?.month || d.month; if (m) byM[m] = (byM[m] || 0) + (d.count || d.leads || 0) })
    return Object.entries(byM).sort().map(([month, leads]) => ({ month, leads }))
  })()
  const topData = (() => {
    const arr = Array.isArray(topClients) ? topClients : []
    const max = arr.reduce((m, c) => Math.max(m, c.hotCount || c.leads || 0), 1)
    return arr.map(c => ({ name: c.name, leads: c.hotCount || c.leads || 0, pct: Math.round((c.hotCount || c.leads || 0) / max * 100) }))
  })()
  const msgData = (Array.isArray(msgByDay) ? msgByDay : []).map(d => ({ day: d.day, inbound: d.count || d.inbound || 0, outbound: d.outbound || 0 }))
  const activityEvents = (Array.isArray(activity) ? activity : []).map(a => ({ type: a.type === 'score_upgraded' ? 'hot_lead' : a.type, description: a.description, client: '', time: a.timestamp }))
  const clientHealth = (Array.isArray(clients) ? clients : []).map(c => ({ ...c, totalLeads: c.leads?.total || 0, hotLeads: c.leads?.hot || 0, visitsConfirmed: 0, avgScore: null }))

  return (
    <DashboardLayout requiredRole="reseller">
      <TopBar title="Dashboard" breadcrumbs={['Home', 'Dashboard']} />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="Active Clients" value={formatNumber(v(s.activeClients))} loading={sL} />
        <StatCard label="Total Leads" value={formatNumber(v(s.totalLeads))} loading={sL} />
        <StatCard label="Hot Leads" value={formatNumber(v(s.hotLeads))} loading={sL} />
        <StatCard label="Visits Confirmed" value={formatNumber(v(s.visitsConfirmed))} loading={sL} />
        <StatCard label="Handoffs" value={formatNumber(v(s.handoffs))} loading={sL} />
        <StatCard label="Bot Uptime" value={`${v(s.botUptime) || 99.9}%`} loading={sL} />
      </div>

      {/* Row 1 — Leads per Client + Portfolio Score */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartWrapper title="Leads Per Client" subtitle="Current portfolio">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={leadsData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis dataKey="name" type="category" width={100} tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="leads" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrapper>
        <ChartWrapper title="Portfolio Score Distribution" subtitle="All clients combined">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={scoreData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {scoreData.map((_, i) => <Cell key={i} fill={['var(--score-hot)', 'var(--score-warm)', 'var(--score-cold)'][i] || COLORS[i]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* Row 2 — Platform Volume + Conversion Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartWrapper title="Platform Volume" subtitle="Daily leads across all bots">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={volData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="leads" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartWrapper>
        <ChartWrapper title="Conversion Funnel" subtitle="Aggregated across all clients">
          <div className="space-y-3 px-4 py-2">
            {funnelData.map((step, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--color-text)' }}>{step.stage}</span>
                  <span className="opacity-50">{formatNumber(step.value)}</span>
                </div>
                <div className="h-5 rounded-full overflow-hidden bg-white/5">
                  <div className="h-full rounded-full transition-all" style={{ width: `${step.pct || 0}%`, background: COLORS[i % COLORS.length] }} />
                </div>
              </div>
            ))}
          </div>
        </ChartWrapper>
      </div>

      {/* Row 3 — Monthly Growth + Top Clients */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartWrapper title="Monthly Growth" subtitle="Lead acquisition MoM">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={growthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="leads" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrapper>
        <ChartWrapper title="Top Clients" subtitle="By lead volume">
          <div className="space-y-2 px-4">
            {topData.map((c, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs font-mono opacity-30 w-4">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</p>
                  <div className="h-2 rounded-full bg-white/5 mt-1"><div className="h-full rounded-full" style={{ width: `${c.pct || 0}%`, background: COLORS[i % COLORS.length] }} /></div>
                </div>
                <span className="text-xs opacity-50">{formatNumber(c.leads)}</span>
              </div>
            ))}
          </div>
        </ChartWrapper>
      </div>

      {/* Row 4 — Messages by Day + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartWrapper title="Messages by Day" subtitle="Across all bots">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={msgData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="inbound" fill="var(--color-primary)" stackId="a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="outbound" fill="var(--color-accent)" stackId="a" radius={[4, 4, 0, 0]} />
              <Legend wrapperStyle={{ fontSize: 10, opacity: 0.6 }} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrapper>
        <ChartWrapper title="Recent Activity" subtitle="Across all clients">
          <div className="max-h-[260px] overflow-y-auto px-4 space-y-2">
            {activityEvents.slice(0, 20).map((ev, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ev.type === 'hot_lead' ? 'var(--score-hot)' : ev.type === 'handoff' ? '#f59e0b' : 'var(--color-primary)' }} />
                <div className="flex-1 min-w-0">
                  <span style={{ color: 'var(--color-text)' }}>{ev.description}</span>
                  {ev.client && <span className="opacity-40 ml-1">· {ev.client}</span>}
                </div>
                <span className="opacity-30 whitespace-nowrap">{relativeTime(ev.time)}</span>
              </div>
            ))}
          </div>
        </ChartWrapper>
      </div>

      {/* Client Health Table */}
      <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Client Health</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider opacity-40 border-b border-white/10">
              <th className="p-2 text-left">Client</th>
              <th className="p-2 text-left">Leads</th>
              <th className="p-2 text-left">Hot</th>
              <th className="p-2 text-left">Visits</th>
              <th className="p-2 text-left">Avg Score</th>
              <th className="p-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {clientHealth.map(c => (
              <tr key={c._id} className="border-b border-white/5 hover:bg-white/5">
                <td className="p-2 font-medium" style={{ color: 'var(--color-text)' }}>{c.name}</td>
                <td className="p-2">{formatNumber(c.totalLeads)}</td>
                <td className="p-2">{formatNumber(c.hotLeads)}</td>
                <td className="p-2">{formatNumber(c.visitsConfirmed)}</td>
                <td className="p-2">{c.avgScore != null ? c.avgScore.toFixed(1) : '—'}</td>
                <td className="p-2"><Badge score={c.isActive ? 'confirmed' : 'cancelled'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  )
}
