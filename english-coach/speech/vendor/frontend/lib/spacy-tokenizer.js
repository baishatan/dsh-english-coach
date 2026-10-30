// Port of spaCy 3.8.16 `Tokenizer.explain` (spacy/tokenizer.pyx:631-756) and of the whitespace rule in
// `Tokenizer._tokenize_affixes` (tokenizer.pyx:164-210), over the English tokenizer data dumped from
// en_core_web_sm 3.8.0. spaCy is MIT-licensed; see NOTICE.
import { readFileSync } from "node:fs";
import {
  PATTERN_NAMES,
  PY_SPACE_CLASS,
  compileSpacyPatterns,
                   
                   
            
                     
} from "./spacy-patterns.js";
                                                      

const DATA_URL = new URL("../data/spacy-en-tokenizer.json", import.meta.url);
const PY_SPACE_RUN = new RegExp(`[${PY_SPACE_CLASS}]+`, "u");
const PY_SPACE_ONLY = new RegExp(`^[${PY_SPACE_CLASS}]+$`, "u");

                              
                                                                           
                                  
                                                    
 

                                                    

                         
              
                           
 

                 
                
              
              
 

function isRecord(v         )                               {
  return typeof v === "object" && v !== null;
}

function isPatternSpec(v         )                          {
  return v === null || (isRecord(v) && typeof v.pattern === "string" && typeof v.flags === "number");
}

function isTokenizerData(v         )                          {
  if (!isRecord(v) || !isRecord(v.rules) || !isRecord(v.patterns)) return false;
  const patterns = v.patterns;
  const rulesOk = Object.values(v.rules).every(
    (parts) => Array.isArray(parts) && parts.every((p) => typeof p === "string"),
  );
  return rulesOk && PATTERN_NAMES.every((n) => isPatternSpec(patterns[n]));
}

export function loadSpacyTokenizerData()                     {
  const parsed          = JSON.parse(readFileSync(DATA_URL, "utf8"));
  if (!isTokenizerData(parsed)) throw new Error("not a spaCy tokenizer dump");
  return parsed;
}

class Explainer {
           #rules       ;
           #patterns               ;
           #phrases                                               ;

  constructor(data                    ) {
    this.#rules = new Map(Object.entries(data.rules));
    this.#patterns = compileSpacyPatterns(data.patterns);
    this.#phrases = this.#phrasePatterns();
  }

  /** Non-whitespace token texts, as `Tokenizer.explain` yields them. */
  explain(text        )           {
    const tokens = text
      .split(PY_SPACE_RUN)
      .filter(Boolean)
      .flatMap((word) => this.#explainWord(word, true));
    return this.#applyPhraseSpecials(text, tokens);
  }

  #explainWord(word        , withSpecials         )           {
    const special = withSpecials ? this.#rules.get(word) : undefined;
    if (special) return [...special];
    const tokens           = [];
    const suffixes           = [];
    const core = this.#peelAffixes(word, tokens, suffixes, withSpecials);
    if (core) tokens.push(...this.#explainCore(core, withSpecials));
    return tokens.concat(suffixes.reverse());
  }

  // The inner `while prefix_search(substring) or suffix_search(substring)` loop; returns what is left.
  #peelAffixes(word        , tokens          , suffixes          , withSpecials         )         {
    const { prefixSearch, suffixSearch, tokenMatch } = this.#patterns;
    const special = (s        )                                => (withSpecials ? this.#rules.get(s) : undefined);
    let s = word;
    while (prefixSearch(s) || suffixSearch(s)) {
      const whole = tokenMatch(s) ? [s] : special(s);
      if (whole) {
        tokens.push(...whole);
        return "";
      }
      const prefix = prefixSearch(s);
      if (prefix) {
        if (prefix.end === 0) break;
        tokens.push(s.slice(0, prefix.end));
        s = s.slice(prefix.end);
        if (special(s)) continue;
      }
      const suffix = suffixSearch(s);
      if (suffix) {
        if (suffix.start === s.length) break;
        suffixes.push(s.slice(suffix.start));
        s = s.slice(0, suffix.start);
      }
    }
    return s;
  }

  #explainCore(s        , withSpecials         )           {
    const { tokenMatch, urlMatch, infixFinditer } = this.#patterns;
    if (tokenMatch(s) || urlMatch(s)) return [s];
    const special = withSpecials ? this.#rules.get(s) : undefined;
    if (special) return [...special];
    return splitInfixes(s, infixFinditer(s));
  }

