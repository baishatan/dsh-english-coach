// Port of misaki 0.9.4 en.py number handling (Apache-2.0): is_number, is_currency, get_number,
// append_currency, numeric_if_needed. The lexicon is injected so this module never imports it.
import { cardinal, decimal, ordinal, year } from "./num2words-en.js";

                                                                         
                                                                                         

                                
                     
                    
                                                                                   
                                                
                                                 
                                                  
 

const CURRENCIES                                            = {
  $: ["dollar", "cent"],
  "£": ["pound", "pence"],
  "€": ["euro", "cent"],
};
const ORDINALS = new Set(["st", "nd", "rd", "th"]);
const NUMBER_SUFFIXES = ["ing", "'d", "ed", "'s", ...ORDINALS, "s"];
// Numeric_Type=Digit characters outside \p{Nd}: [first code point, value of first, count].
const OTHER_DIGITS                                                 = [
  [0xb2, 2, 2], [0xb9, 1, 1], [0x2070, 0, 1], [0x2074, 4, 6], [0x2080, 0, 10],
  [0x2460, 1, 9], [0x2474, 1, 9], [0x2488, 1, 9], [0x24ea, 0, 1], [0x24f5, 1, 9],
  [0x2776, 1, 9], [0x2780, 1, 9], [0x278a, 1, 9], [0x1369, 1, 9], [0x19da, 1, 1], [0x24ff, 0, 1],
  [0x10a40, 1, 4], [0x10e60, 1, 9], [0x11052, 1, 9], [0x1f100, 0, 1], [0x1f101, 0, 1], [0x1f102, 1, 9],
];

const isDigit = (text        )          => /^[0-9]+$/.test(text);
/** Python `int(text)` for digit strings: exact at any size, and an error where Python raises. */
function toInt(text        )         {
  if (!isDigit(text)) throw new SyntaxError(`not an integer literal: "${text}"`);
  return BigInt(text);
}
const has = (map        , key               )          => key !== null && Object.hasOwn(map, key);

export function isCurrency(word        )          {
  if (!word.includes(".")) return true;
  const parts = word.split(".");
  if (parts.length > 2) return false;
  const cents = parts[1] ;
  // misaki compares the digit set to {0} (the integer), which never matches; kept for parity.
  return cents.length < 3;
}

export function isNumber(word        , isHead         )          {
  if ([...word].every((c) => !isDigit(c))) return false;
  let rest = word;
  for (const suffix of NUMBER_SUFFIXES) {
    if (rest.endsWith(suffix)) {
      rest = rest.slice(0, -suffix.length);
      break;
    }
  }
  return [...rest].every((c, i) => isDigit(c) || c === "," || c === "." || (isHead && i === 0 && c === "-"));
}

/** Python `str.isdigit` followed by `unicodedata.numeric`, for single characters. */
export function numericIfNeeded(c        )         {
  const cp = c.codePointAt(0) ;
  if (/^\p{Nd}$/u.test(c)) {
    let start = cp;
    while (/^\p{Nd}$/u.test(String.fromCodePoint(start - 1))) start--;
    return String((cp - start) % 10);
  }
  for (const [first, value, count] of OTHER_DIGITS) {
    if (cp >= first && cp < first + count) return String(value + cp - first);
  }
  return c;
}

export function appendCurrency(ps        , currency               , lexicon               )         {
  if (!currency || !has(CURRENCIES, currency)) return ps;
  const [unit] = CURRENCIES[currency] ;
  const plural = lexicon.stemS(`${unit}s`, null, null, null)[0];
  return plural ? `${ps} ${plural}` : ps;
}

                   
                            
                
                         
 

/** misaki raises when a lookup misses (None breaks its join and min); reject explicitly here. */
function requireReading(reading         , word        )                   {
  const [ps, rating] = reading;
  if (ps === null || rating === null) throw new Error(`no reading for number word "${word}"`);
  return [ps, rating];
}

function pushWord(b         , word        )       {
  b.parts.push(requireReading(b.lexicon.lookup(word, null, word === "point" ? -2 : null, null), word));
}

function extend(b         , text                 , first = true, escape = false)       {
  const words = escape ? String(text) : cardinal(typeof text === "bigint" ? text : toInt(text));
  const splits = words.split(/[^a-z]+/);
  splits.forEach((w, i) => {
    if (w !== "and" || b.flags.includes("&")) {
      if (first && i === 0 && splits.length > 1 && w === "one" && b.flags.includes("a")) b.parts.push(["ə", 4]);
      else pushWord(b, w);
    } else if (b.flags.includes("n") && b.parts.length > 0) {
      const last = b.parts[b.parts.length - 1] ;
      b.parts[b.parts.length - 1] = [`${last[0]}ən`, last[1]];
    }
  });
}

