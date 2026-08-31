'use client'
import { formatNumber, deltaInfo } from '../lib/format'

export function StatCard({ label, value, delta, icon, loading }) {
  if (loading) {
    return (
      <div className="rounded-xl p-5 border border-white/10" style={{ background: 'var(--color-sidebar)' }}>
        <div className="skeleton h-4 w-20 mb-3" />
        <div className="skeleton h-8 w-16 mb-2" />
        <div className="skeleton h-3 w-24" />
      </div>
    )
  }

  const d = deltaInfo(delta)

  return (
    <div className="rounded-xl p-5 border border-white/10 hover:border-white/20 transition-colors" style={{ background: 'var(--color-sidebar)' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium opacity-60 uppercase tracking-wide" style={{ color: 'var(--color-text)' }}>{label}</span>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
        {formatNumber(value)}
      </div>
      {delta !== undefined && (
        <div className={`text-xs mt-1 font-medium ${d.color}`}>
          {d.arrow} {d.text} vs prev period
        </div>
      )}
    </div>
  )
}

export function Badge({ score, className = '' }) {
  const colors = {
    hot: 'bg-[#ef4444] text-white',
    warm: 'bg-[#f59e0b] text-gray-900',
    cold: 'bg-[#64748b] text-white',
    confirmed: 'bg-green-600 text-white',
    cancelled: 'bg-red-600 text-white',
    completed: 'bg-green-600 text-white',
    no_show: 'bg-gray-500 text-white',
    pending: 'bg-yellow-500 text-gray-900',
    active: 'bg-green-600 text-white',
    paused: 'bg-yellow-500 text-gray-900',
    error: 'bg-red-600 text-white',
  }

  const key = (score || '').toLowerCase()
  const colorClass = colors[key] || 'bg-gray-500 text-white'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass} ${className}`}>
      {(score || '').charAt(0).toUpperCase() + (score || '').slice(1)}
    </span>
  )
}

export function SlideOver({ open, onClose, title, children }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-lg h-full overflow-y-auto shadow-2xl border-l border-white/10"
        style={{ animation: 'slideIn 150ms ease forwards', background: 'var(--color-sidebar)', color: 'var(--color-text)' }}
      >
        <style jsx>{`
          @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        `}</style>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
          <button onClick={onClose} className="text-xl opacity-70 hover:opacity-100" style={{ color: 'var(--color-text)' }}>✕</button>
        </div>
        <div className="p-4" style={{ color: 'var(--color-text)' }}>{children}</div>
      </div>
    </div>
  )
}

export function ChartWrapper({ title, subtitle, loading, empty, emptyMessage, children }) {
  return (
    <div className="rounded-xl p-5 border border-white/10" style={{ background: 'var(--color-sidebar)' }}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
        {subtitle && <p className="text-xs opacity-70 mt-0.5" style={{ color: 'var(--color-text)' }}>{subtitle}</p>}
      </div>
      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-48 w-full" />
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center justify-center h-48 text-sm opacity-70" style={{ color: 'var(--color-text)' }}>
          <span className="text-3xl mb-2">📭</span>
          <p>{emptyMessage || 'No data available'}</p>
        </div>
      ) : children}
    </div>
  )
}

export function DataTable({ columns, data, loading, emptyMessage, onRowClick, page, totalPages, onPageChange, total, limit }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-sidebar)' }}>
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-10 w-full" />)}
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 p-12 text-center" style={{ background: 'var(--color-sidebar)' }}>
        <span className="text-4xl block mb-3">📭</span>
        <p className="text-sm opacity-50">{emptyMessage || 'No data found'}</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: 'var(--color-sidebar)' }}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              {columns.map(col => (
                <th key={col.key} className="text-left px-4 py-3 text-xs font-medium uppercase tracking-wide opacity-50" style={{ color: 'var(--color-text)' }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr
                key={row._id || idx}
                className={`border-b border-white/5 hover:bg-white/5 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map(col => (
                  <td key={col.key} className="px-4 py-3 text-sm" style={{ color: 'var(--color-text)' }}>
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
          <span className="text-xs opacity-50">
            Showing {((page - 1) * (limit || 25)) + 1}–{Math.min(page * (limit || 25), total || 0)} of {formatNumber(total)} results
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1 text-xs rounded border border-white/10 disabled:opacity-30 hover:bg-white/5"
              style={{ color: 'var(--color-text)' }}
            >
              ← Prev
            </button>
            <button
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1 text-xs rounded border border-white/10 disabled:opacity-30 hover:bg-white/5"
              style={{ color: 'var(--color-text)' }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function TopBar({ title, breadcrumbs, children, action }) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
      <div>
        {breadcrumbs && (
          <div className="flex items-center gap-1.5 text-xs opacity-40 mb-1">
            {breadcrumbs.map((b, i) => (
              <span key={i}>{i > 0 && ' / '}{b}</span>
            ))}
          </div>
        )}
        <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {action}
        {children}
      </div>
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-[#1a1a24] border border-white/10 rounded-2xl shadow-2xl overflow-hidden ${wide ? 'w-full max-w-3xl' : 'w-full max-w-md'}`}>
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 text-xl leading-none">✕</button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, destructive }) {
  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} title={title || 'Confirm'}>
      <p className="text-sm opacity-70 mb-6" style={{ color: 'var(--color-text)' }}>{message}</p>
      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>Cancel</button>
        <button onClick={onConfirm} className={`px-4 py-2 text-sm rounded-lg font-medium text-white ${destructive ? 'bg-red-600 hover:bg-red-700' : 'hover:opacity-90'}`} style={destructive ? {} : { background: 'var(--color-primary)' }}>{confirmLabel || 'Confirm'}</button>
      </div>
    </Modal>
  )
}

export function FormField({ label, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5 opacity-60" style={{ color: 'var(--color-text)' }}>{label}</label>
      {children}
      {hint && <p className="text-[10px] opacity-40 mt-1">{hint}</p>}
    </div>
  )
}

export function FormInput({ value, onChange, placeholder, type = 'text', required, disabled }) {
  return (
    <input type={type} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} required={required} disabled={disabled}
      className="w-full px-3 py-2 text-sm rounded-lg border border-white/10 bg-transparent outline-none focus:border-white/30 disabled:opacity-40"
      style={{ color: 'var(--color-text)' }} />
  )
}

export function FormSelect({ value, onChange, options, placeholder }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm rounded-lg border outline-none focus:border-slate-400">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
