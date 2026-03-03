'use client'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, ChartWrapper } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatNumber } from '../../../lib/format'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#22c55e', '#ef4444', '#ec4899']

export default function AdminAnalytics() {
  const { data: monthly } = useFetch('/api/admin/analytics/score-trend', [])
  const { data: avgTime } = useFetch('/api/admin/analytics/avg-score-time', [])
  const { data: funnel } = useFetch('/api/admin/charts/conversion-funnel', [])
  const { data: msgDay } = useFetch('/api/admin/charts/message-by-day', [])
  const { data: growth } = useFetch('/api/admin/charts/monthly-growth', [])
  const { data: topClients } = useFetch('/api/admin/charts/top-clients', [])

  // ── Transform API responses to chart shapes ──
  const monthlyData = (() => {
    const raw = Array.isArray(monthly) ? monthly : []
    const byMonth = {}
    raw.forEach(d => { const m = d._id?.month; if (!m) return; if (!byMonth[m]) byMonth[m] = { month: m, hot: 0, warm: 0, cold: 0, total: 0 }; byMonth[m][d._id?.score] = d.count; byMonth[m].total += d.count })
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({ month: m.month, avgScore: m.total ? Math.round((m.hot * 3 + m.warm * 2 + m.cold) / m.total * 10) / 10 : 0, hotPct: m.total ? Math.round(m.hot / m.total * 100) : 0 }))
  })()
  const avgTimeData = (Array.isArray(avgTime) ? avgTime : []).map(d => ({ client: d.name, avgDays: d.avgMessages }))
  const funnelData = (() => {
    const arr = Array.isArray(funnel) ? funnel : []
    const t = arr.reduce((a, d) => ({ total: a.total + (d.total || 0), dc: a.dc + (d.dataCollected || 0), vc: a.vc + (d.visitConfirmed || 0), ho: a.ho + (d.handoff || 0) }), { total: 0, dc: 0, vc: 0, ho: 0 })
    const m = t.total || 1
    return [{ stage: 'Total Leads', value: t.total, pct: 100 }, { stage: 'Data Collected', value: t.dc, pct: Math.round(t.dc / m * 100) }, { stage: 'Visit Confirmed', value: t.vc, pct: Math.round(t.vc / m * 100) }, { stage: 'Handoff', value: t.ho, pct: Math.round(t.ho / m * 100) }]
  })()
  const msgDayData = (Array.isArray(msgDay) ? msgDay : []).map(d => ({ day: d.day, inbound: d.count || d.inbound || 0, outbound: d.outbound || 0 }))
  const growthData = (() => {
    const raw = Array.isArray(growth?.data) ? growth.data : Array.isArray(growth) ? growth : []
    const byM = {}
    raw.forEach(d => { const m = d._id?.month || d.month; if (m) byM[m] = (byM[m] || 0) + (d.count || d.leads || 0) })
    return Object.entries(byM).sort().map(([month, leads]) => ({ month, leads }))
  })()
  const topData = (() => {
    const arr = Array.isArray(topClients) ? topClients : []
    const max = arr.reduce((m, c) => Math.max(m, c.hotCount || c.leads || 0), 1)
    return arr.map(c => ({ name: c.name, leads: c.hotCount || c.leads || 0, pct: Math.round((c.hotCount || c.leads || 0) / max * 100) }))
  })()

  return (
    <DashboardLayout requiredRole="reseller">
      <TopBar title="Analytics" breadcrumbs={['Home', 'Analytics']} />

      {/* Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartWrapper title="Score Quality Trend" subtitle="Monthly avg lead score across portfolio">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="avgScore" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="hotPct" stroke="var(--score-hot)" strokeWidth={2} dot={false} />
              <Legend wrapperStyle={{ fontSize: 10, opacity: 0.6 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartWrapper>

        <ChartWrapper title="Avg Time to Score" subtitle="Days from first contact to hot score">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={avgTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="client" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="avgDays" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartWrapper title="Conversion Funnel Per Client" subtitle="Aggregated pipeline stages">
          <div className="space-y-3 px-4 py-2">
            {funnelData.map((step, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--color-text)' }}>{step.stage}</span>
                  <span className="opacity-50">{formatNumber(step.value)}</span>
                </div>
                <div className="h-5 rounded-full overflow-hidden bg-white/5">
                  <div className="h-full rounded-full" style={{ width: `${step.pct || 0}%`, background: COLORS[i % COLORS.length] }} />
                </div>
              </div>
            ))}
          </div>
        </ChartWrapper>

        <ChartWrapper title="Messages by Day of Week" subtitle="Inbound vs outbound">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={msgDayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="inbound" fill="var(--color-primary)" stackId="a" />
              <Bar dataKey="outbound" fill="var(--color-accent)" stackId="a" />
              <Legend wrapperStyle={{ fontSize: 10, opacity: 0.6 }} />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* Row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartWrapper title="Monthly Growth" subtitle="MoM lead acquisition">
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

        <ChartWrapper title="Top Performing Clients" subtitle="By lead volume and quality">
          <div className="space-y-3 px-4">
            {topData.map((c, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs font-mono opacity-30 w-5">{i + 1}</span>
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
    </DashboardLayout>
  )
}