const digitByDigit = (b         , num        )       => [...num].forEach((n) => extend(b, n, false));

function readBareInteger(b         , word        )       {
  const num = word.replace(/,/g, "");
  if (num[0] === "0" || num.length > 3) digitByDigit(b, num);
  else if (num.length === 3 && !num.endsWith("00")) {
    extend(b, num[0] );
    if (num[1] === "0") {
      b.parts.push(requireReading(b.lexicon.lookup("O", null, -2, null), "O"));
      extend(b, num[2] , false);
    } else extend(b, num.slice(1), false);
  } else extend(b, num);
}

function readDotted(b         , word        )       {
  let first = true;
  for (const num of word.replace(/,/g, "").split(".")) {
    if (num) {
      if (num[0] === "0" || (num.length !== 2 && [...num.slice(1)].some((n) => n !== "0"))) digitByDigit(b, num);
      else extend(b, num, first);
    }
    first = false;
  }
}

function readCurrency(b         , word        , currency        )       {
  const units = CURRENCIES[currency] ;
  const amounts = word.replace(/,/g, "").split(".");
  let pairs = amounts.slice(0, units.length).map((num, i) => [num ? toInt(num) : 0n, units[i] ]         );
  if (pairs.length > 1) {
    if (pairs[1] [0] === 0n) pairs = pairs.slice(0, 1);
    else if (pairs[0] [0] === 0n) pairs = pairs.slice(1);
  }
  pairs.forEach(([num, unit], i) => {
    if (i > 0) pushWord(b, "and");
    extend(b, num, i === 0);
    const plural = num !== 1n && unit !== "pence";
    const reading = plural ? b.lexicon.stemS(`${unit}s`, null, null, null) : b.lexicon.lookup(unit, null, null, null);
    b.parts.push(requireReading(reading, unit));
  });
}

function readPlainNumber(b         , word        , suffix               )       {
  let spoken        ;
  if (isDigit(word)) spoken = cardinal(toInt(word));
  else if (!word.includes(".")) {
    const n = toInt(word.replace(/,/g, ""));
    spoken = suffix !== null && ORDINALS.has(suffix) ? ordinal(n) : cardinal(n);
  } else {
    const clean = word.replace(/,/g, "");
    spoken = clean[0] === "."
      ? `point ${[...clean.slice(1)].map((n) => cardinal(toInt(n))).join(" ")}`
      : decimal(clean);
  }
  extend(b, spoken, true, true);
}

function inflect(ps        , suffix               , lexicon               )                {
  if (suffix === "s" || suffix === "'s") return lexicon.suffixS(ps);
  if (suffix === "ed" || suffix === "'d") return lexicon.suffixEd(ps);
  if (suffix === "ing") return lexicon.suffixIng(ps);
  return ps;
}

export function getNumber(
  input        ,
  currency               ,
  isHead         ,
  numFlags        ,
  lexicon               ,
)          {
  const suffix = /[a-z']+$/.exec(input)?.[0] ?? null;
  let word = suffix ? input.slice(0, -suffix.length) : input;
  const b          = { parts: [], flags: numFlags, lexicon };
  if (word.startsWith("-")) {
    b.parts.push(requireReading(lexicon.lookup("minus", null, null, null), "minus"));
    word = word.slice(1);
  }
  if (isDigit(word) && suffix !== null && ORDINALS.has(suffix)) extend(b, ordinal(toInt(word)), true, true);
  else if (b.parts.length === 0 && word.length === 4 && !has(CURRENCIES, currency) && isDigit(word)) {
    extend(b, year(Number(toInt(word))), true, true);
  } else if (!isHead && !word.includes(".")) readBareInteger(b, word);
  else if (word.split(".").length > 2 || !isHead) readDotted(b, word);
  else if (has(CURRENCIES, currency) && isCurrency(word)) readCurrency(b, word, currency );
  else readPlainNumber(b, word, suffix);
  if (b.parts.length === 0) return [null, null];
  const ps = b.parts.map(([p]) => p).join(" ");
  const rating = Math.min(...b.parts.map(([, r]) => r));
  return [inflect(ps, suffix, lexicon), rating];
}


//# sourceURL=numbers.ts