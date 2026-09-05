/**
 * AstroSage Kundali PDF Parser
 * ------------------------------------------------------------
 * AstroSage PDFs render Hindi/Devanagari text using a legacy
 * non-Unicode font. When text is extracted from the PDF (e.g. via
 * pdf-parse), Devanagari labels come out as mojibake — garbled
 * Latin-character strings — because the font maps Devanagari
 * glyphs onto ASCII code points instead of real Unicode.
 *
 * The key insight: this mojibake is NOT random. AstroSage always
 * uses the same font/encoding, so the same Devanagari word always
 * produces the exact same garbled string. That makes it a fixed
 * substitution cipher we can hard-code a lookup table for, rather
 * than something we need OCR or translation to solve.
 *
 * Similarly, AstroSage always generates its Shadbala/Bhava Bala
 * tables with the same row order. So instead of trying to decode
 * every row label, we identify tables by structural markers
 * (numeric row shapes, known header tokens) and extract data by
 * POSITION within the known fixed template.
 *
 * If AstroSage ever changes their PDF template, these fixed
 * offsets would need to be re-verified against a fresh sample.
 */

// ---- Fixed mojibake -> meaning lookup tables (AstroSage template) ----

const PLANET_TOKENS = {
  'yXu': 'lagna',
  "lw;Z": 'sun',
  'panz': 'moon',
  'pUæ': 'moon', // alternate encoding seen in some table headers
  'eaxy': 'mars',
  'cq/k': 'mercury',
  'xq:': 'jupiter',
  "'kqØ": 'venus',
  "'kfu": 'saturn',
  'jkgq': 'rahu',
  'dsrq': 'ketu',
  ';wjs': 'uranus',
  'usi': 'neptune',
  'Iyw': 'pluto'
};

const RASHI_TOKENS = {
  'es"k': 'Aries',
  'o`"kHk': 'Taurus',
  'feFkqu': 'Gemini',
  'ddZ': 'Cancer',
  'flag': 'Leo',
  'dU;k': 'Virgo',
  'rqyk': 'Libra',
  "o`f'pd": 'Scorpio',
  '/kuq': 'Sagittarius',
  'edj': 'Capricorn',
  'dqaHk': 'Aquarius',
  'ehu': 'Pisces'
};

// Nakshatra mojibake tokens observed so far (same fixed AstroSage cipher).
// Only tokens actually seen in a real sample are included — the remaining
// 15 of 27 nakshatras are unmapped until confirmed against another sample
// PDF with a different birth nakshatra. Do NOT guess the missing tokens;
// add them here only once verified against real extracted text.
const NAKSHATRA_TOKENS = {
  "e`xf'kjk": 'Mrigashira',
  'ewy': 'Mula',
  'vknzkZ': 'Ardra',
  'jksfg.kh': 'Rohini',
  'fp=k': 'Chitra',
  'iq";': 'Pushya',
  'Hkj.kh': 'Bharani',
  "'krfHk\"kk": 'Shatabhisha',
  'e/kk': 'Magha',
  'gLr': 'Hasta',
  'vuqjk/kk': 'Anuradha',
  'm0QkYxquh': 'Uttara Phalguni'
};

const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

// Fixed row order in AstroSage's Shadbala table (7-planet columns)
const SHADBALA_ROW_ORDER = [
  'uchchaBala', 'saptavargajaBala', 'ojayugmarasyamshaBala', 'kendraBala',
  'drekkanaBala', 'totalSthanaBala', 'totalDigBala', 'nathonnataBala',
  'pakshaBala', 'tribhagaBala', 'abdaBala', 'masaBala', 'varaBala',
  'horaBala', 'ayanaBala', 'yuddhaBala', 'totalKaalBala', 'totalChestaBala',
  'totalNaisargikaBala', 'totalDrikBala', 'totalShadbala', 'shadbalaRupas',
  'minimumRequirement', 'ratio', 'relativeRank'
];

// Fixed row order in AstroSage's Bhava Bala table (12-house columns)
const BHAVA_ROW_ORDER = [
  'bhavadhipatiBala', 'bhavaDigBala', 'bhavaDrishtiBala',
  'totalBhavaBala', 'totalBhavaBalaRupas', 'relativeRank'
];

const PLANET_ORDER_7 = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];

// ---- Helpers ----

function parseDegreeString(str) {
  // Format DD-MM-SS
  const m = str.match(/(\d+)-(\d+)-(\d+)/);
  if (!m) return null;
  const [, d, mi, s] = m;
  return Number(d) + Number(mi) / 60 + Number(s) / 3600;
}

function tokenToKey(token, map) {
  return map[token] || null;
}

/** Extract trailing N numeric values from a line, ignoring a leading label. */
function extractTrailingNumbers(line, count) {
  const tokens = line.trim().split(/\s+/);
  const nums = [];
  for (let i = tokens.length - 1; i >= 0 && nums.length < count; i--) {
    if (/^-?\d+(\.\d+)?$/.test(tokens[i])) {
      nums.unshift(Number(tokens[i]));
    } else {
      break;
    }
  }
  return nums.length === count ? nums : null;
}

