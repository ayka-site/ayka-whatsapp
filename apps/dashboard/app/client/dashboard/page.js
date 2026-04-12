'use client'
import DashboardLayout from '../../../components/DashboardLayout'
import { StatCard, ChartWrapper, TopBar, Badge } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { formatNumber, relativeTime } from '../../../lib/format'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend } from 'recharts'

const SCORE_COLORS = { hot: '#ef4444', warm: '#f59e0b', cold: '#64748b' }

export default function ClientDashboard() {
  const { data: stats, loading: statsLoading } = useFetch('/api/client/stats?period=month')
  const { data: leadVolume, loading: lvLoading } = useFetch('/api/client/charts/lead-volume?days=30')
  const { data: scoreDist, loading: sdLoading } = useFetch('/api/client/charts/score-distribution?period=month')
  const { data: funnel, loading: fnLoading } = useFetch('/api/client/charts/funnel?period=month')
  const { data: scoreTime, loading: stLoading } = useFetch('/api/client/charts/score-over-time?days=30')
  const { data: heatmap, loading: hmLoading } = useFetch('/api/client/charts/heatmap?days=30')
  const { data: activity, loading: actLoading } = useFetch('/api/client/activity?limit=15')
  const { data: recentLeads, loading: rlLoading } = useFetch('/api/client/leads?score=hot&limit=5')

  // Prepare donut data
  const donutData = scoreDist ? [
    { name: 'Hot', value: scoreDist.hot, color: SCORE_COLORS.hot },
    { name: 'Warm', value: scoreDist.warm, color: SCORE_COLORS.warm },
    { name: 'Cold', value: scoreDist.cold, color: SCORE_COLORS.cold },
  ] : []
  const donutChartData = donutData.filter(d => d.value > 0)
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0)

  // Prepare funnel data
  const funnelData = funnel ? [
    { name: 'Conversations', value: funnel.totalConversations },
    { name: 'Data Collected', value: funnel.dataCollected },
    { name: 'Visit Confirmed', value: funnel.visitConfirmed },
    { name: 'Handoff', value: funnel.handoffTriggered },
  ] : []

  // Score over time
  const scoreTimeData = (() => {
    if (!scoreTime) return []
    const map = {}
    scoreTime.forEach(d => {
      if (!map[d._id.date]) map[d._id.date] = { date: d._id.date, hot: 0, warm: 0, cold: 0 }
      map[d._id.date][d._id.score] = d.count
    })
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date))
  })()

  // Heatmap
  const heatmapGrid = (() => {
    if (!heatmap) return []
    const grid = []
    const maxCount = Math.max(1, ...heatmap.map(d => d.count))
    for (const d of heatmap) {
      grid.push({ day: d._id.dayOfWeek, hour: d._id.hour, count: d.count, intensity: d.count / maxCount })
    }
    return grid
  })()

  const activityIcons = { new_lead: '🆕', score_upgraded: '🔥', visit_confirmed: '✅', handoff: '📞' }

  return (
    <DashboardLayout requiredRole="client">
      <TopBar title="Dashboard" breadcrumbs={['Home']} />

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Leads" value={stats?.totalLeads?.value} delta={stats?.totalLeads?.delta} icon="👥" loading={statsLoading} />
        <StatCard label="Hot Leads" value={stats?.hotLeads?.value} delta={stats?.hotLeads?.delta} icon="🔥" loading={statsLoading} />
        <StatCard label="Visits Confirmed" value={stats?.visitsConfirmed?.value} delta={stats?.visitsConfirmed?.delta} icon="✅" loading={statsLoading} />
        <StatCard label="Handoffs" value={stats?.handoffs?.value} delta={stats?.handoffs?.delta} icon="📞" loading={statsLoading} />
      </div>

      {/* Row 1: Lead Volume + Score Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3">
          <ChartWrapper title="Lead Volume Over Time" subtitle="Last 30 days" loading={lvLoading} empty={!leadVolume?.current?.length}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart>
                <XAxis dataKey="_id" data={leadVolume?.current || []} tick={{ fontSize: 10, fill: 'var(--color-text)' }} tickFormatter={v => v?.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text)' }} />
                <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, color: '#fff' }} />
                <Line data={leadVolume?.previous || []} dataKey="count" stroke="var(--color-accent)" strokeDasharray="5 5" strokeWidth={1.5} dot={false} name="Previous" />
                <Line data={leadVolume?.current || []} dataKey="count" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="Current" />
              </LineChart>
            </ResponsiveContainer>
          </ChartWrapper>
        </div>
        <div className="lg:col-span-2">
          <ChartWrapper title="Score Distribution" subtitle="This month" loading={sdLoading} empty={donutTotal === 0}>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={donutChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  dataKey="value"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {donutChartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="text-center text-2xl font-bold" style={{ color: 'var(--color-text)', marginTop: -20 }}>{donutTotal}</div>
          </ChartWrapper>
        </div>
      </div>

      {/* Row 2: Funnel + Score Over Time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ChartWrapper title="Conversion Funnel" subtitle="This month" loading={fnLoading} empty={!funnel?.totalConversations}>
          <div className="space-y-3">
            {funnelData.map((step, idx) => {
              const prevVal = idx > 0 ? funnelData[idx - 1].value : step.value
              const pct = prevVal > 0 ? Math.round((step.value / prevVal) * 100) : 0
              const totalPct = funnelData[0].value > 0 ? Math.round((step.value / funnelData[0].value) * 100) : 0
              return (
                <div key={step.name}>
                  <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--color-text)' }}>
                    <span>{step.name}</span>
                    <span>{formatNumber(step.value)} ({totalPct}%)</span>
                  </div>
                  <div className="h-6 rounded-full overflow-hidden bg-white/5">
                    <div className="h-full rounded-full transition-all" style={{ width: `${totalPct}%`, background: 'var(--color-primary)' }} />
                  </div>
                  {idx > 0 && prevVal > step.value && (
                    <div className="text-[10px] text-red-400 mt-0.5">↓ {100 - pct}% drop-off</div>
                  )}
                </div>
              )
            })}
          </div>
        </ChartWrapper>

        <ChartWrapper title="Lead Score Over Time" subtitle="Last 30 days" loading={stLoading} empty={!scoreTimeData.length}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={scoreTimeData}>
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--color-text)' }} tickFormatter={v => v?.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--color-text)' }} />
              <Tooltip contentStyle={{ background: '#1e1e2e', border: 'none', borderRadius: 8, color: '#fff' }} />
              <Bar dataKey="hot" stackId="a" fill={SCORE_COLORS.hot} />
              <Bar dataKey="warm" stackId="a" fill={SCORE_COLORS.warm} />
              <Bar dataKey="cold" stackId="a" fill={SCORE_COLORS.cold} />
              <Legend />
            </BarChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </div>

      {/* Row 3: Heatmap + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3">
          <ChartWrapper title="Conversation Heatmap" subtitle="When parents message" loading={hmLoading} empty={!heatmapGrid.length}>
            <div className="overflow-x-auto">
              <div className="grid grid-cols-25 gap-0.5 text-[9px]" style={{ minWidth: 500 }}>
                <div />
                {[...Array(24)].map((_, h) => <div key={h} className="text-center opacity-40">{h}</div>)}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, di) => (
                  <>
                    <div key={day} className="text-right pr-1 opacity-40">{day}</div>
                    {[...Array(24)].map((_, h) => {
                      const cell = heatmapGrid.find(c => c.day === di + 1 && c.hour === h)
                      const opacity = cell ? 0.2 + cell.intensity * 0.8 : 0.05
                      return <div key={`${di}-${h}`} className="w-4 h-4 rounded-sm" style={{ background: `var(--color-primary)`, opacity }} title={`${day} ${h}:00 - ${cell?.count || 0} messages`} />
                    })}
                  </>
                ))}
              </div>
            </div>
          </ChartWrapper>
        </div>
        <div className="lg:col-span-2">
          <ChartWrapper title="Recent Activity" loading={actLoading} empty={!activity?.length} emptyMessage="No recent activity">
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {activity?.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                  <span>{activityIcons[a.type] || '📌'}</span>
                  <div className="flex-1">
                    <p>{a.description}</p>
                    <p className="opacity-40 text-[10px]">{relativeTime(a.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
          </ChartWrapper>
        </div>
      </div>

      {/* Row 4: Quick Lead Preview */}
      <ChartWrapper title="Recent Hot Leads" loading={rlLoading} empty={!recentLeads?.leads?.length} emptyMessage="No hot leads yet">
        <div className="space-y-2">
          {recentLeads?.leads?.slice(0, 5).map(l => (
            <div key={l._id} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-white/5" style={{ color: 'var(--color-text)' }}>
              <div className="flex items-center gap-3">
                <Badge score={l.leadScore} />
                <div>
                  <p className="font-medium">{l.parentName || l.phone}</p>
                  <p className="text-xs opacity-40">{l.interestedClass || 'Class not specified'}</p>
                </div>
              </div>
              <a href={`/client/leads`} className="text-xs px-3 py-1 rounded-lg border border-white/10 hover:bg-white/5">View</a>
            </div>
          ))}
        </div>
      </ChartWrapper>
    </DashboardLayout>
  )
}
