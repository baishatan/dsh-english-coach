/* LOCAL PORTABLE VENDOR MODIFICATION, 2026-10-30.
 * Only package-location import specifiers changed; prior code/attribution retained.
 * Source snapshot SHA256: 67bc2c9ff3e64eea7c07fa3af4c181b1e2fb7a7d4298ddeeab56efecf790111a
 * Exact original identity and byte patches: speech/vendor/SOURCE.json.
 */
import assert from 'node:assert/strict'
import { misakiEnglish } from './frontend/lib/misaki-english.js'
import { loadWordG2p } from './word-g2p.mjs'

// shortcut: these cues cover explicit contexts; use a contextual model for unrestricted sense and tense inference.
function correctKnownReadings(tokens, accent) {
  const corrections = [], words = tokens.map(token => token.text.toLowerCase())
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    let target
    if (words[i] === 'read' && ['VB', 'VBP', 'VBZ'].includes(token.tag)) {
      let left = i, right = i + 1
      while (left > 0 && !/^[.!?;]+$/.test(words[left - 1])) left--
      while (right < words.length && !/^[.!?;]+$/.test(words[right])) right++
      const clause = words.slice(left, right)
      const pastCue = clause.some((word, j) => word === 'yesterday' || word === 'ago' ||
        (word === 'last' && ['night', 'week', 'month', 'year'].includes(clause[j + 1])))
      target = token.tag === 'VBP' && pastCue ? 'ɹˈɛd' : accent === 'us' ? 'ɹˈid' : 'ɹˈiːd'
    } else if (words[i] === 'lead' &&
      ((words[i - 2] === 'made' && ['of', 'from'].includes(words[i - 1])) ||
       ['poisoning', 'pipe', 'pipes', 'paint', 'metal', 'ore'].includes(words[i + 1]))) target = 'lˈɛd'
    if (target && target !== token.phonemes) {
      corrections.push({ index: i, word: token.text, from: token.phonemes, to: target })
      token.phonemes = target
    }
  }
  return corrections
}

// Private admission path shared by the text contract and extended audio probes.
export function createFrontend(ort, vocab) {
  const frontends = new Map(), wordModels = new Map()
  return {
    async phonemize(text, accent) {
      assert.ok(typeof text === 'string' && text.trim() && text.length <= 20000)
      assert.ok(['us', 'gb'].includes(accent))
      const normalizedText = text.replace(/(?<![\d:])\b([01]?\d|2[0-3]):([0-5]\d)\b(?!:\d)/g,
        (_, hour, minute) => `${Number(hour)} ${Number(minute) === 0 ? "o'clock" : Number(minute) < 10 ? `oh ${Number(minute)}` : Number(minute)}`)
      if (!frontends.has(accent)) {
        const state = { cache: new Map(), pending: new Set() }
        state.frontend = misakiEnglish({ british: accent === 'gb', fallback(token) {
          if (state.cache.has(token.text)) return state.cache.get(token.text)
          state.pending.add(token.text)
          return null
        } })
        frontends.set(accent, state)
      }
      const { cache, pending, frontend } = frontends.get(accent)
      cache.clear()
      for (let pass = 0; pass < 4; pass++) {
        pending.clear()
        const result = frontend.phonemize(normalizedText)
        if (!pending.size) {
          const corrections = correctKnownReadings(result.tokens, accent)
          result.phonemes = result.tokens.map(token => token.phonemes + token.whitespace).join('')
          assert.ok(result.tokens.every(token => token.phonemes !== null), 'Do not omit unread tokens')
          assert.ok(result.tokens.every(token => !/[A-Za-z]/.test(token.text) || token.phonemes), 'Do not omit an English token')
          assert.ok(result.phonemes.length > 0)
          for (const char of result.phonemes) assert.ok(Object.hasOwn(vocab, char), `Unmapped Kokoro phoneme: ${char}`)
          return { ...result, normalizedText, corrections, fallbackWords: [...cache.keys()], passes: pass + 1 }
        }
        if (!wordModels.has(accent)) wordModels.set(accent, await loadWordG2p(accent, ort))
        for (const word of pending) {
          let phonemes
          try { ({ phonemes } = await wordModels.get(accent).generate(word)) }
          catch (error) { throw new Error(`Fallback rejected ${JSON.stringify(word)}: ${error.message}`, { cause: error }) }
          assert.ok(phonemes, `Empty fallback for ${word}`)
          cache.set(word, phonemes)
        }
      }
      throw new Error('Frontend fallback did not converge')
    },
    async release() {
      for (const model of wordModels.values()) await model.release()
      wordModels.clear()
      frontends.clear()
    }
  }
}
