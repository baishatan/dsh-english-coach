// Port of misaki 0.9.4 `G2P.preprocess`, `tokenize`, `fold_left`, `subtokenize` and `retokenize`
// (en.py:53-57, 508-617), plus spaCy 3.8 `get_alignments` (spacy/training/align.pyx), Apache-2.0 and MIT.
import { isPySpace, mergeTokens, underscore,             } from "./merge.js";
                                           

/** A stress level (number), an override `/phonemes`, or number-reading `#flags`. */
                               

                        
               
                                                                                                        
                  
                                        
                                 
 

                                               
              
 

/** A word to read: one token, or several adjacent sub-tokens read together. */
                                     

const LINK = /\[([^\]]+)\]\(([^)]*)\)/g;
const SUBTOKEN =
  /^['‘’]+|\p{Lu}(?=\p{Lu}\p{Ll})|(?:^-)?(?:\p{Nd}?[,.]?\p{Nd})+|[-_]+|['‘’]{2,}|\p{L}*?(?:['‘’]\p{L})*?\p{Ll}(?=\p{Lu})|\p{L}+(?:['‘’]\p{L})*|[^\-_\p{L}'‘’\p{Nd}]|['‘’]+(?=\n?$)/gu;
const CURRENCIES = new Set(["$", "£", "€"]);
const PUNCTS = new Set(';:,.!?—…"“”');
const PUNCT_TAGS = new Set([".", ",", "-LRB-", "-RRB-", "``", '""', "''", ":", "$", "#", "NFP"]);
const PUNCT_TAG_PHONEMES                         = { "-LRB-": "(", "-RRB-": ")", "``": "“", '""': "”", "''": "”" };

// Python str.split() with no separator.
function pySplit(s        )           {
  const words           = [];
  let word = "";
  for (const c of s) {
    if (!isPySpace(c)) word += c;
    else if (word) {
      words.push(word);
      word = "";
    }
  }
  if (word) words.push(word);
  return words;
}

function lstrip(s        )         {
  const chars = [...s];
  const start = chars.findIndex((c) => !isPySpace(c));
  return start < 0 ? "" : chars.slice(start).join("");
}

