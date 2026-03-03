'use client'
import { useState, useEffect, useRef } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, SlideOver } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { relativeTime, truncate, dateSeparator } from '../../../lib/format'
const { apiFetch } = require('../../../lib/api')

export default function AdminConversations() {
  const [page, setPage] = useState(1)
  const [score, setScore] = useState('')
  const [search, setSearch] = useState('')
  const [client, setClient] = useState('')
  const [selectedConvo, setSelectedConvo] = useState(null)
  const [messages, setMessages] = useState([])
  const [msgLoading, setMsgLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const msgEndRef = useRef(null)

  const url = `/api/admin/conversations?page=${page}&limit=50${score ? `&score=${score}` : ''}${search ? `&search=${search}` : ''}${client ? `&businessId=${client}` : ''}`
  const { data, loading } = useFetch(url, [page, score, search, client])
  const { data: clientList } = useFetch('/api/admin/clients', [])

  async function selectConvo(convo) {
    setSelectedConvo(convo)
    setMsgLoading(true)
    try {
      const res = await apiFetch(`/api/admin/conversations/${convo._id}/messages?limit=50`)
      setMessages(res.messages || [])
      setHasMore(res.hasMore)
    } catch {}
    setMsgLoading(false)
  }

  async function loadEarlier() {
    if (!messages.length || !selectedConvo) return
    const oldest = messages[0]?.timestamp
    setMsgLoading(true)
    try {
      const res = await apiFetch(`/api/admin/conversations/${selectedConvo._id}/messages?limit=50&before=${oldest}`)
      setMessages([...(res.messages || []), ...messages])
      setHasMore(res.hasMore)
    } catch {}
    setMsgLoading(false)
  }

  useEffect(() => {
    if (messages.length) msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function getDateKey(ts) { return new Date(ts).toLocaleDateString('en-IN') }
  const scores = ['hot', 'warm', 'cold']

  return (
    <DashboardLayout requiredRole="reseller">
      <TopBar title="Conversations" breadcrumbs={['Home', 'Conversations']} />

      <div className="flex gap-0 rounded-xl overflow-hidden border border-white/10" style={{ height: 'calc(100vh - 160px)', background: 'var(--color-sidebar)' }}>
        {/* Left panel */}
        <div className="w-full md:w-[30%] border-r border-white/10 flex flex-col" style={{ display: selectedConvo && typeof window !== 'undefined' && window.innerWidth < 768 ? 'none' : 'flex' }}>
          <div className="p-3 border-b border-white/10 space-y-2">
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search name or phone…" className="w-full px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-transparent outline-none" style={{ color: 'var(--color-text)' }} />
            <div className="flex gap-1 flex-wrap">
              <select value={client} onChange={e => { setClient(e.target.value); setPage(1) }}
                className="px-2 py-1 text-[10px] rounded-lg border border-white/10 bg-transparent" style={{ color: 'var(--color-text)' }}>
                <option value="">All Clients</option>
                {(Array.isArray(clientList) ? clientList : []).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
              {['', ...scores].map(s => (
                <button key={s} onClick={() => { setScore(s); setPage(1) }}
                  className={`px-2 py-1 text-[10px] rounded-full border ${score === s ? 'bg-white/10 border-white/20' : 'border-white/10'}`}
                  style={{ color: 'var(--color-text)' }}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}</button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="skeleton h-16 w-full" />)}</div>
            ) : !data?.conversations?.length ? (
              <div className="p-8 text-center text-xs opacity-40">No conversations</div>
            ) : data.conversations.map(c => (
              <div key={c._id} onClick={() => selectConvo(c)}
                className={`p-3 border-b border-white/5 cursor-pointer hover:bg-white/5 ${selectedConvo?._id === c._id ? 'bg-white/10' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{c.parentName || c.phone}</p>
                      <Badge score={c.leadScore} />
                    </div>
                    <p className="text-[10px] opacity-40 truncate">{c.businessName || ''} {c.studentName ? `· ${c.studentName}` : ''}</p>
                    <p className="text-xs opacity-40 truncate mt-0.5">{truncate(c.lastMessage, 45)}</p>
                  </div>
                  <span className="text-[10px] opacity-30 ml-2">{relativeTime(c.lastMessageAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col" style={{ display: !selectedConvo && typeof window !== 'undefined' && window.innerWidth < 768 ? 'none' : 'flex' }}>
          {!selectedConvo ? (
            <div className="flex-1 flex items-center justify-center text-sm opacity-30">
              <div className="text-center"><span className="text-4xl block mb-3">💬</span><p>Select a conversation</p></div>
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button className="md:hidden text-sm" onClick={() => setSelectedConvo(null)}>←</button>
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{selectedConvo.parentName || selectedConvo.phone}</p>
                    <p className="text-[10px] opacity-40">{selectedConvo.phone} · {selectedConvo.businessName || ''}</p>
                  </div>
                  <Badge score={selectedConvo.leadScore} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: 'rgba(0,0,0,0.15)' }}>
                {hasMore && (
                  <button onClick={loadEarlier} className="w-full text-xs text-center py-2 opacity-40 hover:opacity-70">
                    {msgLoading ? 'Loading…' : '↑ Load earlier messages'}
                  </button>
                )}
                {messages.map((msg, idx) => {
                  const prevMsg = messages[idx - 1]
                  const showDate = !prevMsg || getDateKey(msg.timestamp) !== getDateKey(prevMsg.timestamp)
                  const isUser = msg.direction === 'inbound'
                  return (
                    <div key={msg._id || idx}>
                      {showDate && <div className="text-center my-4"><span className="system-pill">{dateSeparator(msg.timestamp)}</span></div>}
                      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] px-3.5 py-2.5 text-sm ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
                          <p style={{ whiteSpace: 'pre-wrap' }}>{msg.content?.text || ''}</p>
                          <p className="text-[10px] opacity-40 mt-1 text-right">{new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={msgEndRef} />
              </div>
              <div className="p-3 border-t border-white/10">
                <div className="px-4 py-3 rounded-lg bg-white/5 text-xs text-center opacity-40" style={{ color: 'var(--color-text)' }}>Read-only view</div>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  )
}
