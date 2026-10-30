/* LOCAL MODIFICATION NOTICE -- isolated experimental admission fork
 * Behaviour revisions: 2026-10-29. This per-file notice added: 2026-10-30.
 * Origin: @titan-design/speech-g2p@0.0.0, https://registry.npmjs.org/@titan-design/speech-g2p/-/speech-g2p-0.0.0.tgz
 * Fixed npm integrity: sha512-tlYyOVPz4UPs96lKxASNs6qTeoSlRZtnjRHn+XDtxtF67G7Z6hy26YcfLSlLy9aAKPChNdht6F+EhyydGELnlg==
 * Recovered original module: lexicon-data.ts; SHA256 c347f3ab04ff72d9850d18fce703632f21029325c0ecd25162827788c4869516
 * Original source-map SHA256: 39cc367039840c6a70793e1fddea8357bd0f3a7aa5daa24ac715d64e43786e3a
 * Local US/GB revisions: Select fixed US/GB gold and silver dictionaries and compute an accent-specific data version; retain the US default.
 * Fixed rule/data source: https://github.com/hexgrad/misaki/tree/fba1236595f2d2bf21d414ba6e57d25256afada3
 * Fixed en.py SHA256: a9c36c90a3fa6c6084e9042fd8e19f6049add4f1435d8fe5ca1b77f3529a98f4
 * Original local builder SHA256: af20c2acdbe0a3c5f513c40217a27a324db194bc9a8a623adef1d5e72adab48c
 * Any US-only / US English statements in the preserved historical comments
 * below describe upstream scope and are superseded for this US/GB local fork.
 * Existing code, attribution and licence comments below remain verbatim.
 * This notice makes no new copyright or upstream-authorship claim.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** A gold or silver entry: one pronunciation, or a map from tag (always with `DEFAULT`) to pronunciation. */
                                                                  
                                                

                              
                     
                       
 

const GOLD_URL = (british         ) => new URL(`../data/${british ? "gb" : "us"}_gold.json`, import.meta.url);
const SILVER_URL = (british         ) => new URL(`../data/${british ? "gb" : "us"}_silver.json`, import.meta.url);

/** Port of misaki `Lexicon.grow_dictionary` (en.py:125-135): adds the other capitalisation of each key, never over an existing key. */
export function growDictionary(d             )              {
  const grown              = {};
  for (const [key, value] of Object.entries(d)) {
    if ([...key].length < 2) continue;
    const lower = key.toLowerCase();
    const capitalised = capitalise(key);
    if (key === lower) {
      if (key !== capitalised) grown[capitalised] = value;
    } else if (key === capitalise(lower)) {
      grown[lower] = value;
    }
  }
  return { ...grown, ...d };
}

// Python str.capitalize(): first character upper, the rest lower.
function capitalise(s        )         {
  const [first = "", ...rest] = [...s];
  return first.toUpperCase() + rest.join("").toLowerCase();
}

function isEntry(v         )                    {
  if (typeof v === "string") return true;
  if (typeof v !== "object" || v === null || !("DEFAULT" in v)) return false;
  return Object.values(v).every((p) => p === null || typeof p === "string");
}

function isDict(v         )                   {
  return typeof v === "object" && v !== null && Object.values(v).every(isEntry);
}

/** Validates parsed lexicon JSON: every value is a pronunciation or a tag map that carries `DEFAULT`. */
export function parseLexiconDict(parsed         )              {
  if (!isDict(parsed)) throw new Error("not a misaki lexicon");
  return parsed;
}

function readDict(url     )              {
  const parsed          = JSON.parse(readFileSync(url, "utf8"));
  return parseLexiconDict(parsed);
}

export function loadLexiconData(british = false)              {
  return {
    golds: growDictionary(readDict(GOLD_URL(british))),
    silvers: growDictionary(readDict(SILVER_URL(british))),
  };
}

export function sha256Hex(bytes            )         {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A cache key for the vendored lexicon: changes if either word list changes by a byte. */
export function dataVersion(british = false)         {
  const gold = sha256Hex(readFileSync(GOLD_URL(british)));
  const silver = sha256Hex(readFileSync(SILVER_URL(british)));
  return sha256Hex(Buffer.from(`${gold}\n${silver}`)).slice(0, 16);
}


//# sourceURL=lexicon-data.ts