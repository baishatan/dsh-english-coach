/* LOCAL PORTABLE VENDOR MODIFICATION, 2026-10-30.
 * Only package-location import specifiers changed; prior code/attribution retained.
 * Source snapshot SHA256: e2a4b24bae1b7a6eac9980eb96d20d0e3b5c57c2d488639bc357b6d3a74badd6
 * Exact original identity and byte patches: speech/vendor/SOURCE.json.
 */
/* LOCAL MODIFICATION NOTICE -- isolated experimental admission fork
 * Behaviour revisions: 2026-10-29. This per-file notice added: 2026-10-30.
 * Origin: @titan-design/speech-g2p@0.0.0, https://registry.npmjs.org/@titan-design/speech-g2p/-/speech-g2p-0.0.0.tgz
 * Fixed npm integrity: sha512-tlYyOVPz4UPs96lKxASNs6qTeoSlRZtnjRHn+XDtxtF67G7Z6hy26YcfLSlLy9aAKPChNdht6F+EhyydGELnlg==
 * Recovered original module: misaki-english.ts; SHA256 bbf1aacd0016e87c5a4b1b172fce335470d35ef7cd393d83b8cea9aebc8940f3
 * Original source-map SHA256: 39cc367039840c6a70793e1fddea8357bd0f3a7aa5daa24ac715d64e43786e3a
 * Local US/GB revisions: Accept the British option, construct the matching lexicon, and remove the shared US-only version cache in favour of an accent-specific version.
 * Fixed rule/data source: https://github.com/hexgrad/misaki/tree/fba1236595f2d2bf21d414ba6e57d25256afada3
 * Fixed en.py SHA256: a9c36c90a3fa6c6084e9042fd8e19f6049add4f1435d8fe5ca1b77f3529a98f4
 * Original local builder SHA256: af20c2acdbe0a3c5f513c40217a27a324db194bc9a8a623adef1d5e72adab48c
 * Any US-only / US English statements in the preserved historical comments
 * below describe upstream scope and are superseded for this US/GB local fork.
 * Existing code, attribution and licence comments below remain verbatim.
 * This notice makes no new copyright or upstream-authorship claim.
 */
import { readFileSync } from "node:fs";
import nlp from "../../deps/compromise/src/three.js";
import { compromiseTagger } from "./compromise-tagger.js";
import { MisakiEngine } from "./engine.js";
import { Lexicon } from "./lexicon.js";
import { dataVersion, loadLexiconData, sha256Hex } from "./lexicon-data.js";
                                                 
import { spacyTokenizer } from "./spacy-tokenizer.js";
                                                                 

const TOKENIZER_DATA_URL = new URL("../data/spacy-en-tokenizer.json", import.meta.url);

                                       
                    
                                                                   
                        
                                                       
                     
                                                                                                                        
                                                
                                                                                                               
               
 

                      
                                                                                                     
                                   
                                                                                                                    
                                                                    
                                                                                                                       
                           
 

/** A token speech-tts accepts: phonemes always a string. */
                                
               
                   
                     
 

function g2pVersion(british = false)         {
  const version = sha256Hex(
    Buffer.from(`${dataVersion(british)}\n${sha256Hex(readFileSync(TOKENIZER_DATA_URL))}\ncompromise ${nlp.version}`),
  ).slice(0, 16);
  return `misaki-0.9.4+${version}`;
}

/** misaki 0.9.4 US English G2P in pure TypeScript: spaCy-compatible tokens, compromise tags, misaki's lexicon. */
export function misakiEnglish(options                       = {})      {
  const tokenizer = options.tokenizer ?? spacyTokenizer();
  const tagger = options.tagger ?? compromiseTagger();
  const analyze = (text        )                => {
    const raw = tokenizer.tokenize(text);
    const tags = tagger.tag(text, raw);
    return raw.map((tk, i) => ({ ...tk, tag: tags[i] ?? "" }));
  };
  const engine = new MisakiEngine({
    lexicon: new Lexicon(loadLexiconData(options.british ?? false), options.british ?? false),
    analyze,
    fallback: options.fallback ?? null,
    unk: options.unk ?? "",
  });
  return {
    tokens: (text) => engine.phonemize(text).tokens,
    phonemize: (text) => engine.phonemize(text),
    version: g2pVersion(options.british ?? false),
  };
}

/** Tokens in speech-tts's `TtsToken` shape: a token with no phonemes reads as `unk`, as Kokoro's `unk=''` does. */
export function ttsTokens(tokens                     , unk = "")                  {
  return tokens.map(({ text, phonemes, whitespace }) => ({ text, phonemes: phonemes ?? unk, whitespace }));
}


//# sourceURL=misaki-english.ts