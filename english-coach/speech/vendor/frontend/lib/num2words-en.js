// Clean-room English number words. Written from the behaviour recorded in
// fixtures/num2words.golden.json, not from the source of the LGPL num2words package.

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = [
  "", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion",
  "sextillion", "septillion", "octillion", "nonillion", "decillion",
];
const ORDINAL_ENDINGS                         = {
  one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth",
};

function underHundred(n        )         {
  if (n < 20) return ONES[n] ;
  const unit = n % 10;
  return unit === 0 ? TENS[n / 10]  : `${TENS[Math.floor(n / 10)] }-${ONES[unit] }`;
}

function underThousand(n        )         {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return underHundred(rest);
  const head = `${ONES[hundreds] } hundred`;
  return rest === 0 ? head : `${head} and ${underHundred(rest)}`;
}

function positiveCardinal(n        )         {
  if (n < 1000n) return underThousand(Number(n));
  const chunks                                     = [];
  let rest = n;
  for (let i = 0; rest > 0n; i++) {
    const scale = SCALES[i];
    if (scale === undefined) throw new RangeError(`number too large: ${n}`);
    chunks.unshift({ value: Number(rest % 1000n), scale });
    rest /= 1000n;
  }
  let out = "";
  for (const { value, scale } of chunks) {
    if (value === 0) continue;
    const words = underThousand(value) + (scale ? ` ${scale}` : "");
    const isLast = scale === "";
    // A trailing group under 100 is joined with "and"; every other join is a comma.
    if (!out) out = words;
    else out += isLast && value < 100 ? ` and ${words}` : `, ${words}`;
  }
  return out;
}

export function cardinal(value                 )         {
  const n = BigInt(value);
  return n < 0n ? `minus ${positiveCardinal(-n)}` : positiveCardinal(n);
}

export function ordinal(value                 )         {
  const words = cardinal(value);
  const split = Math.max(words.lastIndexOf(" "), words.lastIndexOf("-")) + 1;
  const last = words.slice(split);
  let suffixed        ;
  if (ORDINAL_ENDINGS[last]) suffixed = ORDINAL_ENDINGS[last] ;
  else if (last.endsWith("y")) suffixed = `${last.slice(0, -1)}ieth`;
  else suffixed = `${last}th`;
  return words.slice(0, split) + suffixed;
}

export function year(value        )         {
  const high = Math.floor(value / 100);
  const low = value % 100;
  // Round thousands with a single-digit tail (1001, 2009) read as plain cardinals.
  if (value < 100 || (high % 10 === 0 && low < 10)) return cardinal(value);
  if (low === 0) return `${cardinal(high)} hundred`;
  return `${cardinal(high)} ${low < 10 ? `oh-${ONES[low] }` : underHundred(low)}`;
}

/**
 * Plain positional text for a finite float, with no exponent. The digits are the shortest
 * round-trip digits, which JS and Python's repr share; only the exponent layout differs.
 */
function expandFloat(value        )         {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  if (!match) throw new RangeError(`unreadable float: ${value}`);
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * Reads a decimal literal as Python's float would: a whole value reads as its exact integer
 * (recorded: 5.0 is "five"), anything else digit by digit after the point.
 */
export function decimal(literal        )         {
  const parsed = Number(literal);
  if (!Number.isFinite(parsed)) throw new RangeError(`number too large: ${literal}`);
  if (Number.isInteger(parsed)) return cardinal(BigInt(parsed));
  const text = expandFloat(parsed);
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
  const digits = [...fraction].map((d) => ONES[Number(d)] ).join(" ");
  // num2words drops the sign when the whole part is zero (-0.5 reads "zero point five").
  return `${negative && whole !== "0" ? "minus " : ""}${cardinal(BigInt(whole))} point ${digits}`;
}


//# sourceURL=num2words-en.ts