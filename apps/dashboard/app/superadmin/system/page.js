'use client'
import { useState } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { relativeTime, formatNumber } from '../../../lib/format'

export default function SuperAdminSystem() {
  const [tab, setTab] = useState('health')
  const { data: health, loading: hL } = useFetch('/api/superadmin/system/health', [])
  const { data: errors } = useFetch('/api/superadmin/system/errors', [])
  const { data: apiUsage } = useFetch('/api/superadmin/system/api-usage', [])
  const llm = apiUsage?.llm || null

  const tabs = [
    { key: 'health', label: '🟢 Health' },
    { key: 'errors', label: '⚠️ Errors' },
    { key: 'api', label: '📊 API Usage' },
  ]

  return (
    <DashboardLayout requiredRole="superadmin">
      <TopBar title="System" breadcrumbs={['Home', 'System']} />

      <div className="flex gap-2 mb-6">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm rounded-lg border ${tab === t.key ? 'bg-white/10 border-white/20' : 'border-white/10'}`}
            style={{ color: 'var(--color-text)' }}>{t.label}</button>
        ))}
      </div>

      {tab === 'health' && (
        <div className="space-y-6">
          {hL ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { name: 'MongoDB', status: typeof health?.mongodb === 'object' ? health.mongodb.status : (health?.mongodb || 'unknown') },
                  { name: 'Redis', status: typeof health?.redis === 'object' ? health.redis.status : (health?.redis || 'unknown') },
                  { name: 'WhatsApp API', status: typeof health?.whatsapp === 'object' ? health.whatsapp.status : (health?.whatsapp || 'unknown') },
                ].map(svc => (
                  <div key={svc.name} className="rounded-xl border border-white/10 p-4" style={{ background: 'var(--color-surface)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{svc.name}</span>
                      <span className={`w-3 h-3 rounded-full ${svc.status === 'connected' || svc.status === 'ok' ? 'bg-green-500' : svc.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                    </div>
                    <p className="text-xs mt-1 opacity-50 capitalize">{String(svc.status)}</p>
                  </div>
                ))}
              </div>

              {health?.mongodb?.collections && (
                <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
                  <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Database Stats</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div><p className="text-xs opacity-40">Conversations</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{formatNumber(health.mongodb.collections.conversations)}</p></div>
                    <div><p className="text-xs opacity-40">Messages</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{formatNumber(health.mongodb.collections.messages)}</p></div>
                    <div><p className="text-xs opacity-40">Contacts</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{formatNumber(health.mongodb.collections.contacts)}</p></div>
                    <div><p className="text-xs opacity-40">Appointments</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{formatNumber(health.mongodb.collections.appointments)}</p></div>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>System Info</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div><p className="text-xs opacity-40">Uptime</p><p style={{ color: 'var(--color-text)' }}>{health?.uptime ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m` : '—'}</p></div>
                  <div><p className="text-xs opacity-40">Memory</p><p style={{ color: 'var(--color-text)' }}>{health?.memory || '—'}</p></div>
                  <div><p className="text-xs opacity-40">Node Version</p><p style={{ color: 'var(--color-text)' }}>{health?.nodeVersion || '—'}</p></div>
                  <div><p className="text-xs opacity-40">Environment</p><p style={{ color: 'var(--color-text)' }}>{health?.env || '—'}</p></div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'errors' && (
        <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-surface)' }}>
          {!errors?.errors?.length ? (
            <div className="p-8 text-center text-xs opacity-40">No recent errors</div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs uppercase tracking-wider opacity-40 border-b border-white/10">
                <th className="p-3 text-left">Time</th>
                <th className="p-3 text-left">Level</th>
                <th className="p-3 text-left">Message</th>
                <th className="p-3 text-left">Source</th>
              </tr></thead>
              <tbody>
                {(errors?.errors || []).map((err, i) => (
                  <tr key={i} className="border-b border-white/5">
                    <td className="p-3 text-xs opacity-50">{relativeTime(err.timestamp)}</td>
                    <td className="p-3"><Badge score={err.level === 'error' ? 'cancelled' : err.level === 'warn' ? 'pending' : 'confirmed'} /></td>
                    <td className="p-3 text-xs max-w-[400px]" style={{ color: 'var(--color-text)' }}><pre className="whitespace-pre-wrap font-mono text-[11px]">{err.message}</pre></td>
                    <td className="p-3 text-xs opacity-40">{err.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'api' && (
        <div className="space-y-6">
          {llm ? (
            <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text)' }}>LLM Stats <span className="text-[10px] font-normal opacity-40 ml-2">(since last restart)</span></h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><p className="text-xs opacity-40">Provider</p><p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{llm.provider || '—'}</p></div>
                <div><p className="text-xs opacity-40">Fallback</p><p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{llm.fallbackProvider || '—'}</p></div>
                <div><p className="text-xs opacity-40">Deployment</p><p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{llm.deployment || '—'}</p></div>
                <div><p className="text-xs opacity-40">Total Calls</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{formatNumber(llm.totalCalls || 0)}</p></div>
              </div>

              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div><p className="text-xs opacity-40">Successes</p><p className="text-lg font-bold" style={{ color: '#22c55e' }}>{formatNumber(llm.successes || 0)}</p></div>
                  <div><p className="text-xs opacity-40">Failures</p><p className="text-lg font-bold" style={{ color: llm.failures > 0 ? '#ef4444' : 'var(--color-text)' }}>{formatNumber(llm.failures || 0)}</p></div>
                  <div><p className="text-xs opacity-40">Retries</p><p className="text-lg font-bold" style={{ color: llm.retries > 0 ? '#f59e0b' : 'var(--color-text)' }}>{formatNumber(llm.retries || 0)}</p></div>
                  <div><p className="text-xs opacity-40">Tracked Since</p><p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{llm.resetAt ? relativeTime(llm.resetAt) : '—'}</p></div>
                </div>
              </div>

              {llm.concurrency && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-xs font-semibold mb-2 opacity-60">Concurrency</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div><p className="text-xs opacity-40">Active</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{llm.concurrency.current}</p></div>
                    <div><p className="text-xs opacity-40">Max Slots</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{llm.concurrency.max}</p></div>
                    <div><p className="text-xs opacity-40">Peak</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{llm.concurrency.peak}</p></div>
                    <div><p className="text-xs opacity-40">Queued</p><p className="text-lg font-bold" style={{ color: llm.concurrency.queued > 0 ? '#f59e0b' : 'var(--color-text)' }}>{llm.concurrency.queued}</p></div>
                  </div>
                </div>
              )}

              {(llm.fallbackAttempts > 0 || llm.fallbackSuccesses > 0) && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-xs font-semibold mb-2 opacity-60">Fallback Usage</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div><p className="text-xs opacity-40">Fallback Attempts</p><p className="text-lg font-bold" style={{ color: '#f59e0b' }}>{formatNumber(llm.fallbackAttempts || 0)}</p></div>
                    <div><p className="text-xs opacity-40">Fallback Successes</p><p className="text-lg font-bold" style={{ color: '#22c55e' }}>{formatNumber(llm.fallbackSuccesses || 0)}</p></div>
                    <div><p className="text-xs opacity-40">Fallback Rate</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{llm.totalCalls > 0 ? `${(((llm.fallbackAttempts || 0) / llm.totalCalls) * 100).toFixed(1)}%` : '0%'}</p></div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 p-8 text-center text-sm opacity-70" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              No LLM usage data available yet.
            </div>
          )}

          {(apiUsage?.groqTokensToday || apiUsage?.groqTokensMonth || apiUsage?.costEstimate) && (
            <div className="rounded-xl border border-white/10 p-6" style={{ background: 'var(--color-surface)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Usage Estimates</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div><p className="text-xs opacity-40">Estimated Tokens Today</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{formatNumber(apiUsage?.groqTokensToday || 0)}</p></div>
                <div><p className="text-xs opacity-40">Estimated Tokens Month</p><p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{formatNumber(apiUsage?.groqTokensMonth || 0)}</p></div>
                <div><p className="text-xs opacity-40">Estimated Cost</p><p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{apiUsage?.costEstimate || '—'}</p></div>
              </div>
            </div>
          )}
        </div>
      )}
    </DashboardLayout>
  )
}
