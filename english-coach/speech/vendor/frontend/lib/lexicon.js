/* LOCAL MODIFICATION NOTICE -- isolated experimental admission fork
 * Behaviour revisions: 2026-10-29. This per-file notice added: 2026-10-30.
 * Origin: @titan-design/speech-g2p@0.0.0, https://registry.npmjs.org/@titan-design/speech-g2p/-/speech-g2p-0.0.0.tgz
 * Fixed npm integrity: sha512-tlYyOVPz4UPs96lKxASNs6qTeoSlRZtnjRHn+XDtxtF67G7Z6hy26YcfLSlLy9aAKPChNdht6F+EhyydGELnlg==
 * Recovered original module: lexicon.ts; SHA256 d5b5d1a95f9bc7485152a32ad86e3d075995c49673a64c8c22091213c6317131
 * Original source-map SHA256: 39cc367039840c6a70793e1fddea8357bd0f3a7aa5daa24ac715d64e43786e3a
 * Local US/GB revisions: Carry the British flag through lookup and apply the three fixed GB suffix rules; retain the US branches and default.
 * Fixed rule/data source: https://github.com/hexgrad/misaki/tree/fba1236595f2d2bf21d414ba6e57d25256afada3
 * Fixed en.py SHA256: a9c36c90a3fa6c6084e9042fd8e19f6049add4f1435d8fe5ca1b77f3529a98f4
 * Original local builder SHA256: af20c2acdbe0a3c5f513c40217a27a324db194bc9a8a623adef1d5e72adab48c
 * Any US-only / US English statements in the preserved historical comments
 * below describe upstream scope and are superseded for this US/GB local fork.
 * Existing code, attribution and licence comments below remain verbatim.
 * This notice makes no new copyright or upstream-authorship claim.
 */
// Port of misaki 0.9.4 `Lexicon` word lookup (en.py:157-359), Apache-2.0. US English only; numbers live elsewhere.
                                                                   
import { applyStress, PRIMARY_STRESS, SECONDARY_STRESS } from "./stress.js";

/** What the right-to-left pass knows about the next token (misaki `TokenContext`). */
                               
                                                                                      
                              
                                       
                    
 

/** Phonemes and rating (5 override, 4 gold, 3 silver or spelled out), or `null`s when the word is unknown. */
                                                                                      

