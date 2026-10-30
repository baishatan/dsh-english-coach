/* LOCAL PORTABLE VENDOR MODIFICATION, 2026-10-30.
 * Only package-location import specifiers changed; prior code/attribution retained.
 * Source snapshot SHA256: a178f55e54f7ffa0d884b63812ee3430194bba2aba44dd520cc5481019161cc1
 * Exact original identity and byte patches: speech/vendor/SOURCE.json.
 */
import { convert } from '../../../../../../../../suffix-thumb/src/index.js'

// pull-apart phrasal verb 'fall over'
const parse = (inf) => {
  if (/ /.test(inf)) {
    return inf.split(/ /)
  }
  return [inf, '']
}

//we run this on every verb in the lexicon, so please keep it fast
//we assume the input word is a proper infinitive
const conjugate = function (inf, model) {
  const { toPast, toPresent, toGerund, toParticiple } = model.two.models
  // ad-hoc Copula response
  if (inf === 'be') {
    return {
      Infinitive: inf,
      Gerund: 'being',
      PastTense: 'was',
      Participle: 'been',
      PresentTense: 'is',
    }
  }
  const [str, particle] = parse(inf)
  const found = {
    Infinitive: str,
    PastTense: convert(str, toPast),
    PresentTense: convert(str, toPresent),
    Gerund: convert(str, toGerund),
    FutureTense: 'will ' + str
  }
  // add past-participle if it's interesting
  // drive -> driven (not drove)
  let pastPrt = convert(str, toParticiple)
  if (pastPrt !== inf && pastPrt !== found.PastTense) {
    // ensure it's a known participle
    const lex = model.one.lexicon || {}
    if (lex[pastPrt] === 'Participle' || lex[pastPrt] === 'Adjective') {
      // one exception
      if (inf === 'play') {
        pastPrt = 'played'
      }
      found.Participle = pastPrt
    }
  }
  // put phrasal-verbs back together again
  if (particle) {
    Object.keys(found).forEach(k => {
      found[k] += ' ' + particle
    })
  }
  return found
}


export default conjugate

// console.log(toPresent.rules.y)
// console.log(convert('buy', toPresent))
