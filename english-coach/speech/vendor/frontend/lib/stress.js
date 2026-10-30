// Port of misaki 0.9.4 `apply_stress` (en.py:89-118), Apache-2.0.

export const PRIMARY_STRESS = "ˈ";
export const SECONDARY_STRESS = "ˌ";
const STRESSES = new Set([SECONDARY_STRESS, PRIMARY_STRESS]);
const VOWELS = new Set("AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ");

const hasStress = (ps        )          => [...ps].some((c) => STRESSES.has(c));
const hasVowel = (ps        )          => [...ps].some((c) => VOWELS.has(c));

// Moves each stress mark to just before the first vowel at or after it.
function restress(ps        )         {
  const chars = [...ps];
  const placed = chars.map((c, i) => {
    if (!STRESSES.has(c)) return { at: i, c };
    const vowel = chars.findIndex((v, j) => j >= i && VOWELS.has(v));
    return { at: vowel - 0.5, c };
  });
  return placed
    .sort((a, b) => a.at - b.at)
    .map((p) => p.c)
    .join("");
}

function addStress(ps        , mark        )         {
  return hasVowel(ps) ? restress(mark + ps) : ps;
}

/**
 * Adjusts stress marks to a target level: below −1 strips them, −1 (or 0 and −0.5 over a primary) demotes to
 * secondary, and a level of 0.5 to 1 or above 1 adds a secondary or primary mark to an unstressed word.
 * misaki raises on `null` phonemes with a non-null stress; this returns `null` instead.
 */
export function applyStress(ps               , stress               )                {
  if (stress === null || ps === null) return ps;
  if (stress < -1) return ps.replaceAll(PRIMARY_STRESS, "").replaceAll(SECONDARY_STRESS, "");
  if (stress === -1 || ((stress === 0 || stress === -0.5) && ps.includes(PRIMARY_STRESS))) {
    return ps.replaceAll(SECONDARY_STRESS, "").replaceAll(PRIMARY_STRESS, SECONDARY_STRESS);
  }
  if ((stress === 0 || stress === 0.5 || stress === 1) && !hasStress(ps)) {
    return addStress(ps, SECONDARY_STRESS);
  }
  if (stress >= 1 && !ps.includes(PRIMARY_STRESS) && ps.includes(SECONDARY_STRESS)) {
    return ps.replaceAll(SECONDARY_STRESS, PRIMARY_STRESS);
  }
  if (stress > 1 && !hasStress(ps)) return addStress(ps, PRIMARY_STRESS);
  return ps;
}


//# sourceURL=stress.ts