const UNKNOWN                = [null, null];
const ADD_SYMBOLS                         = { ".": "dot", "/": "slash" };
const SYMBOLS                         = { "%": "percent", "&": "and", "+": "plus", "@": "at" };
// misaki LEXICON_ORDS: apostrophe, hyphen and ASCII letters.
const LEXICON_CHARS = /^[A-Za-z'-]+$/;
const US_TAUS = new Set("AIOWYiuæɑəɛɪɹʊʌ");
const DOUBLED_ING = /([bcdgklmnprstvxz])\1ing$|cking$/;
// The casings misaki's special cases match on.
const A = new Set(["a", "A"]);
const AM = new Set(["am", "Am", "AM"]);
const AN = new Set(["an", "An", "AN"]);
const BY = new Set(["by", "By", "BY"]);
const USED = new Set(["used", "Used", "USED"]);
const TO = new Set(["to", "To"]);
const IN = new Set(["in", "In"]);
const THE = new Set(["the", "The"]);

const has = (dict        , key        )          => Object.hasOwn(dict, key);
// Python str.isalpha(): non-empty and every character a letter.
const isAlpha = (s        )          => /^\p{L}+$/u.test(s);
const isUpper = (s        )          => s === s.toUpperCase();
const length = (s        )         => [...s].length;

/** misaki `get_parent_tag`: the coarse tag a lexicon dict may be keyed by when the Penn tag itself is absent. */
export function parentTag(tag               )                {
  if (tag === null) return null;
  if (tag.startsWith("VB")) return "VERB";
  if (tag.startsWith("NN")) return "NOUN";
  if (tag.startsWith("ADV") || tag.startsWith("RB")) return "ADV";
  if (tag.startsWith("ADJ") || tag.startsWith("JJ")) return "ADJ";
  return tag;
}

function pickByTag(
  entry                               ,
  tag               ,
  ctx                     
)                {
  let key = tag;
  if (ctx !== null && ctx.futureVowel === null && has(entry, "None")) key = "None";
  else if (key === null || !has(entry, key)) key = parentTag(tag);
  return key !== null && has(entry, key) ? (entry[key] ?? null) : (entry["DEFAULT"] ?? null);
}

export function suffixS(stem               , british = false)                {
  if (!stem) return null;
  if ("ptkfθ".includes(stem.at(-1) )) return stem + "s";
  if ("szʃʒʧʤ".includes(stem.at(-1) )) return stem + (british ? "ɪ" : "ᵻ") + "z";
  return stem + "z";
}

export function suffixEd(stem               , british = false)                {
  if (!stem) return null;
  const last = stem.at(-1) ;
  if ("pkfθʃsʧ".includes(last)) return stem + "t";
  if (last === "d") return stem + (british ? "ɪ" : "ᵻ") + "d";
  if (last !== "t") return stem + "d";
  if (british || stem.length < 2) return stem + "ɪd";
  if (US_TAUS.has(stem.at(-2) )) return stem.slice(0, -1) + "ɾᵻd";
  return stem + "ᵻd";
}

export function suffixIng(stem               , british = false)                {
  if (!stem) return null;
  if (british && "əː".includes(stem.at(-1) )) return null;
  if (!british && stem.length > 1 && stem.at(-1) === "t" && US_TAUS.has(stem.at(-2) )) {
    return stem.slice(0, -1) + "ɾɪŋ";
  }
  return stem + "ɪŋ";
}

/** misaki's US `Lexicon` over gold and silver dicts already grown by `growDictionary`. */
export class Lexicon {
                   golds                      ;
                   silvers                        ;

           british         ;

  constructor(data             , british = false) {
    this.british = british;
    this.golds = data.golds;
    this.silvers = data.silvers;
  }

          gold(word        )                           {
    return has(this.golds, word) ? this.golds[word] : undefined;
  }

          silver(word        )                           {
    return has(this.silvers, word) ? this.silvers[word] : undefined;
  }

          goldString(word        , tag = "DEFAULT")                {
    const entry = this.gold(word);
    if (typeof entry === "string") return entry;
    return entry?.[tag] ?? null;
  }

  /** misaki `get_NNP`: spells the word letter by letter, primary stress on the last letter. */
  getNNP(word        )                {
    const letters = [...word].filter(isAlpha).map((c) => this.gold(c.toUpperCase()));
    if (letters.some((ps) => typeof ps !== "string")) return UNKNOWN;
    const ps = applyStress(letters.join(""), 0) ?? "";
    const last = ps.lastIndexOf(SECONDARY_STRESS);
    const spelled = last < 0 ? ps : ps.slice(0, last) + PRIMARY_STRESS + ps.slice(last + 1);
    return [spelled, 3];
  }

  isKnown(word        )          {
    if (this.gold(word) !== undefined || has(SYMBOLS, word) || this.silver(word) !== undefined) return true;
    if (!isAlpha(word) || !LEXICON_CHARS.test(word)) return false;
    if (length(word) === 1) return true;
    if (isUpper(word) && this.gold(word.toLowerCase()) !== undefined) return true;
    return isUpper(word.slice(1));
  }

  lookup(word        , tag               , stress               , ctx                     )                {
    let isNNP = false;
    if (isUpper(word) && this.gold(word) === undefined) {
      word = word.toLowerCase();
      isNNP = tag === "NNP";
    }
    let entry = this.gold(word);
    let rating = 4;
    if (entry === undefined && !isNNP) {
      entry = this.silver(word);
      rating = 3;
    }
    const ps = typeof entry === "object" ? pickByTag(entry, tag, ctx) : (entry ?? null);
    if (ps === null || (isNNP && !ps.includes(PRIMARY_STRESS))) {
      const spelled = this.getNNP(word);
      if (spelled[0] !== null) return spelled;
    }
    return [applyStress(ps, stress), rating];
  }

          symbolCase(word        , tag        , ctx              )                       {
    if (tag === "ADD" && has(ADD_SYMBOLS, word)) return this.lookup(ADD_SYMBOLS[word] , null, -0.5, ctx);
    if (has(SYMBOLS, word)) return this.lookup(SYMBOLS[word] , null, null, ctx);
    const parts = word.split(".");
    const isAbbreviation =
      word.replace(/^\.+|\.+$/g, "").includes(".") &&
      isAlpha(word.replaceAll(".", "")) &&
      Math.max(...parts.map(length)) < 3;
    return isAbbreviation ? this.getNNP(word) : null;
  }

          articleCase(word        , tag        , stress               , ctx              )                       {
    if (A.has(word)) return [tag === "DT" ? "ɐ" : "ˈA", 4];
    if (AM.has(word)) {
      if (tag.startsWith("NN")) return this.getNNP(word);
      if (ctx.futureVowel === null || word !== "am" || (stress !== null && stress > 0)) {
        return [this.goldString("am"), 4];
      }
      return ["ɐm", 4];
    }
    if (AN.has(word)) {
      return word === "AN" && tag.startsWith("NN") ? this.getNNP(word) : ["ɐn", 4];
    }
    if (word === "I" && tag === "PRP") return [`${SECONDARY_STRESS}I`, 4];
    return null;
  }

  // to, in and the: an all-caps form counts only under the tags misaki allows for it.
          nextWordCase(word        , tag        , ctx              )                       {
    if (TO.has(word) || (word === "TO" && (tag === "TO" || tag === "IN"))) {
      const to = ctx.futureVowel === null ? this.goldString("to") : ctx.futureVowel ? "tʊ" : "tə";
      return [to, 4];
    }
    if (IN.has(word) || (word === "IN" && tag !== "NNP")) {
      return [(ctx.futureVowel === null || tag !== "IN" ? PRIMARY_STRESS : "") + "ɪn", 4];
    }
    if (THE.has(word) || (word === "THE" && tag === "DT")) {
      return [ctx.futureVowel === true ? "ði" : "ðə", 4];
    }
    return null;
  }

          taggedWordCase(word        , tag        , ctx              )                       {
    if (BY.has(word) && parentTag(tag) === "ADV") return ["bˈI", 4];
    if (tag === "IN" && /^vs\.?$/i.test(word)) return this.lookup("versus", null, null, ctx);
    if (USED.has(word)) {
      const beforeTo = (tag === "VBD" || tag === "JJ") && ctx.futureTo;
      return [this.goldString("used", beforeTo ? "VBD" : "DEFAULT"), 4];
    }
    return null;
  }

  /** misaki `get_special_case`: symbols, dotted abbreviations and function words whose reading depends on context. */
  getSpecialCase(word        , tag        , stress               , ctx              )                {
    return (
      this.symbolCase(word, tag, ctx) ??
      this.articleCase(word, tag, stress, ctx) ??
      this.nextWordCase(word, tag, ctx) ??
      this.taggedWordCase(word, tag, ctx) ??
      UNKNOWN
    );
  }

  stemS(word        , tag               , stress               , ctx                     )                {
    if (length(word) < 3 || !word.endsWith("s")) return UNKNOWN;
    let stem        ;
    if (!word.endsWith("ss") && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if (
      (word.endsWith("'s") || (length(word) > 4 && word.endsWith("es") && !word.endsWith("ies"))) &&
      this.isKnown(word.slice(0, -2))
    ) {
      stem = word.slice(0, -2);
    } else if (length(word) > 4 && word.endsWith("ies") && this.isKnown(word.slice(0, -3) + "y")) {
      stem = word.slice(0, -3) + "y";
    } else return UNKNOWN;
    const [ps, rating] = this.lookup(stem, tag, stress, ctx);
    return [suffixS(ps, this.british), rating];
  }

  stemEd(word        , tag               , stress               , ctx                     )                {
    if (length(word) < 4 || !word.endsWith("d")) return UNKNOWN;
    let stem        ;
    if (!word.endsWith("dd") && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1);
    else if (
      length(word) > 4 &&
      word.endsWith("ed") &&
      !word.endsWith("eed") &&
      this.isKnown(word.slice(0, -2))
    ) {
      stem = word.slice(0, -2);
    } else return UNKNOWN;
    const [ps, rating] = this.lookup(stem, tag, stress, ctx);
    return [suffixEd(ps, this.british), rating];
  }

  stemIng(word        , tag               , stress               , ctx                     )                {
    if (length(word) < 5 || !word.endsWith("ing")) return UNKNOWN;
    const base = word.slice(0, -3);
    let stem        ;
    if (length(word) > 5 && this.isKnown(base)) stem = base;
    else if (this.isKnown(base + "e")) stem = base + "e";
    else if (length(word) > 5 && DOUBLED_ING.test(word) && this.isKnown(word.slice(0, -4))) {
      stem = word.slice(0, -4);
    } else return UNKNOWN;
    const [ps, rating] = this.lookup(stem, tag, stress, ctx);
    return [suffixIng(ps, this.british), rating];
  }

  // A capitalised or all-caps word missing from both dicts is read as its lowercase form when that is known.
          readsLowercase(word        , tag        , stress               , ctx              )          {
    const lower = word.toLowerCase();
    if (length(word) <= 1 || !isAlpha(word.replaceAll("'", "")) || word === lower) return false;
    if (tag === "NNP" && length(word) <= 7) return false;
    if (this.gold(word) !== undefined || this.silver(word) !== undefined) return false;
    if (!isUpper(word) && word.slice(1) !== word.slice(1).toLowerCase()) return false;
    if (this.gold(lower) !== undefined || this.silver(lower) !== undefined) return true;
    return [this.stemS, this.stemEd, this.stemIng].some((stem) => !!stem.call(this, lower, tag, stress, ctx)[0]);
  }

          knownVariant(word        )                {
    if (this.isKnown(word)) return word;
    if (word.endsWith("s'") && this.isKnown(word.slice(0, -2) + "'s")) return word.slice(0, -2) + "'s";
    if (word.endsWith("'") && this.isKnown(word.slice(0, -1))) return word.slice(0, -1);
    return null;
  }

  /** misaki `get_word`: special cases, then the lexicon, then -s, -ed and -ing stems; `null`s when nothing reads it. */
  getWord(word        , tag        , stress               , ctx              )                {
    const special = this.getSpecialCase(word, tag, stress, ctx);
    if (special[0] !== null) return special;
    if (this.readsLowercase(word, tag, stress, ctx)) word = word.toLowerCase();
    const known = this.knownVariant(word);
    if (known !== null) return this.lookup(known, tag, stress, ctx);
    for (const [stem, level] of [
      [this.stemS, stress],
      [this.stemEd, stress],
      [this.stemIng, stress ?? 0.5],
    ]         ) {
      const result = stem.call(this, word, tag, level, ctx);
      if (result[0] !== null) return result;
    }
    return UNKNOWN;
  }
}


//# sourceURL=lexicon.ts