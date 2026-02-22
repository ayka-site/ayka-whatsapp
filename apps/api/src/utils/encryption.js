const crypto = require('crypto')

const ALGO    = 'aes-256-gcm'
const KEY     = Buffer.from(process.env.ENCRYPTION_KEY, 'hex') // 32-byte hex

function encrypt(text) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGO, KEY, iv)
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  return [
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex')
  ].join(':')
}

function decrypt(payload) {
  const [ivHex, tagHex, encHex] = payload.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const enc = Buffer.from(encHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(enc),
    decipher.final()
  ]).toString('utf8')
}

module.exports = { encrypt, decrypt }
