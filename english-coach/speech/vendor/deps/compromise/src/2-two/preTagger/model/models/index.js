/* LOCAL PORTABLE VENDOR MODIFICATION, 2026-10-30.
 * Only package-location import specifiers changed; prior code/attribution retained.
 * Source snapshot SHA256: 58119b5a1f1c41e6a4801dbaf66b3eff53dfd9fd85d4fc79a30c79491b9449a2
 * Exact original identity and byte patches: speech/vendor/SOURCE.json.
 */
import data from './_data.js'
import { reverse, uncompress } from '../../../../../../suffix-thumb/src/index.js'
const fromPast = uncompress(data.PastTense)
const fromPresent = uncompress(data.PresentTense)
const fromGerund = uncompress(data.Gerund)
const fromParticiple = uncompress(data.Participle)

const toPast = reverse(fromPast)
const toPresent = reverse(fromPresent)
const toGerund = reverse(fromGerund)
const toParticiple = reverse(fromParticiple)

const toComparative = uncompress(data.Comparative)
const toSuperlative = uncompress(data.Superlative)
const fromComparative = reverse(toComparative)
const fromSuperlative = reverse(toSuperlative)

const adjToNoun = uncompress(data.AdjToNoun)

export default {
  fromPast,
  fromPresent,
  fromGerund,
  fromParticiple,
  toPast,
  toPresent,
  toGerund,
  toParticiple,
  // adjectives
  toComparative,
  toSuperlative,
  fromComparative,
  fromSuperlative,
  adjToNoun
}
// console.log(convert('collide', toPast))