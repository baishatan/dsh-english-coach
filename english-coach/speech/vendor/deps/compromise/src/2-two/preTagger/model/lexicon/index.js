/* LOCAL PORTABLE VENDOR MODIFICATION, 2026-10-30.
 * Only package-location import specifiers changed; prior code/attribution retained.
 * Source snapshot SHA256: 950bdb996d5e2b2a4531c4196648edbb816fb5230ff371d97a3dd0d8e7109eba
 * Exact original identity and byte patches: speech/vendor/SOURCE.json.
 */
import lexData from './_data.js'
import { unpack } from '../../../../../../efrt/src/index.js'
import misc from './misc.js'
import frozenLex from './frozenLex.js'
import emoticons from './emoticons.js'
import toPlural from '../../methods/transform/nouns/toPlural/index.js'
import irregularPlurals from '../irregulars/plurals.js'
// unpack our lexicon of words
// (found in ./lexicon/)

// more clever things are done on the data later
//  - once the plugin is applied
const hasSwitch = /\|/
const lexicon = { ...misc }
const switches = {}

const tmpModel = { two: { irregularPlurals, uncountable: {} } }

Object.keys(lexData).forEach(tag => {
  const wordsObj = unpack(lexData[tag])
  // POS tag, or something fancier?
  if (!hasSwitch.test(tag)) {
    // set them as simple word key-value lookup
    Object.keys(wordsObj).forEach(w => {
      lexicon[w] = tag
    })
    return
  }
  // add them as seperate key-val object
  Object.keys(wordsObj).forEach(w => {
    switches[w] = tag
    // pluralize Noun|Verb switches
    if (tag === 'Noun|Verb') {
      const plural = toPlural(w, tmpModel)
      // Invariant irregular plurals intentionally share a switch.
      if (plural !== w || irregularPlurals[w] === w) {
        switches[plural] = 'Plural|Verb'
      }
    }
  })
})
// Keep the conditional tag alongside the packed conjunction entry.
lexicon.if = ['Conjunction', 'Condition']

// add ':)'
emoticons.forEach(str => (lexicon[str] = 'Emoticon'))

// misc cleanup
delete lexicon['']
delete lexicon[null]
delete lexicon[' ']

export { lexicon, switches, frozenLex }
