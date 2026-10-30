/* LOCAL PORTABLE VENDOR MODIFICATION, 2026-10-30.
 * Only package-location import specifiers changed; prior code/attribution retained.
 * Source snapshot SHA256: a0ec0de73d1a61182551b64df07fcf41045446c8b236de7dbc78a94b4149405b
 * Exact original identity and byte patches: speech/vendor/SOURCE.json.
 */
import { convert } from '../../../../../../../suffix-thumb/src/index.js'


const toSuperlative = function (adj, model) {
  const mod = model.two.models.toSuperlative
  return convert(adj, mod)
}
const toComparative = function (adj, model) {
  const mod = model.two.models.toComparative
  return convert(adj, mod)
}
const fromComparative = function (adj, model) {
  const mod = model.two.models.fromComparative
  return convert(adj, mod)
}
const fromSuperlative = function (adj, model) {
  const mod = model.two.models.fromSuperlative
  return convert(adj, mod)
}
const toNoun = function (adj, model) {
  const mod = model.two.models.adjToNoun
  return convert(adj, mod)
}

export {
  toSuperlative, toComparative, fromComparative, fromSuperlative, toNoun
}
