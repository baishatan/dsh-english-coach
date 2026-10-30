// Port of misaki 0.9.4 `MToken` (token.py) and `merge_tokens` (en.py:13-41), Apache-2.0.

/** misaki's `token._` extension fields. */
                      
                  
                                                                                             
                       
                        
                          
                   
                    
                        
 

/**
 * A token as misaki's pipeline mutates it. misaki keeps two ratings: `_.rating`, which `merge_tokens` reads, and
 * a plain `rating` attribute that the lexicon and fallback paths set. The reported rating is the first, else the
 * second, so a token merged from parts whose `_.rating` is unset reports `null` even when it has phonemes.
 */
                         
               
              
                     
                          
                        
                
 

export function underscore(fields                      = {})             {
  return {
    isHead: true,
    alias: null,
    stress: null,
    currency: null,
    numFlags: "",
    prespace: false,
    rating: null,
    ...fields,
  };
}

// Python str.isspace() over one character.
const PY_SPACE = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
export const isPySpace = (c        )          => [...c].length === 1 && PY_SPACE.has(c.codePointAt(0) );

const byCodePoint = (a        , b        )         => a.codePointAt(0)  - b.codePointAt(0) ;

// Python max() keeps the first of equal keys: an uppercase character weighs 2, anything else 1.
function heaviestTag(tokens                   )         {
  const weight = (tk        )         => [...tk.text].reduce((n, c) => n + (c === c.toLowerCase() ? 1 : 2), 0);
  return tokens.reduce((best, tk) => (weight(tk) > weight(best) ? tk : best)).tag;
}

function joinPhonemes(tokens                   , unk        )         {
  let phonemes = "";
  for (const tk of tokens) {
    if (tk._.prespace && phonemes && !isPySpace(phonemes.at(-1) ) && tk.phonemes) phonemes += " ";
    phonemes += tk.phonemes ?? unk;
  }
  return phonemes;
}

function mergedUnderscore(tokens                   )             {
  const stresses = new Set(tokens.map((tk) => tk._.stress).filter((s) => s !== null));
  const currencies = tokens.map((tk) => tk._.currency).filter((c) => c !== null);
  const ratings = tokens.map((tk) => tk._.rating).filter((r) => r !== null);
  const flags = new Set(tokens.flatMap((tk) => [...tk._.numFlags]));
  return underscore({
    isHead: tokens[0] ._.isHead,
    stress: stresses.size === 1 ? [...stresses][0]  : null,
    currency: currencies.length > 0 ? currencies.sort(byCodePoint).at(-1)  : null,
    numFlags: [...flags].sort(byCodePoint).join(""),
    prespace: tokens[0] ._.prespace,
    rating: ratings.length < tokens.length ? null : Math.min(...ratings),
  });
}

/** misaki `merge_tokens`: one token spanning `tokens`; phonemes stay `null` unless `unk` is given. */
export function mergeTokens(tokens                   , unk                = null)         {
  const last = tokens.at(-1) ;
  return {
    text: tokens.slice(0, -1).map((tk) => tk.text + tk.whitespace).join("") + last.text,
    tag: heaviestTag(tokens),
    whitespace: last.whitespace,
    phonemes: unk === null ? null : joinPhonemes(tokens, unk),
    rating: null,
    _: mergedUnderscore(tokens),
  };
}

const DIPHTHONGS = new Set("AIOQWYʤʧ");

export const stressWeight = (ps               )         =>
  ps ? [...ps].reduce((n, c) => n + (DIPHTHONGS.has(c) ? 2 : 1), 0) : 0;


//# sourceURL=merge.ts