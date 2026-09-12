const logger = require('../utils/logger')

const GRAPH_API_VERSION = String(process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0')
  .trim()
  .replace(/^\/+|\/+$/g, '')
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const DOWNLOAD_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.WHATSAPP_MEDIA_DOWNLOAD_TIMEOUT_MS || '15000', 10) || 15000,
)
const TRANSCRIPTION_TIMEOUT_MS = Math.max(
  10000,
  Number.parseInt(process.env.GROQ_TRANSCRIPTION_TIMEOUT_MS || '30000', 10) || 30000,
)
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

async function parseJsonSafe(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (_) {
    return { text }
  }
}

async function transcribeAudio(mediaId, accessToken) {
  try {
    const token = String(accessToken || '').trim()
    const groqKey = String(process.env.GROQ_API_KEY || '').trim()
    if (!mediaId || !token || !groqKey) {
      logger.warn({ mediaId: Boolean(mediaId), hasMetaToken: Boolean(token), hasGroqKey: Boolean(groqKey) }, 'Voice transcription is not fully configured')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }

    const mediaInfoResponse = await fetch(
      `${GRAPH_BASE_URL}/${encodeURIComponent(String(mediaId))}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      },
    )
    const mediaInfo = await parseJsonSafe(mediaInfoResponse)
    if (!mediaInfoResponse.ok) {
      logger.error({ mediaId, status: mediaInfoResponse.status, data: mediaInfo }, 'Meta media lookup failed')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }

    const mediaUrl = String(mediaInfo?.url || '').trim()
    const mimeType = String(mediaInfo?.mime_type || 'audio/ogg').trim()
    const declaredFileSize = Number(mediaInfo?.file_size || 0)

    if (!mediaUrl || !/^https:\/\//i.test(mediaUrl)) {
      logger.error({ mediaId }, 'Meta returned an invalid media download URL')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }
    if (declaredFileSize > MAX_AUDIO_BYTES) {
      logger.warn({ mediaId, declaredFileSize }, 'Audio file exceeds transcription size limit')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }

    const audioResponse = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: 'error',
    })
    if (!audioResponse.ok) {
      logger.error({ mediaId, status: audioResponse.status }, 'WhatsApp media download failed')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }

    const contentLength = Number(audioResponse.headers.get('content-length') || 0)
    if (contentLength > MAX_AUDIO_BYTES) {
      logger.warn({ mediaId, contentLength }, 'Downloaded audio exceeds transcription size limit')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }

    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer())
    if (!audioBuffer.length || audioBuffer.length > MAX_AUDIO_BYTES) {
      logger.warn({ mediaId, bytes: audioBuffer.length }, 'Downloaded audio size is invalid')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }

    const extMap = {
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'mp4',
      'audio/opus': 'opus',
      'audio/wav': 'wav',
      'audio/webm': 'webm',
    }
    const ext = extMap[mimeType] || 'ogg'

    const form = new FormData()
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `voice.${ext}`)
    form.append('model', 'whisper-large-v3-turbo')
    form.append('response_format', 'json')
    // Do not force a language. Parents may send Hindi, English, Hinglish or
    // code-switched audio; Whisper should detect the spoken language naturally.

    const transcriptionResponse = await fetch(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${groqKey}` },
        body: form,
        signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
      },
    )
    const transcription = await parseJsonSafe(transcriptionResponse)
    if (!transcriptionResponse.ok) {
      logger.error({ mediaId, status: transcriptionResponse.status, data: transcription }, 'Groq transcription request failed')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }

    const text = String(transcription?.text || '').trim()
    if (!text) {
      logger.warn({ mediaId }, 'Whisper returned empty transcription')
      return '__VOICE_TRANSCRIPTION_EMPTY__'
    }

    logger.info({ mediaId, textLength: text.length }, 'Audio transcribed successfully')
    return text
  } catch (err) {
    logger.error({ err: { message: err?.message, name: err?.name }, mediaId }, 'Audio transcription failed')
    return '__VOICE_TRANSCRIPTION_FAILED__'
  }
}

module.exports = { transcribeAudio }
