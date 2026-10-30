/* LOCAL MODIFICATION NOTICE -- isolated experimental admission fork
 * Behaviour revisions: 2026-10-29. This per-file notice added: 2026-10-30.
 * Origin: @titan-design/speech-g2p@0.0.0, https://registry.npmjs.org/@titan-design/speech-g2p/-/speech-g2p-0.0.0.tgz
 * Fixed npm integrity: sha512-tlYyOVPz4UPs96lKxASNs6qTeoSlRZtnjRHn+XDtxtF67G7Z6hy26YcfLSlLy9aAKPChNdht6F+EhyydGELnlg==
 * Recovered original module: engine.ts; SHA256 d572baaaab1978e7993d44d5cdee7e1de11af8e33c4294de168ddcbcd84a7d69
 * Original source-map SHA256: 39cc367039840c6a70793e1fddea8357bd0f3a7aa5daa24ac715d64e43786e3a
 * Local US/GB revisions: Forward the selected lexicon British flag to -s, -ed and -ing number suffix adapters; retain the US default.
 * Fixed rule/data source: https://github.com/hexgrad/misaki/tree/fba1236595f2d2bf21d414ba6e57d25256afada3
 * Fixed en.py SHA256: a9c36c90a3fa6c6084e9042fd8e19f6049add4f1435d8fe5ca1b77f3529a98f4
 * Original local builder SHA256: af20c2acdbe0a3c5f513c40217a27a324db194bc9a8a623adef1d5e72adab48c
 * Any US-only / US English statements in the preserved historical comments
 * below describe upstream scope and are superseded for this US/GB local fork.
 * Existing code, attribution and licence comments below remain verbatim.
 * This notice makes no new copyright or upstream-authorship claim.
 */
// Port of misaki 0.9.4 `Lexicon.__call__`, `G2P.token_context`, `resolve_tokens` and `G2P.__call__`
// (en.py:476-493, 619-712), Apache-2.0. US English, misaki version 1.0 phonemes (ɾ as T, ʔ as t).
import { suffixEd, suffixIng, suffixS,                                                     } from "./lexicon.js";
import { mergeTokens, stressWeight,             } from "./merge.js";
import { appendCurrency, getNumber, isNumber, numericIfNeeded,                    } from "./numbers.js";
import { foldLeft, preprocess, retokenize, tokenize,                             } from "./pipeline.js";
import { applyStress, PRIMARY_STRESS } from "./stress.js";
                                           

                         
                   
                                                                                        
                                           
                                                                                                      
                                                         
                                                                        
               
 

const UNKNOWN                = [null, null];
const VOWELS = new Set("AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ");
const CONSONANTS = new Set("bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθ");
const NON_QUOTE_PUNCTS = new Set(";:,.!?—…");
const SUBTOKEN_JUNKS = new Set("',-._‘’/");
const isJunk = (text        )          => [...text].every((c) => SUBTOKEN_JUNKS.has(c));

function toG2pToken(tk        )           {
  return { text: tk.text, tag: tk.tag, phonemes: tk.phonemes, whitespace: tk.whitespace, rating: tk._.rating ?? tk.rating };
}

/** misaki `token_context`: whether the word read just now (the next one in text order) starts with a vowel. */
function tokenContext(ctx              , ps               , token        )               {
  let futureVowel = ctx.futureVowel;
  const first = ps ? [...ps].find((c) => VOWELS.has(c) || CONSONANTS.has(c) || NON_QUOTE_PUNCTS.has(c)) : undefined;
  if (first !== undefined) futureVowel = NON_QUOTE_PUNCTS.has(first) ? null : VOWELS.has(first);
  const futureTo = token.text === "to" || token.text === "To" || (token.text === "TO" && (token.tag === "TO" || token.tag === "IN"));
  return { futureVowel, futureTo };
}

// 0 letter, 1 ASCII digit, 2 anything else.
const charClass = (c        )         => (/^\p{L}$/u.test(c) ? 0 : /^[0-9]$/.test(c) ? 1 : 2);

function needsPrespace(text        )          {
  if (text.includes(" ") || text.includes("/")) return true;
  return new Set([...text].filter((c) => !SUBTOKEN_JUNKS.has(c)).map(charClass)).size > 1;
}

                                                                           
const compareStressed = (a          , b          )         => Number(a[0]) - Number(b[0]) || a[1] - b[1] || a[2] - b[2];

function demoteWeakerStress(tokens          )       {
  const indices             = tokens.flatMap((tk, i) =>
    tk.phonemes ? [[tk.phonemes.includes(PRIMARY_STRESS), stressWeight(tk.phonemes), i]         ] : []
  );
  if (indices.length === 2 && [...tokens[indices[0] [2]] .text].length === 1) {
    const tk = tokens[indices[1] [2]] ;
    tk.phonemes = applyStress(tk.phonemes, -0.5);
    return;
  }
  const primaries = indices.filter(([primary]) => primary).length;
  if (indices.length < 2 || primaries <= Math.floor((indices.length + 1) / 2)) return;
  for (const [, , i] of indices.sort(compareStressed).slice(0, Math.floor(indices.length / 2))) {
    tokens[i] .phonemes = applyStress(tokens[i] .phonemes, -0.5);
  }
}

