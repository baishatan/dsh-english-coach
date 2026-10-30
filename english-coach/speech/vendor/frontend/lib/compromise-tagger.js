/* LOCAL PORTABLE VENDOR MODIFICATION, 2026-10-30.
 * Only package-location import specifiers changed; prior code/attribution retained.
 * Source snapshot SHA256: b4f1af260f1943fcf2363efbf1fe09b68b3c5e0387d14ddbe751bfd90c272d2d
 * Exact original identity and byte patches: speech/vendor/SOURCE.json.
 */
import nlp from "../../deps/compromise/src/three.js";
import { governingTag, punctTag, wordTag } from "./penn-rules.js";
                                                      

                
                
              
                            
 

                              
                                                                         
 

function termsOf(text        )         {
  const sentences                       = nlp(text).json({ offset: true });
  return sentences
    .flatMap((s) => s.terms)
    .filter((t) => t.offset.length > 0)
    .map((t) => ({
      start: t.offset.start,
      end: t.offset.start + t.offset.length,
      tags: new Set(t.tags),
    }));
}

// compromise has no term for clitics and punctuation, so a token takes the tags of the term it overlaps most.
function overlappingTags(
  tok          ,
  terms                 
)                      {
  const lo = tok.idx;
  const hi = tok.idx + tok.text.length;
  let best              = null;
  let bestLen = 0;
  for (const t of terms) {
    const len = Math.min(hi, t.end) - Math.max(lo, t.start);
    if (len > bestLen) {
      best = t;
      bestLen = len;
    }
  }
  return best ? best.tags : new Set();
}

const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

/** A Penn Treebank tagger over spaCy-style tokens, backed by compromise. */
export function compromiseTagger()            {
  return {
    tag(text, tokens) {
      const terms = termsOf(text);
      const penn           = [];
      const words           = [];
      tokens.forEach((tok, i) => {
        const tag = HAS_WORD_CHAR.test(tok.text)
          ? wordTag(tok.text, overlappingTags(tok, terms), {
              governing: governingTag(penn, words),
              nextWord: tokens[i + 1]?.text.toLowerCase(),
            })
          : punctTag(tok, tokens[i - 1]);
        penn.push(tag);
        words.push(tok.text.toLowerCase());
      });
      return penn;
    },
  };
}


//# sourceURL=compromise-tagger.ts