                                     
                                                                        
                            
 

// Misaki spends single capitals on diphthongs and a few single glyphs on
// affricates and reduced vowels; IPA spells these out.
const MISAKI_TO_IPA                                   = {
  A: "eɪ",
  I: "aɪ",
  O: "oʊ",
  W: "aʊ",
  Y: "ɔɪ",
  Q: "əʊ",
  T: "ɾ",
  ᵊ: "ə",
  ᵻ: "ɪ",
  ʤ: "dʒ",
  ʧ: "tʃ",
};

const STRESS_MARKS = /[ˈˌ]/g;

export function misakiToIpa(phonemes        , options                     = {})         {
  const mapped = Array.from(phonemes, (ch) => MISAKI_TO_IPA[ch] ?? ch).join("");
  return options.stress === "strip" ? mapped.replace(STRESS_MARKS, "") : mapped;
}


//# sourceURL=misaki-to-ipa.ts