// ---- Section parsers ----

/** Parses the "Graha Sthiti" (planetary position) table. */
function parseGrahaSthiti(text) {
  const positions = {};
  const lines = text.split('\n');
  // Line shape: [retro marker?] PLANET_TOKEN RASHI_TOKEN DD-MM-SS NAKSHATRA_TOKEN PADA
  const lineRe = /^([^\s]+)\s+(¼o½\s+)?([^\s]+)\s+(\d+-\d+-\d+)\s+([^\s]+)\s+(\d+)\s*$/;

  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(lineRe);
    if (!m) continue;
    const [, planetTok, retro, rashiTok, degStr, nakshatraTok, pada] = m;
    const planetKey = tokenToKey(planetTok, PLANET_TOKENS);
    const rashiName = tokenToKey(rashiTok, RASHI_TOKENS);
    if (!planetKey || !rashiName) continue;

    positions[planetKey] = {
      rashi: rashiName,
      degreeInSign: parseDegreeString(degStr),
      retrograde: !!retro,
      pada: Number(pada),
      // null (not undefined-missing) signals "token seen but not yet in
      // NAKSHATRA_TOKENS map" vs. a line that didn't match at all.
      nakshatra: tokenToKey(nakshatraTok, NAKSHATRA_TOKENS)
    };
  }
  return positions;
}

/**
 * Parses the main Ashtakvarga summary table (per-planet bindus per rashi,
 * plus the Sarvashtakvarga total row).
 */
function parseAshtakvargaSummary(text) {
  const idx = text.indexOf('v"VdoxZ rkfydk');
  if (idx === -1) return null;
  const chunk = text.slice(idx, idx + 2000);
  const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);

  // Find the 8 numeric rows of exactly 12 values each, in order.
  const rows = [];
  for (const line of lines) {
    const nums = extractTrailingNumbers(line, 12);
    if (nums) rows.push(nums);
    if (rows.length === 8) break;
  }
  if (rows.length < 8) return null;

  const [sun, moon, mars, mercury, jupiter, venus, saturn, sarva] = rows;
  const byRashi = {};
  RASHI_ORDER.forEach((rashi, i) => {
    byRashi[rashi] = {
      sun: sun[i], moon: moon[i], mars: mars[i], mercury: mercury[i],
      jupiter: jupiter[i], venus: venus[i], saturn: saturn[i],
      sarvashtakvarga: sarva[i]
    };
  });
  return byRashi;
}

/** Parses the Shadbala (7-planet) and Bhava Bala (12-house) tables. */
function parseShadbalaAndBhavaBala(text) {
  const idx = text.indexOf('Hkkocy rkfydk');
  if (idx === -1) return null;
  const chunk = text.slice(idx, idx + 4000);
  const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);

  const shadbala = {};
  let rowCount = 0;
  let cursor = 0;

  // Skip header line(s) until we find 25 rows of 7 numbers each.
  for (; cursor < lines.length && rowCount < SHADBALA_ROW_ORDER.length; cursor++) {
    const nums = extractTrailingNumbers(lines[cursor], 7);
    if (!nums) continue;
    const key = SHADBALA_ROW_ORDER[rowCount];
    PLANET_ORDER_7.forEach((planet, i) => {
      if (!shadbala[planet]) shadbala[planet] = {};
      shadbala[planet][key] = nums[i];
    });
    rowCount++;
  }

  // Then a "1 2 3 ... 12" house header row, then 6 rows of 12 numbers.
  const isHouseHeaderRow = (nums) =>
    nums.length === 12 && nums.every((n, i) => n === i + 1);

  const bhavaBala = {};
  let bhavaRowCount = 0;
  for (; cursor < lines.length && bhavaRowCount < BHAVA_ROW_ORDER.length; cursor++) {
    const nums = extractTrailingNumbers(lines[cursor], 12);
    if (!nums) continue;
    if (isHouseHeaderRow(nums)) continue; // skip the "1..12" house label row
    const key = BHAVA_ROW_ORDER[bhavaRowCount];
    for (let house = 1; house <= 12; house++) {
      if (!bhavaBala[house]) bhavaBala[house] = {};
      bhavaBala[house][key] = nums[house - 1];
    }
    bhavaRowCount++;
  }

  if (rowCount < SHADBALA_ROW_ORDER.length || bhavaRowCount < BHAVA_ROW_ORDER.length) {
    return { shadbala: rowCount ? shadbala : null, bhavaBala: bhavaRowCount ? bhavaBala : null, incomplete: true };
  }
  return { shadbala, bhavaBala };
}

/**
 * Detects Mangal Dosha and Kaal Sarp Dosha verdicts using AstroSage's
 * fixed template sentences. ONLY the exact phrasing observed in a real
 * sample is matched — this is deliberately narrow rather than guessing
 * at how the "afflicted" case might read, per the standing rule against
 * reconstructing unconfirmed text. If the expected phrase isn't found,
 * the result is `null` (unknown) rather than a guessed default.
 */
