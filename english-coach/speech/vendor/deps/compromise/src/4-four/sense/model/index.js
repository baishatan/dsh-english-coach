/* LOCAL PORTABLE VENDOR MODIFICATION, 2026-10-30.
 * Only package-location import specifiers changed; prior code/attribution retained.
 * Source snapshot SHA256: 7f954835ad964acf2a843989cb388631f33915133dca6480b618cdb52292c3ab
 * Exact original identity and byte patches: speech/vendor/SOURCE.json.
 */
import data from './_data.js'
import { unpack } from '../../../../../efrt/src/index.js'

Object.keys(data).forEach(ambig => {
  data[ambig].forEach(sense => {
    sense.words = unpack(sense.words)
  })
})

export default {
  four: {
    senses: data,
  },
}
