// Write an async function callGroq(systemPrompt, recentMessages) using groq-sdk.
// 
// Setup:
//   const Groq = require('groq-sdk')
//   const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
//
// Steps:
// 1. Take the last 6 items from recentMessages array
// 2. Convert each to Groq format: { role: msg.role, content: msg.content?.text || msg.content }
// 3. Build messages array: first item is { role: 'system', content: systemPrompt },
//    then spread the converted messages
// 4. Call groq.chat.completions.create with:
//    model: 'llama-3.3-70b-versatile', messages, max_tokens: 400, temperature: 0.7
// 5. Return choices[0].message.content as a string
//
// Error handling:
//   If error.status === 429:
//     const waitSeconds = parseInt(error.headers?.['retry-after'] || '30')
//     wait waitSeconds * 1000 ms using a Promise setTimeout
//     retry the call once, return result
//   If error.status === 503 or 500:
//     wait 5000ms then retry once
//   Any other error: log error.message and throw
//
// module.exports = { callGroq }
const Groq = require('groq-sdk')
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

async function callGroq(systemPrompt, recentMessages) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentMessages.slice(-6).map(msg => ({
      role: msg.role,
      content: msg.content?.text || msg.content
    }))
  ]

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 400,
      temperature: 0.7
    })
    return response.choices[0].message.content
  } catch (error) {
    if (error.status === 429) {
      const waitSeconds = parseInt(error.headers?.['retry-after'] || '30')
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000))
      return callGroq(systemPrompt, recentMessages)
    } else if (error.status === 503 || error.status === 500) {
      await new Promise(resolve => setTimeout(resolve, 5000))
      return callGroq(systemPrompt, recentMessages)
    } else {
      console.error('Groq API error:', error.message)
      throw error
    }
  }
}

module.exports = { callGroq }