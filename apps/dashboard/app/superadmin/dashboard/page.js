'use client'
import { useRouter } from 'next/navigation'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, StatCard, ChartWrapper, Badge } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatNumber, relativeTime } from '../../../lib/format'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#22c55e', '#ef4444', '#ec4899', '#64748b', '#f97316']

export default function SuperAdminDashboard() {
  const router = useRouter()
  const { data: stats, loading: sL } = useFetch('/api/superadmin/stats', [])
  const { data: platformVol } = useFetch('/api/superadmin/charts/platform-volume', [])
  const { data: revenue } = useFetch('/api/superadmin/charts/revenue', [])
  const { data: resellerPerf } = useFetch('/api/superadmin/charts/reseller-performance', [])
  const { data: vertical } = useFetch('/api/superadmin/charts/vertical-distribution', [])
  const { data: sysHealth } = useFetch('/api/superadmin/charts/system-health', [])
  const { data: resellers } = useFetch('/api/superadmin/resellers', [])

  const s = stats || {}
  const resellerArr = Array.isArray(resellers) ? resellers : (resellers?.resellers || [])
  const platformVolConvos = platformVol?.conversations || []
  const platformVolMsgs = platformVol?.messages || []
  // Merge conversations + messages into a single array by date
  const volData = platformVolConvos.map(c => {
    const msg = platformVolMsgs.find(m => m._id === c._id)
    return { date: c._id, leads: c.count, messages: msg?.count || 0 }
  })

  const revenueData = Array.isArray(revenue) ? revenue : (revenue?.data || [])
  const resellerPerfData = Array.isArray(resellerPerf) ? resellerPerf : (resellerPerf?.data || [])
  const verticalData = Array.isArray(vertical) ? vertical.map(v => ({ name: v._id || v.name, value: v.count || v.value })) : (vertical?.data || [])
  const sysHealthData = Array.isArray(sysHealth) ? sysHealth : (sysHealth?.data || [])

  return (
    <DashboardLayout requiredRole="superadmin">
      <TopBar title="Platform Overview" breadcrumbs={['Home', 'Dashboard']} />

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={() => router.push('/superadmin/resellers')} className="px-4 py-2 text-xs rounded-lg font-medium text-white" style={{ background: 'var(--color-primary)' }}>+ New Reseller</button>
        <button onClick={() => router.push('/superadmin/clients')} className="px-4 py-2 text-xs rounded-lg font-medium border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>+ New Client</button>
        <button onClick={() => router.push('/superadmin/users')} className="px-4 py-2 text-xs rounded-lg font-medium border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>+ New User</button>
        <button onClick={() => router.push('/superadmin/system')} className="px-4 py-2 text-xs rounded-lg font-medium border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>🖥️ System Health</button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Resellers" value={formatNumber(s.totalResellers)} loading={sL} />
        <StatCard label="Clients" value={formatNumber(s.totalClients)} loading={sL} />
        <StatCard label="Conversations Today" value={formatNumber(s.conversationsToday)} loading={sL} />
        <StatCard label="Messages Today" value={formatNumber(s.messagesToday)} loading={sL} />
        <StatCard label="Hot Leads (Month)" value={formatNumber(s.hotLeadsMonth)} loading={sL} />
        <StatCard label="Visits (Month)" value={formatNumber(s.visitsMonth)} loading={sL} />
        <StatCard label="Error Rate" value={`${s.errorRate?.value ?? 0}%`} loading={sL} />
        <StatCard label="Avg Latency" value={`${s.avgLatency?.value ?? 0}ms`} loading={sL} />
      </div>

      {/* Row 1 — Platform Volume + Revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartWrapper title="Platform Volume" subtitle="Daily conversations & messages (30d)">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={volData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="leads" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="Conversations" />
              <Line type="monotone" dataKey="messages" stroke="var(--color-accent)" strokeWidth={2} dot={false} name="Messages" />
              <Legend wrapperStyle={{ fontSize: 10, opacity: 0.6 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartWrapper>

        <ChartWrapper title="Revenue by Reseller" subtitle="MRR based on active clients">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} formatter={v => `₹${v}`} />
              <Bar dataKey="revenue" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* Row 2 — Reseller Performance + Vertical */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartWrapper title="Reseller Performance" subtitle="Leads by score this month">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={resellerPerfData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis dataKey="name" type="category" width={100} tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="hot" fill="#ef4444" stackId="a" />
              <Bar dataKey="warm" fill="#f59e0b" stackId="a" />
              <Bar dataKey="cold" fill="#64748b" stackId="a" radius={[0, 4, 4, 0]} />
              <Legend wrapperStyle={{ fontSize: 10, opacity: 0.6 }} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrapper>

        <ChartWrapper title="Vertical Distribution" subtitle="Client verticals">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={verticalData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {verticalData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* Row 3 — System Health */}
      <div className="grid grid-cols-1 gap-6 mb-6">
        <ChartWrapper title="System Health" subtitle="API response times (ms)">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={sysHealthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="timestamp" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} labelFormatter={v => new Date(v).toLocaleTimeString()} />
              <Line type="monotone" dataKey="responseTime" stroke="#22c55e" strokeWidth={2} dot={false} name="Response Time" />
              <Line type="monotone" dataKey="groqLatency" stroke="#f59e0b" strokeWidth={2} dot={false} name="Groq Latency" />
              <Legend wrapperStyle={{ fontSize: 10, opacity: 0.6 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* Reseller Health Table */}
      <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Reseller Health</h2>
          <button onClick={() => router.push('/superadmin/resellers')} className="text-xs underline opacity-50 hover:opacity-100" style={{ color: 'var(--color-primary)' }}>Manage All →</button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-xs uppercase tracking-wider opacity-40 border-b border-white/10">
            <th className="p-2 text-left">Name</th>
            <th className="p-2 text-left">Plan</th>
            <th className="p-2 text-left">Clients</th>
            <th className="p-2 text-left">Leads</th>
            <th className="p-2 text-left">Revenue</th>
            <th className="p-2 text-left">Fee Status</th>
            <th className="p-2 text-left">Status</th>
          </tr></thead>
          <tbody>
            {resellerArr.map(r => (
              <tr key={r._id} className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => router.push('/superadmin/resellers')}>
                <td className="p-2 font-medium" style={{ color: 'var(--color-text)' }}>{r.name}</td>
                <td className="p-2 text-xs">{r.plan?.name || '—'}</td>
                <td className="p-2">{formatNumber(r.activeClients)}</td>
                <td className="p-2">{formatNumber(r.leadsThisMonth)}</td>
                <td className="p-2 font-medium" style={{ color: 'var(--color-primary)' }}>₹{formatNumber(r.revenue)}</td>
                <td className="p-2"><Badge score={r.platformFeeStatus === 'paid' ? 'confirmed' : r.platformFeeStatus === 'overdue' ? 'error' : 'pending'} /></td>
                <td className="p-2"><Badge score={r.isActive ? 'active' : 'cancelled'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DashboardLayout>
  )
}