// Python's `$` also matches before a final newline, and int() ignores it.
function parseFeature(f        )                 {
  const unsigned = f[0] === "-" || f[0] === "+" ? f.slice(1) : f;
  if (/^[0-9]+\n?$/.test(unsigned)) return Number.parseInt(f, 10) + 0;
  if (f === "0.5" || f === "+0.5") return 0.5;
  if (f === "-0.5") return -0.5;
  if (f.length > 1 && f.startsWith("/") && f.endsWith("/")) return "/" + f.slice(1).replace(/\/+$/, "");
  if (f.length > 1 && f.startsWith("#") && f.endsWith("#")) return "#" + f.slice(1).replace(/#+$/, "");
  return null;
}

/** misaki `preprocess`: strips `[text](feature)` markup down to its text and records each feature by word index. */
export function preprocess(input        )               {
  const text = lstrip(input);
  let result = "";
  const words           = [];
  const features = new Map                 ();
  let lastEnd = 0;
  for (const m of text.matchAll(LINK)) {
    const before = text.slice(lastEnd, m.index);
    result += before;
    words.push(...pySplit(before));
    const feature = parseFeature(m[2] );
    if (feature !== null) features.set(words.length, feature);
    result += m[1] ;
    words.push(m[1] );
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    result += text.slice(lastEnd);
    words.push(...pySplit(text.slice(lastEnd)));
  }
  return { text: result, words, features };
}

function charOwners(tokens                   )           {
  return tokens.flatMap((t, i) => Array        ([...t.toLowerCase()].length).fill(i));
}

const withoutSpace = (chars                   )         => chars.filter((c) => !isPySpace(c)).join("");

/**
 * spaCy `get_alignments`, B side: for each token of `b`, the tokens of `a` sharing a character with it. The two
 * token lists must spell the same text up to whitespace and case.
 */
export function alignB2A(a                   , b                   )             {
  const [ownerA, ownerB] = [charOwners(a), charOwners(b)];
  const [strA, strB] = [[...a.join("").toLowerCase()], [...b.join("").toLowerCase()]];
  if (withoutSpace(strA) !== withoutSpace(strB) || strA.length !== ownerA.length || strB.length !== ownerB.length) {
    throw new Error(`cannot align ${JSON.stringify(a.slice(0, 10))} with ${JSON.stringify(b.slice(0, 10))}`);
  }
  const b2a                = [];
  let [ca, cb, prevB] = [0, 0, -1];
  while (ca < strA.length && cb < strB.length) {
    const [ta, tb] = [ownerA[ca] , ownerB[cb] ];
    if (prevB !== tb) b2a.push(new Set());
    const atStarts = (ca === 0 || ownerA[ca - 1]  < ta) && (cb === 0 || ownerB[cb - 1]  < tb);
    if (a[ta] === b[tb] && atStarts) {
      b2a.at(-1) .add(ta);
      ca += [...a[ta] ].length;
      cb += [...b[tb] ].length;
    } else if (strA[ca] === strB[cb]) {
      b2a.at(-1) .add(ta);
      [ca, cb] = [ca + 1, cb + 1];
    } else if (isPySpace(strA[ca] )) ca++;
    else if (isPySpace(strB[cb] )) cb++;
    else throw new Error(`cannot align ${JSON.stringify(a.slice(0, 10))} with ${JSON.stringify(b.slice(0, 10))}`);
    prevB = tb;
  }
  return b2a.map((s) => [...s].sort((x, y) => x - y));
}

function applyFeature(tk        , feature         , first         )       {
  if (typeof feature === "number") tk._.stress = feature;
  else if (feature.startsWith("/")) {
    tk._.isHead = first;
    tk.phonemes = first ? feature.replace(/^\/+/, "") : "";
    tk._.rating = 5;
  } else if (feature.startsWith("#")) tk._.numFlags = feature.replace(/^#+/, "");
}

/**
 * misaki `tokenize` over already tagged tokens. misaki indexes tokens by position in spaCy's flattened alignment
 * data, not by token, so a token aligned to no word or to two shifts the ones after it; this keeps that.
 */
export function tokenize(pre              , tagged                        )           {
  const tokens           = tagged.map((t) => ({
    text: t.text,
    tag: t.tag,
    whitespace: t.whitespace,
    phonemes: null,
    rating: null,
    _: underscore(),
  }));
  if (pre.features.size === 0) return tokens;
  const data = alignB2A(pre.words, tokens.map((t) => t.text)).flat();
  for (const [word, feature] of pre.features) {
    let i = 0;
    data.forEach((x, j) => {
      if (x !== word) return;
      const first = i++ === 0;
      if (j < tokens.length) applyFeature(tokens[j] , feature, first);
    });
  }
  return tokens;
}

/** misaki `fold_left`: an override's non-head tokens join the token before them. */
export function foldLeft(tokens                   , unk        )           {
  const result           = [];
  for (const tk of tokens) result.push(result.length > 0 && !tk._.isHead ? mergeTokens([result.pop() , tk], unk) : tk);
  return result;
}

/** misaki `subtokenize`: splits a token at case changes, digit runs, hyphens, apostrophes and symbols. */
export function subtokenize(word        )           {
  return [...word.matchAll(SUBTOKEN)].map((m) => m[0]);
}

function splitToken(token        )           {
  if (token._.alias !== null || token.phonemes !== null) return [token];
  const parts = subtokenize(token.text).map((text)         => ({
    ...token,
    text,
    whitespace: "",
    rating: null,
    _: underscore({ numFlags: token._.numFlags, stress: token._.stress }),
  }));
  parts.at(-1) .whitespace = token.whitespace;
  return parts;
}

const isAsciiLetters = (text        )          => [...text].every((c) => /^[a-z]$/.test(c.toLowerCase()));
const isAlpha = (s        )          => /^\p{L}+$/u.test(s);
const betweenLetters = (before        , after        )          =>
  isAlpha([...before.text].at(-1)  + [...after.text][0] );

                       
                            
                          
 

// The per-sub-token branch of misaki `retokenize`: punctuation and currency get phonemes, "2" between letters reads "to".
function classify(r             , tks                   , i        , j        )       {
  const tk = tks[j] ;
  if (tk._.alias !== null || tk.phonemes !== null) return;
  if (tk.tag === "$" && CURRENCIES.has(tk.text)) {
    r.currency = tk.text;
    [tk.phonemes, tk._.rating] = ["", 4];
  } else if (tk.tag === ":" && (tk.text === "-" || tk.text === "–")) {
    [tk.phonemes, tk._.rating] = ["—", 3];
  } else if (PUNCT_TAGS.has(tk.tag) && !isAsciiLetters(tk.text)) {
    tk.phonemes = PUNCT_TAG_PHONEMES[tk.tag] ?? [...tk.text].filter((c) => PUNCTS.has(c)).join("");
    tk._.rating = 4;
  } else if (r.currency !== null) {
    if (tk.tag !== "CD") r.currency = null;
    else if (j + 1 === tks.length && (i + 1 === r.tokens.length || r.tokens[i + 1] .tag !== "CD")) {
      tk._.currency = r.currency;
    }
  } else if (0 < j && j < tks.length - 1 && tk.text === "2" && betweenLetters(tks[j - 1] , tks[j + 1] )) {
    tk._.alias = "to";
  }
}

function place(words        , tk        )       {
  const last = words.at(-1);
  if (tk._.alias !== null || tk.phonemes !== null) words.push(tk);
  else if (Array.isArray(last) && !last.at(-1) .whitespace) {
    tk._.isHead = false;
    last.push(tk);
  } else words.push(tk.whitespace ? tk : [tk]);
}

/** misaki `retokenize`: splits tokens into sub-tokens and groups the ones with no whitespace between them. */
export function retokenize(tokens                   )         {
  const words         = [];
  const r              = { tokens, currency: null };
  tokens.forEach((token, i) => {
    const tks = splitToken(token);
    tks.forEach((tk, j) => {
      classify(r, tks, i, j);
      place(words, tk);
    });
  });
  return words.map((w) => (Array.isArray(w) && w.length === 1 ? w[0]  : w));
}


//# sourceURL=pipeline.ts