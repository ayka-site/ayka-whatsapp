'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import DashboardLayout from '../../../components/DashboardLayout'
import { TopBar, Badge, SlideOver } from '../../../components/UI'
import { useFetch } from '../../../hooks/useFetch'
import { relativeTime, truncate, dateSeparator, formatDate, formatAppointmentPreference } from '../../../lib/format'
const { apiFetch } = require('../../../lib/api')

export default function ClientConversations() {
  const [page, setPage] = useState(1)
  const [score, setScore] = useState('')
  const [search, setSearch] = useState('')
  const [selectedConvo, setSelectedConvo] = useState(null)
  const [messages, setMessages] = useState([])
  const [msgLoading, setMsgLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [leadProfile, setLeadProfile] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [replyPolicy, setReplyPolicy] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [replyError, setReplyError] = useState('')
  const msgEndRef = useRef(null)

  const url = `/api/client/conversations?page=${page}&limit=50${score ? `&score=${score}` : ''}${search ? `&search=${search}` : ''}`
  const { data, loading } = useFetch(url, [page, score, search])

  async function selectConvo(convo) {
    setSelectedConvo(convo)
    setReplyError('')
    setReplyText('')
    setMsgLoading(true)
    try {
      const res = await apiFetch(`/api/client/conversations/${convo._id}/messages?limit=50`)
      setMessages(res.messages || [])
      setHasMore(res.hasMore)
      setReplyPolicy(res.replyPolicy || null)
    } catch {
      setReplyPolicy(null)
    }
    setMsgLoading(false)
  }

  async function loadEarlier() {
    if (!messages.length || !selectedConvo) return
    const oldest = messages[0]?.timestamp
    setMsgLoading(true)
    try {
      const res = await apiFetch(`/api/client/conversations/${selectedConvo._id}/messages?limit=50&before=${oldest}`)
      setMessages([...(res.messages || []), ...messages])
      setHasMore(res.hasMore)
      if (res.replyPolicy) setReplyPolicy(res.replyPolicy)
    } catch {}
    setMsgLoading(false)
  }

  async function openProfile() {
    if (!selectedConvo) return
    try {
      const detail = await apiFetch(`/api/client/leads/${selectedConvo._id}`)
      setLeadProfile(detail)
      setProfileOpen(true)
    } catch {}
  }

  async function sendReply() {
    if (!selectedConvo || replySending) return
    const text = String(replyText || '').trim()
    if (!text) return

    setReplySending(true)
    setReplyError('')
    try {
      const res = await apiFetch(`/api/client/conversations/${selectedConvo._id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      if (res?.message) {
        setMessages(prev => [...prev, res.message])
      }
      if (res?.replyPolicy) setReplyPolicy(res.replyPolicy)
      setReplyText('')
    } catch (err) {
      setReplyError(err.message || 'Failed to send reply')
      try {
        const refreshed = await apiFetch(`/api/client/conversations/${selectedConvo._id}/messages?limit=50`)
        if (refreshed?.replyPolicy) setReplyPolicy(refreshed.replyPolicy)
      } catch {}
    }
    setReplySending(false)
  }

  useEffect(() => {
    if (messages.length) msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Group messages by date for separators
  function getDateKey(ts) {
    return new Date(ts).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  const scores = ['hot', 'warm', 'cold']

  function replyBlockReason(reason) {
    switch (reason) {
      case 'feature_disabled': return 'Replies from dashboard are disabled for this business.'
      case 'handoff_required': return 'Reply is available only after bot handoff.'
      case 'outside_24h_window': return 'Free 24-hour user window has expired. Paid replies are not enabled yet for this business.'
      case 'no_inbound_message': return 'No inbound customer message found for this conversation.'
      default: return 'Reply is currently unavailable for this conversation.'
    }
  }

  return (
    <DashboardLayout requiredRole="client">
      <TopBar title="Conversations" breadcrumbs={['Home', 'Conversations']} />

      <div className="flex gap-0 rounded-xl overflow-hidden border border-white/10" style={{ height: 'calc(100vh - 160px)', background: 'var(--color-sidebar)' }}>
        {/* Left panel - conversation list */}
        <div className="w-full md:w-[30%] border-r border-white/10 flex flex-col" style={{ display: selectedConvo && typeof window !== 'undefined' && window.innerWidth < 768 ? 'none' : 'flex' }}>
          {/* Filters */}
          <div className="p-3 border-b border-white/10 space-y-2">
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search name or phone…"
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-transparent outline-none"
              style={{ color: 'var(--color-text)' }}
            />
            <div className="flex gap-1">
              {['', ...scores].map(s => (
                <button key={s} onClick={() => { setScore(s); setPage(1) }}
                  className={`px-2 py-1 text-[10px] rounded-full border ${score === s ? 'bg-white/10 border-white/20' : 'border-white/10'}`}
                  style={{ color: 'var(--color-text)' }}
                >{s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}</button>
              ))}
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-3">
                {[...Array(8)].map((_, i) => <div key={i} className="skeleton h-16 w-full" />)}
              </div>
            ) : !data?.conversations?.length ? (
              <div className="p-8 text-center text-xs opacity-40">No conversations yet</div>
            ) : (
              data.conversations.map(c => (
                <div
                  key={c._id}
                  onClick={() => selectConvo(c)}
                  className={`p-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors ${selectedConvo?._id === c._id ? 'bg-white/10' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{c.parentName || c.phone}</p>
                        <Badge score={c.leadScore} />
                      </div>
                      {c.studentName && <p className="text-[10px] opacity-40 truncate">{c.studentName} · {c.interestedClass || ''}</p>}
                      <p className="text-xs opacity-40 truncate mt-0.5">{truncate(c.lastMessage, 50)}</p>
                    </div>
                    <div className="flex flex-col items-end ml-2">
                      <span className="text-[10px] opacity-30 whitespace-nowrap">{relativeTime(c.lastMessageAt)}</span>
                      {c.status === 'active' && <span className="w-2 h-2 rounded-full bg-green-400 mt-1" />}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel - message thread */}
        <div className="flex-1 flex flex-col" style={{ display: !selectedConvo && typeof window !== 'undefined' && window.innerWidth < 768 ? 'none' : 'flex' }}>
          {!selectedConvo ? (
            <div className="flex-1 flex items-center justify-center text-sm opacity-30">
              <div className="text-center">
                <span className="text-4xl block mb-3">💬</span>
                <p>Select a conversation to view messages</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-3 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button className="md:hidden text-sm" onClick={() => setSelectedConvo(null)}>←</button>
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{selectedConvo.parentName || selectedConvo.phone}</p>
                    <p className="text-xs opacity-40">{selectedConvo.phone}</p>
                  </div>
                  <Badge score={selectedConvo.leadScore} />
                </div>
                <button onClick={openProfile} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5" style={{ color: 'var(--color-text)' }}>
                  View Profile
                </button>
              </div>

              {/* Messages */}
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
                      {showDate && (
                        <div className="text-center my-4">
                          <span className="system-pill">{dateSeparator(msg.timestamp)}</span>
                        </div>
                      )}
                      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] px-3.5 py-2.5 text-sm ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
                          <p style={{ whiteSpace: 'pre-wrap' }}>{msg.content?.text || ''}</p>
                          <p className="text-[10px] opacity-40 mt-1 text-right">
                            {new Date(msg.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={msgEndRef} />
              </div>

              {/* Handoff reply composer */}
              <div className="p-3 border-t border-white/10 space-y-2">
                {replyError && (
                  <p className="text-xs text-red-400">{replyError}</p>
                )}

                {replyPolicy?.canReply ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          sendReply()
                        }
                      }}
                      placeholder={replyPolicy?.mode === 'paid' ? 'Type a paid-reply message…' : 'Type a handoff reply…'}
                      className="flex-1 px-3 py-2 text-sm rounded-lg border border-white/10 bg-transparent outline-none focus:border-white/30"
                      style={{ color: 'var(--color-text)' }}
                      disabled={replySending}
                    />
                    <button
                      onClick={sendReply}
                      disabled={replySending || !replyText.trim()}
                      className="px-4 py-2 text-sm rounded-lg font-medium text-white disabled:opacity-50"
                      style={{ background: 'var(--color-primary)' }}
                    >
                      {replySending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                ) : (
                  <div className="px-4 py-3 rounded-lg bg-white/5 text-xs text-center opacity-70" style={{ color: 'var(--color-text)' }}>
                    {replyBlockReason(replyPolicy?.reason)}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Lead profile slide-over */}
      <SlideOver open={profileOpen} onClose={() => setProfileOpen(false)} title="Full Lead Profile">
        {leadProfile && (
          <div className="space-y-4 text-sm" style={{ color: 'var(--color-text)' }}>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Parent Name</p><p className="font-medium">{leadProfile.flowState?.collectedData?.parentName || '-'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Phone</p><p className="font-medium">{leadProfile.phone || '-'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Student Name</p><p className="font-medium">{leadProfile.flowState?.collectedData?.studentName || '-'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Class</p><p className="font-medium">{leadProfile.flowState?.collectedData?.interestedClass || '-'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Alt Phone</p><p className="font-medium">{leadProfile.flowState?.collectedData?.altPhone || '-'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Visit Time</p><p className="font-medium">{leadProfile.flowState?.collectedData?.preferredVisitTime || '-'}</p></div>
            </div>
            <hr />
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Score</p><Badge score={leadProfile.leadScore} /></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Reason</p><p>{leadProfile.leadScoreReason || '-'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Visit Confirmed</p><p>{leadProfile.flowState?.visitConfirmed ? 'Yes' : 'No'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Handoff</p><p>{leadProfile.flowState?.handoffTriggered ? 'Yes' : 'No'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Messages</p><p>{leadProfile.messageCount ?? 0}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Source</p><p>{leadProfile.source?.sourceType || 'direct'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>First Contact</p><p>{formatDate(leadProfile.openedAt) || '-'}</p></div>
              <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Duration</p><p>{leadProfile.openedAt ? `Since ${formatDate(leadProfile.openedAt)}` : '-'}</p></div>
            </div>
            {leadProfile.appointment && (
              <>
                <hr />
                <h3 className="font-semibold">Appointment</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Scheduled</p><p>{formatAppointmentPreference(leadProfile.appointment.scheduledAt, leadProfile.appointment.rawPreference)}</p></div>
                  <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Status</p><Badge score={leadProfile.appointment.status} /></div>
                  <div><p className="text-xs opacity-80" style={{ color: 'var(--color-text)' }}>Documents</p><p>{leadProfile.appointment.documentsAdvised?.join(', ') || '-'}</p></div>
                </div>
              </>
            )}
          </div>
        )}
      </SlideOver>
    </DashboardLayout>
  )
}
