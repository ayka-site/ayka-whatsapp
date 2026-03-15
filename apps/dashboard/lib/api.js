const API_URL = process.env.NEXT_PUBLIC_API_URL || ''

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('ayka_token')
}

function setToken(token) {
  localStorage.setItem('ayka_token', token)
}

function removeToken() {
  localStorage.removeItem('ayka_token')
  localStorage.removeItem('ayka_user')
}

function getUser() {
  if (typeof window === 'undefined') return null
  try {
    const u = localStorage.getItem('ayka_user')
    return u ? JSON.parse(u) : null
  } catch { return null }
}

function setUser(user) {
  localStorage.setItem('ayka_user', JSON.stringify(user))
}

async function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}${path}`, { ...options, headers })

  if (res.status === 401) {
    removeToken()
    if (typeof window !== 'undefined') window.location.href = '/login'
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `API error: ${res.status}`)
  }

  // Handle CSV streams
  if (res.headers.get('content-type')?.includes('text/csv')) {
    return res
  }

  return res.json()
}

module.exports = { apiFetch, getToken, setToken, removeToken, getUser, setUser, API_URL }