/** misaki `resolve_tokens`: fills punctuation and junk parts of a word, then spaces or destresses its parts. */
function resolveTokens(tokens          )       {
  const prespace = needsPrespace(mergeTokens(tokens).text);
  tokens.forEach((tk, i) => {
    if (tk.phonemes === null) {
      if (i === tokens.length - 1 && NON_QUOTE_PUNCTS.has(tk.text)) [tk.phonemes, tk._.rating] = [tk.text, 3];
      else if (isJunk(tk.text)) [tk.phonemes, tk._.rating] = ["", 3];
    } else if (i > 0) tk._.prespace = prespace;
  });
  if (!prespace) demoteWeakerStress(tokens);
}

const CAP_STRESSES = [0.5, 2]         ;

/** misaki `G2P` over an injected tokenizer and tagger: text in, misaki tokens and the joined phoneme string out. */
export class MisakiEngine {
                   lexicon         ;
                   numbers               ;
                   analyze                          ;
                   fallback                           ;
                   unk        ;

  constructor(options               ) {
    const lexicon = options.lexicon;
    this.lexicon = lexicon;
    this.numbers = {
      lookup: (word, tag, stress, ctx) => lexicon.lookup(word, tag, stress, ctx),
      stemS: (word, tag, stress, ctx) => lexicon.stemS(word, tag, stress, ctx),
      suffixS: (stem) => suffixS(stem, lexicon.british),
      suffixEd: (stem) => suffixEd(stem, lexicon.british),
      suffixIng: (stem) => suffixIng(stem, lexicon.british),
    };
    this.analyze = options.analyze;
    this.fallback = options.fallback ?? null;
    this.unk = options.unk ?? "";
  }

  /** misaki `Lexicon.__call__`: the lexicon, then number reading, for one token or merged sub-tokens. */
  readWord(tk        , ctx              )                {
    const word = [...(tk._.alias ?? tk.text).replace(/[‘’]/g, "'").normalize("NFKC")].map(numericIfNeeded).join("");
    const stress = word === word.toLowerCase() ? null : CAP_STRESSES[word === word.toUpperCase() ? 1 : 0];
    const [ps, rating] = this.lexicon.getWord(word, tk.tag, stress, ctx);
    if (ps !== null) return [applyStress(appendCurrency(ps, tk._.currency, this.numbers), tk._.stress), rating];
    if (!isNumber(word, tk._.isHead)) return UNKNOWN;
    const [num, numRating] = getNumber(word, tk._.currency, tk._.isHead, tk._.numFlags, this.numbers);
    return [applyStress(num, tk._.stress), numRating];
  }

          fallBack(tk        )                {
    const ps = this.fallback ? this.fallback(toG2pToken(tk)) : null;
    return ps === null ? UNKNOWN : [ps, 2];
  }

          readSingle(w        , ctx              )               {
    if (w.phonemes === null) [w.phonemes, w.rating] = this.readWord(w, ctx);
    if (w.phonemes === null && this.fallback) [w.phonemes, w.rating] = this.fallBack(w);
    return tokenContext(ctx, w.phonemes, w);
  }

          fallBackWhole(w          )       {
    const [head, ...rest] = w;
    [head .phonemes, head ._.rating] = this.fallBack(mergeTokens(w));
    for (const tk of rest) [tk.phonemes, tk._.rating] = ["", head ._.rating];
  }

  // Reads the longest known span ending at `right`, moving `right` left past each span read.
          readParts(w          , ctx              )               {
    let [left, right] = [0, w.length];
    while (left < right) {
      const span = w.slice(left, right);
      const tk = span.some((x) => x._.alias !== null || x.phonemes !== null) ? null : mergeTokens(span);
      const [ps, rating] = tk === null ? UNKNOWN : this.readWord(tk, ctx);
      if (ps !== null) {
        [w[left] .phonemes, w[left] ._.rating] = [ps, rating];
        for (const x of w.slice(left + 1, right)) [x.phonemes, x.rating] = ["", rating];
        ctx = tokenContext(ctx, ps, tk );
        [left, right] = [0, left];
      } else if (left + 1 < right) left++;
      else {
        right--;
        const last = w[right] ;
        if (last.phonemes === null && isJunk(last.text)) [last.phonemes, last._.rating] = ["", 3];
        else if (last.phonemes === null && this.fallback) {
          this.fallBackWhole(w);
          return ctx;
        }
        left = 0;
      }
    }
    resolveTokens(w);
    return ctx;
  }

          readRightToLeft(words        )       {
    let ctx               = { futureVowel: null, futureTo: false };
    for (const w of [...words].reverse()) ctx = Array.isArray(w) ? this.readParts(w, ctx) : this.readSingle(w, ctx);
  }

  phonemize(text        )                                           {
    const pre = preprocess(text);
    const words = retokenize(foldLeft(tokenize(pre, this.analyze(pre.text)), this.unk));
    this.readRightToLeft(words);
    const tokens = words.map((w) => (Array.isArray(w) ? mergeTokens(w, this.unk) : w));
    for (const tk of tokens) {
      if (tk.phonemes) tk.phonemes = tk.phonemes.replaceAll("ɾ", "T").replaceAll("ʔ", "t");
    }
    const phonemes = tokens.map((tk) => (tk.phonemes ?? this.unk) + tk.whitespace).join("");
    return { phonemes, tokens: tokens.map(toG2pToken) };
  }
}


//# sourceURL=engine.ts