  // spaCy feeds a PhraseMatcher only the rules that contain an affix or a space (`faster_heuristics`),
  // each as the token sequence it would get without special cases.
  #phrasePatterns()                               {
    const { prefixSearch, suffixSearch, infixFinditer } = this.#patterns;
    const nonEmpty = (span             )          => span !== null && span.end > span.start;
    const byFirst = new Map                         ();
    for (const key of this.#rules.keys()) {
      if (PY_SPACE_ONLY.test(key)) continue;
      const hasAffix = nonEmpty(prefixSearch(key)) || nonEmpty(suffixSearch(key)) || infixFinditer(key).length > 0;
      if (!hasAffix && !key.includes(" ")) continue;
      const words = key.split(PY_SPACE_RUN).flatMap((w) => this.#explainWord(w, false));
      const first = words[0] ?? "";
      byFirst.set(first, [...(byFirst.get(first) ?? []), { key, words }]);
    }
    return byFirst;
  }

  #applyPhraseSpecials(text        , tokens                   )           {
    const matches = filterSpans(this.#findPhrases(tokens));
    if (matches.length === 0) return [...tokens];
    const spaced = spacedAfter(text, tokens);
    const byStart = new Map(matches.map((m) => [m.start, m]));
    const out           = [];
    for (let i = 0; i < tokens.length; ) {
      const m = byStart.get(i);
      const parts = m ? this.#rules.get(m.key) : undefined;
      if (m && parts && spanText(tokens, spaced, m) === parts.join("")) {
        out.push(...parts);
        i = m.end;
      } else {
        out.push(tokens[i] ?? "");
        i += 1;
      }
    }
    return out;
  }

  #findPhrases(tokens                   )          {
    const found          = [];
    tokens.forEach((first, start) => {
      for (const { key, words } of this.#phrases.get(first) ?? []) {
        if (words.every((w, k) => tokens[start + k] === w)) found.push({ start, end: start + words.length, key });
      }
    });
    return found;
  }
}

// explain's infix loop: a match at offset 0 is skipped, empty pieces are dropped.
function splitInfixes(s        , infixes                 )           {
  if (infixes.length === 0) return [s];
  const out           = [];
  let offset = 0;
  for (const m of infixes) {
    if (offset === 0 && m.start === 0) continue;
    const before = s.slice(offset, m.start);
    const infix = s.slice(m.start, m.end);
    if (before) out.push(before);
    if (infix) out.push(infix);
    offset = m.end;
  }
  const rest = s.slice(offset);
  if (rest) out.push(rest);
  return out;
}

// spacy.util.filter_spans: longest first, then earliest; a span is dropped if either end is taken.
function filterSpans(matches                  )          {
  const sorted = [...matches].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const seen = new Set        ();
  const kept          = [];
  for (const m of sorted) {
    if (seen.has(m.start) || seen.has(m.end - 1)) continue;
    kept.push(m);
    for (let i = m.start; i < m.end; i += 1) seen.add(i);
  }
  return kept.sort((a, b) => a.start - b.start);
}

// The `spaces` of spacy.util.get_words_and_spaces: whether exactly a " " follows each token in the text.
function spacedAfter(text        , tokens                   )            {
  let pos = 0;
  return tokens.map((word) => {
    pos = text.indexOf(word, pos) + word.length;
    return text[pos] === " ";
  });
}

function spanText(tokens                   , spaced                    , m       )         {
  let out = "";
  for (let i = m.start; i < m.end; i += 1) out += (tokens[i] ?? "") + (spaced[i] && i < m.end - 1 ? " " : "");
  return out;
}

function codePoints(s        )         {
  return Array.from(s).length;
}

/**
 * Places explain()'s tokens on the text with spaCy's whitespace rule: one " " after a token becomes its
 * whitespace, and any other whitespace run becomes a token of its own. Offsets count code points, as Python does.
 */
export function placeTokens(text        , words                   )             {
  const out             = [];
  let pos = 0;
  let cp = 0;
  const advance = (to        )       => {
    cp += codePoints(text.slice(pos, to));
    pos = to;
  };
  const takeGap = (end        )       => {
    if (end === pos) return;
    if (!PY_SPACE_ONLY.test(text.slice(pos, end))) throw new Error(`tokens do not cover the text at offset ${pos}`);
    const prev = out.at(-1);
    if (prev && text[pos] === " ") {
      prev.whitespace = " ";
      advance(pos + 1);
    }
    if (end > pos) out.push({ text: text.slice(pos, end), idx: cp, whitespace: "" });
    advance(end);
  };
  for (const word of words) {
    const start = text.indexOf(word, pos);
    if (start < 0) throw new Error(`token ${JSON.stringify(word)} not found after offset ${pos}`);
    takeGap(start);
    out.push({ text: word, idx: cp, whitespace: "" });
    advance(start + word.length);
  }
  takeGap(text.length);
  return out;
}

/** spaCy's English tokenizer: `{text, idx, whitespace}` per token, whitespace-only tokens included, as `nlp.tokenizer` gives. */
export function spacyTokenizer(data                     = loadSpacyTokenizerData())            {
  const explainer = new Explainer(data);
  return { tokenize: (text) => placeTokens(text, explainer.explain(text)) };
}


//# sourceURL=spacy-tokenizer.ts