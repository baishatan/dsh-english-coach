// Translates spaCy's dumped Python `re` patterns to JS `u`-mode regexes and wraps them with Python's
// search, match and finditer semantics. spaCy is MIT-licensed; see NOTICE.

/** Python `str.isspace()` characters. JS `\s` differs: it adds U+FEFF and omits U+001C-U+001F. */
export const PY_SPACE_CLASS =
  "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

// Python's Unicode `\w`: str.isalnum() or underscore.
const PY_WORD_CLASS = "\\p{L}\\p{N}_";

                              
                  
                                                                                                  
                
 

                       
                
              
 

const SYNTAX_CHARS = new Set("^$\\.*+?()[]{}|/");
const KEPT_ESCAPES = new Set("ntrfv");
const PY_IGNORECASE = 2;
const PY_DOTALL = 16;
const PY_UNICODE = 32;
const PY_FLAG_BITS                         = { i: PY_IGNORECASE, s: PY_DOTALL, u: PY_UNICODE };

// [outside a class, inside a class]
const CLASS_ESCAPES                                            = {
  d: ["\\p{Nd}", "\\p{Nd}"],
  D: ["\\P{Nd}", "\\P{Nd}"],
  w: [`[${PY_WORD_CLASS}]`, PY_WORD_CLASS],
  s: [`[${PY_SPACE_CLASS}]`, PY_SPACE_CLASS],
  W: [`[^${PY_WORD_CLASS}]`, ""],
  S: [`[^${PY_SPACE_CLASS}]`, ""],
};

function unsupported(construct        , at        )        {
  throw new Error(`unsupported Python regex construct ${construct} at ${at}`);
}

// Returns the JS text for the escape at `p[i]` and how many pattern characters it consumed.
function translateEscape(p        , i        , inClass         )                   {
  const e = p[i + 1] ?? unsupported("trailing backslash", i);
  const hex = (n        )         => {
    const digits = p.slice(i + 2, i + 2 + n);
    return /^[0-9a-fA-F]+$/.test(digits) && digits.length === n ? digits : unsupported(`\\${e}${digits}`, i);
  };
  if (e === "u" || e === "x") return [`\\${e}${hex(e === "u" ? 4 : 2)}`, e === "u" ? 6 : 4];
  if (e === "U") return [`\\u{${hex(8)}}`, 10];
  const cls = CLASS_ESCAPES[e];
  if (cls) return [(inClass ? cls[1] : cls[0]) || unsupported(`\\${e} inside a class`, i), 2];
  if (KEPT_ESCAPES.has(e)) return [`\\${e}`, 2];
  if (/[A-Za-z0-9]/.test(e)) unsupported(`\\${e}`, i);
  return [SYNTAX_CHARS.has(e) || (inClass && e === "-") ? `\\${e}` : e, 2];
}

// Python accepts `]` as a class's first member; JS reads `[]` as an empty class.
function openClass(p        , i        )                   {
  const negated = p[i + 1] === "^";
  const head = negated ? "[^" : "[";
  const first = i + head.length;
  return p[first] === "]" ? [`${head}\\]`, head.length + 1] : [head, head.length];
}

// Python reads a `{` that does not start a valid quantifier as a literal; JS `u` mode rejects it.
function translateBrace(p        , i        )                   {
  const m = /^\{(\d*)(,?)(\d*)\}/.exec(p.slice(i));
  if (!m || (!m[2] && !m[1])) return ["\\{", 1];
  return [`{${m[1] || "0"}${m[2]}${m[3]}}`, m[0].length];
}

function translateGroup(p        , i        , flags                  )                   {
  const rest = p.slice(i);
  const inline = /^\(\?([a-zA-Z]+)\)/.exec(rest);
  if (inline) {
    if (i !== 0) unsupported(inline[0], i);
    for (const f of inline[1] ?? "") flags.bits |= PY_FLAG_BITS[f] ?? unsupported(`(?${f})`, i);
    return ["", inline[0].length];
  }
  if (rest.startsWith("(?P<")) return ["(?<", 4];
  if (/^\(\?([:=!]|<[=!])/.test(rest)) return ["(", 1];
  return unsupported(rest.slice(0, 4), i);
}

function translateOutside(p        , i        , flags                  )                   {
  const c = p[i] ?? "";
  if (c === "(" && p[i + 1] === "?") return translateGroup(p, i, flags);
  if (c === "{") return translateBrace(p, i);
  // Python's `$` also matches just before a final newline.
  if (c === "$") return ["(?=\\n?$)", 1];
  if (c === "}" || c === "]") return [`\\${c}`, 1];
  return [c, 1];
}

/** Rewrites a Python `re` pattern as JS `u`-mode source, folding inline flags into the returned bits. */
export function translatePattern(pattern        , pyFlags        )                                    {
  const flags = { bits: pyFlags };
  let source = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; ) {
    const c = pattern[i];
    let piece                  ;
    if (c === "\\") piece = translateEscape(pattern, i, inClass);
    else if (inClass) {
      inClass = c !== "]";
      piece = [c === "[" ? "\\[" : (c ?? ""), 1];
    } else if (c === "[") {
      inClass = true;
      piece = openClass(pattern, i);
    } else piece = translateOutside(pattern, i, flags);
    source += piece[0];
    i += piece[1];
  }
  return { source, flags: jsFlags(flags.bits) };
}

function jsFlags(bits        )         {
  const unknown = bits & ~(PY_IGNORECASE | PY_DOTALL | PY_UNICODE);
  if (unknown) throw new Error(`unsupported Python regex flags ${unknown}`);
  return `${bits & PY_IGNORECASE ? "i" : ""}${bits & PY_DOTALL ? "s" : ""}u`;
}

/** Compiles a dumped pattern, failing loudly with its name when it cannot be translated or compiled. */
export function compilePattern(name        , spec             , extraFlags = "")         {
  try {
    const { source, flags } = translatePattern(spec.pattern, spec.flags);
    return new RegExp(source, flags + extraFlags);
  } catch (err) {
    throw new Error(`spaCy pattern ${name} does not compile in JS: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

export const PATTERN_NAMES = ["prefix_search", "suffix_search", "infix_finditer", "token_match", "url_match"]         ;
                                                         

/** The tokenizer's callables with Python's semantics; spans are UTF-16 offsets. A missing pattern never matches. */
                                
                                       
                                       
                                   
                                 
                               
 

function searcher(re               )                             {
  return (s) => {
    const m = re?.exec(s);
    return m ? { start: m.index, end: m.index + m[0].length } : null;
  };
}

function matcher(re               )                         {
  return (s) => {
    if (!re) return false;
    re.lastIndex = 0;
    return re.test(s);
  };
}

export function compileSpacyPatterns(specs                                         )                {
  const compile = (name             , extra = "")                => {
    const spec = specs[name];
    return spec ? compilePattern(name, spec, extra) : null;
  };
  const infix = compile("infix_finditer", "g");
  return {
    prefixSearch: searcher(compile("prefix_search")),
    suffixSearch: searcher(compile("suffix_search")),
    infixFinditer: (s) => (infix ? [...s.matchAll(infix)].map((m) => ({ start: m.index, end: m.index + m[0].length })) : []),
    tokenMatch: matcher(compile("token_match", "y")),
    urlMatch: matcher(compile("url_match", "y")),
  };
}


//# sourceURL=spacy-patterns.ts