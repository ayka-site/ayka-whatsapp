const Groq   = require('groq-sdk')
const axios  = require('axios')
const logger = require('../utils/logger')

/**
 * transcription.service.js v4.0 - Groq Whisper audio transcription
 *
 * Flow:
 *   1. Get media URL from Meta (using mediaId + accessToken)
 *   2. Download the audio binary from Meta CDN
 *   3. Send to Groq Whisper (whisper-large-v3-turbo) for transcription
 *   4. Return transcribed text
 *
 * On any failure: returns '__VOICE_TRANSCRIPTION_FAILED__' (never throws)
 * conversation.engine.js handles the failure message to the user.
 */

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// Timeout for downloading audio from Meta CDN (15 seconds)
const DOWNLOAD_TIMEOUT_MS = 15000
// Max audio file size we'll process (25MB - Groq's limit)
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/**
 * transcribeAudio - download WhatsApp voice note and transcribe via Groq Whisper
 *
 * @param {string} mediaId - WhatsApp media ID from the message payload
 * @param {string} accessToken - Meta API access token for this business
 * @returns {string} - transcribed text, or failure marker
 */
async function transcribeAudio(mediaId, accessToken) {
  try {
    // ── Step 1: Get the download URL from Meta ──
    const mediaInfoRes = await axios.get(
      `https://graph.facebook.com/v21.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 5000,
      }
    )

    const mediaUrl  = mediaInfoRes.data?.url
    const mimeType  = mediaInfoRes.data?.mime_type || 'audio/ogg'
    const fileSize  = mediaInfoRes.data?.file_size || 0

    if (!mediaUrl) {
      logger.error({ mediaId }, 'No download URL returned from Meta for media')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }

    // Guard: reject files that are too large
    if (fileSize > MAX_AUDIO_BYTES) {
      logger.warn({ mediaId, fileSize }, 'Audio file too large for transcription')
      return '__VOICE_TRANSCRIPTION_FAILED__'
    }

    // ── Step 2: Download the audio binary ──
    const audioRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
    })

    const audioBuffer = Buffer.from(audioRes.data)

    // Determine file extension from MIME type
    const extMap = {
      'audio/ogg':  'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4':  'mp4',
      'audio/opus': 'opus',
      'audio/wav':  'wav',
      'audio/webm': 'webm',
    }
    const ext = extMap[mimeType] || 'ogg'

    // ── Step 3: Send to Groq Whisper for transcription ──
    // Groq SDK expects a File-like object. We construct one from the buffer.
    const file = new File([audioBuffer], `voice.${ext}`, { type: mimeType })

    const transcription = await groq.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      language: 'hi', // Default to Hindi - most WhatsApp voice notes in India are Hindi/Hinglish
      response_format: 'text',
    })

    const text = (typeof transcription === 'string' ? transcription : transcription.text || '').trim()

    if (!text) {
      logger.warn({ mediaId }, 'Whisper returned empty transcription')
      return '__VOICE_TRANSCRIPTION_EMPTY__'
    }

    logger.info({ mediaId, textLength: text.length }, 'Audio transcribed successfully')
    return text

  } catch (err) {
    logger.error({ err, mediaId }, 'Audio transcription failed')
    return '__VOICE_TRANSCRIPTION_FAILED__'
  }
}

module.exports = { transcribeAudio }