function parseDoshas(text) {
  const doshas = {};

  // Mangal Dosha: fixed sentence shape is
  // "vr% eaxy nks"k[yXu|paæ] dq.Myh esa mifLFkr [ugha ]gS"
  // repeated once per chart (lagna, then chandra).
  const mangalLagnaMatch = text.match(/eaxy nks"k\s*yXu\s*dq\.Myh esa mifLFkr\s*(ugha\s*)?gS/);
  const mangalChandraMatch = text.match(/paæ dq\.Myh esa mifLFkr\s*(ugha\s*)?gS/);
  if (mangalLagnaMatch) {
    doshas.mangalDoshaLagnaKundli = !mangalLagnaMatch[1]; // true if NOT "ugha" (not-absent = present)
  } else {
    doshas.mangalDoshaLagnaKundli = null;
  }
  if (mangalChandraMatch) {
    doshas.mangalDoshaChandraKundli = !mangalChandraMatch[1];
  } else {
    doshas.mangalDoshaChandraKundli = null;
  }

  // Kaal Sarp Dosha: only the "free from" verdict phrase is confirmed —
  // "dq.Myh dkyliZ nks"k & ;ksx ls eqä gS" ("...is free from Kaal Sarp Dosha-Yoga")
  if (/dq\.Myh dkyliZ nks"k\s*&\s*;ksx ls eq[äD]r?\s*gS/.test(text)) {
    doshas.kaalSarpDosha = false; // not present
  } else if (/dkyliZ nks"k/.test(text)) {
    // Section exists but doesn't match the known "free" phrasing — likely
    // present, but we haven't confirmed the exact "afflicted" wording yet.
    doshas.kaalSarpDosha = null;
    doshas._kaalSarpDoshaNote = 'Kaal Sarp Dosha section found but verdict phrase unrecognized — needs a sample PDF where this dosha is actually present to confirm the exact wording.';
  } else {
    doshas.kaalSarpDosha = null;
  }

  return doshas;
}

/**
 * Extracts the birth nakshatra's ruling planet (Vimshottari dasha lord)
 * from the "Dasha Bhog" line, e.g. "dsrq 5 o 9 ek 27 fn" = "Ketu 5yr
 * 9mo 27d" (remaining balance of the first dasha at birth). This is a
 * clean, unambiguous data point — the planet token is one we already
 * have mapped, and the "N o N ek N fn" shape (years/months/days) is
 * distinctive enough not to false-match elsewhere in the document.
 */
function parseNakshatraLord(text) {
  const re = /([a-zA-Z:½¼'"pP]+)\s+\d+\s*[oO]\s+\d+\s*[eE]d?[kK]\s+\d+\s*[fF]n/;
  const m = text.match(re);
  if (!m) return null;
  // Try matching the raw token directly, then fall back to a
  // lowercase-normalized comparison against PLANET_TOKENS.
  const raw = m[1];
  if (PLANET_TOKENS[raw]) return PLANET_TOKENS[raw];
  const lowerRaw = raw.toLowerCase();
  const found = Object.keys(PLANET_TOKENS).find(k => k.toLowerCase() === lowerRaw);
  return found ? PLANET_TOKENS[found] : null;
}

/** Top-level entry point: parses full extracted PDF text into structured data. */
function parseKundaliPdfText(text) {
  const grahaSthiti = parseGrahaSthiti(text);
  const ashtakvarga = parseAshtakvargaSummary(text);
  const shadbalaData = parseShadbalaAndBhavaBala(text);
  const doshas = parseDoshas(text);
  const nakshatraLord = parseNakshatraLord(text);

  return {
    planetaryPositions: grahaSthiti,
    ashtakvarga,
    shadbala: shadbalaData ? shadbalaData.shadbala : null,
    bhavaBala: shadbalaData ? shadbalaData.bhavaBala : null,
    doshas,
    nakshatraLord,
    parseWarnings: [
      ...(Object.keys(grahaSthiti || {}).length < 7 ? ['Planetary positions incomplete'] : []),
      ...(!ashtakvarga ? ['Ashtakvarga table not found/parsed'] : []),
      ...(shadbalaData && shadbalaData.incomplete ? ['Shadbala/Bhava Bala table incomplete'] : []),
      ...(!shadbalaData ? ['Shadbala/Bhava Bala table not found'] : []),
      ...(!nakshatraLord ? ['Nakshatra lord (Dasha Bhog line) not found'] : [])
    ]
  };
}

module.exports = {
  parseKundaliPdfText,
  parseGrahaSthiti,
  parseAshtakvargaSummary,
  parseShadbalaAndBhavaBala,
  parseDoshas,
  parseNakshatraLord,
  PLANET_TOKENS,
  RASHI_TOKENS,
  NAKSHATRA_TOKENS
};
