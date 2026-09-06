/**
 * Official CEI / LPI Scoring Engine
 * ------------------------------------------------------------
 * Implements the formula structure given in Shubhodayah's own
 * "Cosmic Energy Index (CEI)" and "Life Performance Index (LPI)"
 * specification PDFs, rather than an ad-hoc composite.
 *
 * What was directly legible from those PDFs (same legacy-font
 * mojibake issue as the AstroSage reports, but formulas/labels/point
 * values were left in plain Latin characters and numerals):
 *   CEI = L + S + M + SB + AV + N + D9 + H + P − EL
 *   LPI = sum of 9 life-domain scores
 *         (Physical Health, Mental Health, Financial Status, Career,
 *          Education & Knowledge, Family & Married Life, Social
 *          Prestige, Spiritual Life, Life Satisfaction)
 *   - Each of the 9 factors in both formulas is worth 10 points
 *     (5 sub-criteria x 2 points), so raw max = 90 for each index.
 *   - EL (Energy Loss) is a 0-10 deduction from CEI's raw total,
 *     based on doshas present (each confirmed dosha reduces the
 *     score) — applied to the raw (pre-normalization) total.
 *
 * *** FIX (see CEI/LPI comparative grading matrix, confirmed from
 * the spec PDF directly) ***
 * CEI and LPI are NOT rescaled to /100. The spec's own comparative
 * grading matrix runs 80-90 / 70-79 / 60-69 / 50-59 / <50 — i.e. the
 * top band tops out at 90, not 100. An earlier version of this file
 * incorrectly stretched the raw /90 total up to /100
 * (rawSum/90*100), which is why the live site was showing inflated
 * 90-100 scores across the board: a genuinely-strong 80/90 chart was
 * being displayed as 89, compressing all real variation into a
 * narrow high band. That normalization has been REMOVED for the
 * score that is displayed/graded.
 *
 * A separate `scoreNormalized` (0-100) value is still computed and
 * returned, but it exists ONLY so houseScoring.js can combine CEI/LPI
 * fairly with the House/Lord/Yoga sub-scores (which are genuinely
 * out of 100) inside the weighted master formula. It must never be
 * shown to the user as "the CEI score" or graded against the CEI
 * grading bands — only `score` (raw, /90) should be used for display
 * and for CEI/LPI's own grading.
 *
 * What could NOT be verified letter-by-letter from the mojibake
 * (the specific wording of each of the 5 sub-criteria under a given
 * factor): those are operationalized here using standard, well-known
 * classical Vedic astrology significations for each factor, applied
 * to the real Shadbala / Bhava Bala / Ashtakvarga / planetary-dignity
 * data already parsed from the AstroSage PDF. Each function below is
 * commented with exactly which convention it uses, so this can be
 * corrected against the original documents' full text if a cleaner
 * (non-legacy-font) copy becomes available.
 */

const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const ELEMENT_OF_RASHI = {
  Aries: 'Fire', Leo: 'Fire', Sagittarius: 'Fire',
  Taurus: 'Earth', Virgo: 'Earth', Capricorn: 'Earth',
  Gemini: 'Air', Libra: 'Air', Aquarius: 'Air',
  Cancer: 'Water', Scorpio: 'Water', Pisces: 'Water'
};

// Classical dignity tables (standard, not chart-specific / not from the PDFs)
const EXALTATION = { sun: 'Aries', moon: 'Taurus', mars: 'Capricorn', mercury: 'Virgo', jupiter: 'Cancer', venus: 'Pisces', saturn: 'Libra' };
const DEBILITATION = { sun: 'Libra', moon: 'Scorpio', mars: 'Cancer', mercury: 'Pisces', jupiter: 'Capricorn', venus: 'Virgo', saturn: 'Aries' };
const OWN_SIGNS = { sun: ['Leo'], moon: ['Cancer'], mars: ['Aries', 'Scorpio'], mercury: ['Gemini', 'Virgo'], jupiter: ['Sagittarius', 'Pisces'], venus: ['Taurus', 'Libra'], saturn: ['Capricorn', 'Aquarius'] };

const AVG_SARVASHTAKVARGA_PER_SIGN = 337 / 12;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function rashiForHouse(lagnaRashi, houseNumber) {
  const idx = RASHI_ORDER.indexOf(lagnaRashi);
  if (idx === -1) return null;
  return RASHI_ORDER[(idx + houseNumber - 1) % 12];
}

function dignityBonus(planet, rashi) {
  if (!rashi) return 0;
  if (EXALTATION[planet] === rashi) return 2;
  if (DEBILITATION[planet] === rashi) return -2;
  if (OWN_SIGNS[planet] && OWN_SIGNS[planet].includes(rashi)) return 1;
  return 0;
}

/** Ratio-based sub-score: shadbala ratio of 1.0 (meets minimum) -> 5/10; 2.0 -> 10/10. */
function ratioToTen(ratio) {
  if (ratio == null) return null;
  return clamp(ratio * 5, 0, 10);
}

const KENDRA_TRIKONA = [1, 4, 5, 7, 9, 10];
const DUSTHANA = [6, 8, 12];
const NATURAL_BENEFICS = ['jupiter', 'venus', 'mercury'];
const NATURAL_MALEFICS = ['mars', 'saturn', 'rahu', 'ketu'];
const ASPECT_OFFSETS = { mars: [4, 7, 8], jupiter: [5, 7, 9], saturn: [3, 7, 10], default: [7] };

function houseOfPlanet(planetRashi, lagnaRashi) {
  const li = RASHI_ORDER.indexOf(lagnaRashi);
  const pi = RASHI_ORDER.indexOf(planetRashi);
  if (li === -1 || pi === -1) return null;
  return ((pi - li + 12) % 12) + 1;
}

/** Which planets aspect a given house (Parashari graha drishti). */
function planetsAspectingHouse(targetHouse, planetaryPositions, lagnaRashi) {
  const aspecting = [];
  Object.keys(planetaryPositions || {}).forEach(p => {
    if (p === 'lagna') return;
    const pos = planetaryPositions[p];
    if (!pos || !pos.rashi) return;
    const ph = houseOfPlanet(pos.rashi, lagnaRashi);
    if (ph == null) return;
    const offsets = ASPECT_OFFSETS[p] || ASPECT_OFFSETS.default;
    const distance = ((targetHouse - ph + 12) % 12) + 1;
    if (offsets.includes(distance)) aspecting.push(p);
  });
  return aspecting;
}

function absoluteLongitude(pos) {
  if (!pos || !pos.rashi) return null;
  return RASHI_ORDER.indexOf(pos.rashi) * 30 + (pos.degreeInSign || 0);
}

/**
 * Combustion check: within a fixed 10-degree orb of the Sun.
 * DOCUMENTED SIMPLIFICATION: classical combustion orbs vary by planet
 * (e.g. ~14 deg for Venus, ~17 deg for Mars) rather than one flat
 * value; a single 10-degree orb is used here as a reasonable common
 * approximation absent a more detailed spec.
 */
function isCombust(planetPos, sunPos) {
  const pLong = absoluteLongitude(planetPos);
  const sLong = absoluteLongitude(sunPos);
  if (pLong == null || sLong == null) return false;
  const diff = Math.abs(pLong - sLong) % 360;
  const dist = Math.min(diff, 360 - diff);
  return dist <= 10;
}

// ---- CEI's 9 factors (each 0-10) ----
// L, S, M below implement the LITERAL 5 sub-criteria from Shubhodayah's
// CEI spec PDF (each worth 2 points), rather than a generic proxy
// formula. This replaces the earlier Bhava-Bala/Shadbala-ratio proxy
// versions of these three factors.

/**
 * L = Lagna strength. Literal spec criteria:
 *  1. Lagna lord in exaltation, own sign, or moolatrikona
 *     (moolatrikona not separately modeled -- own-sign used as proxy,
 *     documented simplification)
 *  2. Lagna lord in a kendra (1,4,7,10) or trikona (5,9) house from Lagna
 *  3. No conjunction/aspect of malefics (Mars/Saturn/Rahu/Ketu) on Lagna lord
 *  4. At least one natural benefic (Jupiter/Venus/Mercury) fully aspects
 *     the Lagna (1st house)
 *  5. Lagna lord not combust and not in debilitation sign
 */
function scoreL(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const lagnaLordMap = { Aries: 'mars', Taurus: 'venus', Gemini: 'mercury', Cancer: 'moon', Leo: 'sun', Virgo: 'mercury', Libra: 'venus', Scorpio: 'mars', Sagittarius: 'jupiter', Capricorn: 'saturn', Aquarius: 'saturn', Pisces: 'jupiter' };
  const lord = lagnaLordMap[lagnaRashi];
  const lordPos = planetaryPositions[lord];
  if (!lordPos) return null;

  const lordHouse = houseOfPlanet(lordPos.rashi, lagnaRashi);
  let score = 0;

  // 1. Exaltation or own sign
  if (EXALTATION[lord] === lordPos.rashi || (OWN_SIGNS[lord] && OWN_SIGNS[lord].includes(lordPos.rashi))) score += 2;
  // 2. Kendra or trikona placement
  if (lordHouse != null && [1, 4, 5, 7, 9, 10].includes(lordHouse)) score += 2;
  // 3. Free from malefic conjunction/aspect
  const occupyingLordHouse = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== lord
    && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === lordHouse);
  const aspectingLordHouse = lordHouse != null ? planetsAspectingHouse(lordHouse, planetaryPositions, lagnaRashi) : [];
  const malefics = new Set([...occupyingLordHouse, ...aspectingLordHouse]);
  if (![...malefics].some(p => NATURAL_MALEFICS.includes(p))) score += 2;
  // 4. Benefic aspect on Lagna (house 1)
  const aspectingLagna = planetsAspectingHouse(1, planetaryPositions, lagnaRashi);
  if (aspectingLagna.some(p => NATURAL_BENEFICS.includes(p))) score += 2;
  // 5. Not combust, not debilitated
  const combust = planetaryPositions.sun ? isCombust(lordPos, planetaryPositions.sun) : false;
  if (!combust && DEBILITATION[lord] !== lordPos.rashi) score += 2;

  return score;
}

/**
 * S = Surya (Sun). Literal spec criteria:
 *  1. Sun in own sign (Leo) or exaltation (Aries)
 *  2. Sun in 10th house, or a trikona (1,5,9) house from Lagna
 *  3. Full aspect/conjunction of a natural benefic (Jupiter/Venus)
 *  4. Free from Rahu-Ketu affliction AND free from Saturn-Mars malefic aspect
 *  5. Not in a dushtana house (6,8,12) and not in debilitation sign (Libra)
 */
function scoreS(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.sun || !planetaryPositions.lagna) return null;
  const sunPos = planetaryPositions.sun;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const sunHouse = houseOfPlanet(sunPos.rashi, lagnaRashi);
  let score = 0;

  if (EXALTATION.sun === sunPos.rashi || (OWN_SIGNS.sun && OWN_SIGNS.sun.includes(sunPos.rashi))) score += 2;
  if (sunHouse === 10 || [1, 5, 9].includes(sunHouse)) score += 2;

  const occupyingSunHouse = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== 'sun'
    && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === sunHouse);
  const aspectingSunHouse = sunHouse != null ? planetsAspectingHouse(sunHouse, planetaryPositions, lagnaRashi) : [];
  const influencingSun = new Set([...occupyingSunHouse, ...aspectingSunHouse]);
  if ([...influencingSun].some(p => p === 'jupiter' || p === 'venus')) score += 2;
  if (![...influencingSun].some(p => p === 'rahu' || p === 'ketu') && ![...influencingSun].some(p => p === 'mars' || p === 'saturn')) score += 2;
  if (!DUSTHANA.includes(sunHouse) && DEBILITATION.sun !== sunPos.rashi) score += 2;

  return score;
}

/**
 * M = Chandra (Moon). Literal spec criteria:
 *  1. Waxing/bright Moon (born between the 5th tithi of the bright
 *     fortnight and the full moon) -- approximated using the
 *     Moon-Sun angular distance (50deg-180deg range)
 *  2. Moon in exaltation (Taurus) or own sign (Cancer)
 *  3. Aspect/conjunction of a natural benefic (Jupiter/Venus/Mercury)
 *  4. In a kendra/trikona house, free from malefic aspects
 *  5. Not debilitated (Scorpio), not conjunct malefics, not combust
 */
function scoreM(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.moon || !planetaryPositions.sun || !planetaryPositions.lagna) return null;
  const moonPos = planetaryPositions.moon;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const moonHouse = houseOfPlanet(moonPos.rashi, lagnaRashi);
  let score = 0;

  const moonLong = absoluteLongitude(moonPos);
  const sunLong = absoluteLongitude(planetaryPositions.sun);
  const tithiDist = ((moonLong - sunLong) % 360 + 360) % 360;
  if (tithiDist >= 50 && tithiDist <= 180) score += 2;

  if (EXALTATION.moon === moonPos.rashi || (OWN_SIGNS.moon && OWN_SIGNS.moon.includes(moonPos.rashi))) score += 2;

  const occupyingMoonHouse = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== 'moon'
    && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === moonHouse);
  const aspectingMoonHouse = moonHouse != null ? planetsAspectingHouse(moonHouse, planetaryPositions, lagnaRashi) : [];
  const influencingMoon = new Set([...occupyingMoonHouse, ...aspectingMoonHouse]);
  if ([...influencingMoon].some(p => NATURAL_BENEFICS.includes(p))) score += 2;

  if (moonHouse != null && KENDRA_TRIKONA.includes(moonHouse) && ![...influencingMoon].some(p => NATURAL_MALEFICS.includes(p))) score += 2;

  const combust = isCombust(moonPos, planetaryPositions.sun);
  if (DEBILITATION.moon !== moonPos.rashi && ![...influencingMoon].some(p => NATURAL_MALEFICS.includes(p)) && !combust) score += 2;

  return score;
}

/** SB = overall Shadbala: average ratio across all 7 classical grahas. */
function scoreSB(shadbala) {
  if (!shadbala) return null;
  const ratios = Object.values(shadbala).map(p => p.ratio).filter(r => r != null);
  if (!ratios.length) return null;
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return ratioToTen(avg);
}

/**
 * AV = Ashtakvarga. Literal spec criteria:
 *  1. Lagna house gets more than 28 Sarvashtakvarga bindus (~32%)
 *  2. In Sun's own Bhinnashtakavarga, the house Sun occupies has >= 5 bindus
 *  3. In Moon's own Bhinnashtakavarga, the house Moon occupies has >= 5 bindus
 *  4. 5th house gets a high (>= 30) Sarvashtakvarga score
 *  5. 10th house gets more than 30 Sarvashtakvarga bindus
 * DOCUMENTED SIMPLIFICATION: criteria 3 and 4's exact numeric cutoffs
 * ("good"/"high") aren't stated as precisely in the spec as criteria
 * 1 and 5 -- 5 bindus and 30 bindus are used as reasonable, consistent
 * thresholds matching the spec's other explicit cutoffs.
 */
function scoreAV(ashtakvarga, planetaryPositions) {
  if (!ashtakvarga || !planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const sunRashi = planetaryPositions.sun && planetaryPositions.sun.rashi;
  const moonRashi = planetaryPositions.moon && planetaryPositions.moon.rashi;
  const fifthRashi = RASHI_ORDER[(RASHI_ORDER.indexOf(lagnaRashi) + 4) % 12];
  const tenthRashi = RASHI_ORDER[(RASHI_ORDER.indexOf(lagnaRashi) + 9) % 12];

  let score = 0;
  if (ashtakvarga[lagnaRashi] && ashtakvarga[lagnaRashi].sarvashtakvarga > 28) score += 2;
  if (sunRashi && ashtakvarga[sunRashi] && ashtakvarga[sunRashi].sun >= 5) score += 2;
  if (moonRashi && ashtakvarga[moonRashi] && ashtakvarga[moonRashi].moon >= 5) score += 2;
  if (ashtakvarga[fifthRashi] && ashtakvarga[fifthRashi].sarvashtakvarga >= 30) score += 2;
  if (ashtakvarga[tenthRashi] && ashtakvarga[tenthRashi].sarvashtakvarga > 30) score += 2;

  return score;
}

/**
 * N = Nakshatra: strength of the birth nakshatra's ruling planet
 * (read directly from the Dasha Bhog line). Rahu/Ketu aren't in the
 * Shadbala table (AstroSage only computes Shadbala for the 7
 * classical grahas), so those default to a neutral 5.
 */
function scoreN(shadbala, nakshatraLord) {
  if (!nakshatraLord) return null;
  if (nakshatraLord === 'rahu' || nakshatraLord === 'ketu') return 5;
  const ratio = shadbala && shadbala[nakshatraLord] && shadbala[nakshatraLord].ratio;
  return ratioToTen(ratio);
}

const LAGNA_LORD_MAP = { Aries: 'mars', Taurus: 'venus', Gemini: 'mercury', Cancer: 'moon', Leo: 'sun', Virgo: 'mercury', Libra: 'venus', Scorpio: 'mars', Sagittarius: 'jupiter', Capricorn: 'saturn', Aquarius: 'saturn', Pisces: 'jupiter' };

/**
 * Real Navamsha (D9) divisional chart calculation.
 * Classical rule: each 30-degree Rashi is split into 9 padas of
 * 3deg20' each. For movable signs (Aries/Cancer/Libra/Capricorn) the
 * D9 count starts from the same sign; for fixed signs
 * (Taurus/Leo/Scorpio/Aquarius) it starts from the 9th sign from it;
 * for dual signs (Gemini/Virgo/Sagittarius/Pisces) it starts from the
 * 5th sign from it. This is the standard, universally-used Parashari
 * rule (not spec-specific -- there is no ambiguity in this part of
 * classical astrology).
 */
function navamshaRashi(rashi, degreeInSign) {
  const signIdx = RASHI_ORDER.indexOf(rashi);
  if (signIdx === -1 || degreeInSign == null) return null;
  const MOVABLE = [0, 3, 6, 9], FIXED = [1, 4, 7, 10]; // DUAL = [2,5,8,11]
  let start;
  if (MOVABLE.includes(signIdx)) start = signIdx;
  else if (FIXED.includes(signIdx)) start = (signIdx + 8) % 12;
  else start = (signIdx + 4) % 12; // dual signs
  const pada = clamp(Math.floor(degreeInSign / (30 / 9)), 0, 8);
  return RASHI_ORDER[(start + pada) % 12];
}

/** Derives the full D9 chart (lagna + all planets) from real D1 positions. */
function computeD9Positions(planetaryPositions) {
  const d9 = {};
  Object.keys(planetaryPositions || {}).forEach(p => {
    const pos = planetaryPositions[p];
    if (pos && pos.rashi != null && pos.degreeInSign != null) {
      const rashi = navamshaRashi(pos.rashi, pos.degreeInSign);
      if (rashi) d9[p] = { rashi };
    }
  });
  return d9;
}

/**
 * D9 = Navamsha strength. Now backed by a REAL computed D9 chart
 * (see computeD9Positions/navamshaRashi above) instead of the old
 * placeholder that guessed from the D1 Lagna Lord's dignity alone.
 *
 * The CEI spec's own 5 literal sub-criteria for this factor were
 * never legible in the source PDF (same mojibake issue that affected
 * SB/N/H/P), so this uses the same style of dignity/placement/aspect
 * checks already used for L (which ARE spec-confirmed) -- but applied
 * to the D9 chart itself rather than to D1. This is a genuine
 * Navamsha-based computation, not a guess, though the specific
 * 5-criteria wording is still an approximation pending the literal
 * D9 spec text.
 */
function scoreD9(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.lagna) return { score: null, isPlaceholder: true };
  const d9 = computeD9Positions(planetaryPositions);
  const d9LagnaRashi = d9.lagna ? d9.lagna.rashi : null;
  if (!d9LagnaRashi) return { score: null, isPlaceholder: true };

  const d9Lord = LAGNA_LORD_MAP[d9LagnaRashi];
  const d9LordPos = d9[d9Lord];
  if (!d9LordPos) return { score: null, isPlaceholder: true };

  let score = 0;
  // 1. D9 Lagna Lord exalted or in own sign, within the D9 chart
  if (EXALTATION[d9Lord] === d9LordPos.rashi || (OWN_SIGNS[d9Lord] || []).includes(d9LordPos.rashi)) score += 2;

  const d9LordHouse = houseOfPlanet(d9LordPos.rashi, d9LagnaRashi);
  // 2. D9 Lagna Lord in a kendra/trikona house of the D9 chart
  if (d9LordHouse != null && KENDRA_TRIKONA.includes(d9LordHouse)) score += 2;

  // 3. A natural benefic aspects the D9 Lagna (1st house of D9)
  const aspectingD9Lagna = planetsAspectingHouse(1, d9, d9LagnaRashi);
  if (aspectingD9Lagna.some(p => NATURAL_BENEFICS.includes(p))) score += 2;

  // 4. D9 Lagna Lord free from malefic conjunction/aspect within D9
  const occupyingD9LordHouse = Object.keys(d9).filter(p => p !== 'lagna' && p !== d9Lord
    && houseOfPlanet(d9[p].rashi, d9LagnaRashi) === d9LordHouse);
  const aspectingD9LordHouse = d9LordHouse != null ? planetsAspectingHouse(d9LordHouse, d9, d9LagnaRashi) : [];
  const maleficsOnD9Lord = new Set([...occupyingD9LordHouse, ...aspectingD9LordHouse]);
  if (![...maleficsOnD9Lord].some(p => NATURAL_MALEFICS.includes(p))) score += 2;

  // 5. D9 Lagna Lord not debilitated in the D9 chart
  if (DEBILITATION[d9Lord] !== d9LordPos.rashi) score += 2;

  return {
    score: clamp(score, 0, 10),
    isPlaceholder: false,
    d9LagnaRashi,
    d9Lord,
    d9LordRashi: d9LordPos.rashi
  };
}

/** H = overall house health: average Bhava Bala Rupas across all 12 houses, scaled to 0-10. */
function scoreH(bhavaBala) {
  if (!bhavaBala) return null;
  const rupasList = Object.values(bhavaBala).map(b => b.totalBhavaBalaRupas).filter(r => r != null);
  if (!rupasList.length) return null;
  const avg = rupasList.reduce((a, b) => a + b, 0) / rupasList.length;
  return clamp((avg / 15) * 10, 0, 10);
}

/**
 * P = Panchatattva (elemental balance): how evenly the 7 classical
 * grahas + Lagna are spread across Fire/Earth/Air/Water, plus a small
 * bonus for Jupiter's strength (the PDF describes Jupiter/wisdom as
 * representing the unifying "5th/Aether" element).
 */
function scoreP(planetaryPositions, shadbala) {
  if (!planetaryPositions) return null;
  const counts = { Fire: 0, Earth: 0, Air: 0, Water: 0 };
  const relevant = ['lagna', 'sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];
  let total = 0;
  relevant.forEach(p => {
    const rashi = planetaryPositions[p] && planetaryPositions[p].rashi;
    const el = rashi && ELEMENT_OF_RASHI[rashi];
    if (el) { counts[el]++; total++; }
  });
  if (!total) return null;
  const ideal = total / 4;
  const variance = Object.values(counts).reduce((sum, c) => sum + Math.abs(c - ideal), 0);
  const balanceScore = clamp(8 - variance * 0.8, 0, 8); // max 8 from balance
  const jupiterRatio = shadbala && shadbala.jupiter && shadbala.jupiter.ratio;
  const jupiterBonus = jupiterRatio != null ? clamp(jupiterRatio, 0, 1) * 2 : 0; // up to 2 bonus
  return clamp(balanceScore + jupiterBonus, 0, 10);
}

/**
 * EL = Energy Loss (0-10 deduction). Based on confirmed doshas from
 * parseDoshas(). Each confirmed-present dosha costs points; unknown
 * (undetected) doshas default to 0 cost rather than assuming the
 * worst, since a false penalty is worse than a missed one here.
 */
function scoreEL(doshas) {
  if (!doshas) return 0;
  let el = 0;
  if (doshas.mangalDoshaLagnaKundli === true) el += 3;
  if (doshas.mangalDoshaChandraKundli === true) el += 2;
  if (doshas.kaalSarpDosha === true) el += 3;
  return clamp(el, 0, 10);
}

/**
 * CEI/LPI comparative grading matrix — confirmed directly from the
 * spec PDF's own table. Both indices share this SAME band structure,
 * applied to the raw /90 score. (Distinct from the 12-house grading
 * bands, which are 85-100/70-84.9/55-69.9/40-54.9/<40 out of 100 —
 * those apply to HPS/WPS/etc., NOT to CEI/LPI.)
 */
function gradeCeiLpi(score) {
  if (score == null) return null;
  if (score >= 80) return 'Supreme Harmony';   // 80-90
  if (score >= 70) return 'Good Harmony';       // 70-79
  if (score >= 60) return 'Average Harmony';    // 60-69
  if (score >= 50) return 'Energy-Loss Effect'; // 50-59
  return 'Severe Imbalance';                    // <50
}

/** Computes CEI per the official 9-factor + EL formula. */
function calculateCEI(parsedData) {
  const { shadbala, bhavaBala, ashtakvarga, planetaryPositions, doshas, nakshatraLord } = parsedData;
  const lagnaRashi = planetaryPositions && planetaryPositions.lagna ? planetaryPositions.lagna.rashi : null;

  const L = scoreL(planetaryPositions);
  const S = scoreS(planetaryPositions);
  const M = scoreM(planetaryPositions);
  const SB = scoreSB(shadbala);
  const AV = scoreAV(ashtakvarga, planetaryPositions);
  const N = scoreN(shadbala, nakshatraLord);
  const D9result = scoreD9(planetaryPositions);
  const D9 = D9result.score;
  const H = scoreH(bhavaBala);
  const P = scoreP(planetaryPositions, shadbala);
  const EL = scoreEL(doshas);

  const components = { L, S, M, SB, AV, N, D9, H, P };
  const validComponents = Object.values(components).filter(v => v != null);
  if (validComponents.length < 9) {
    return {
      score: null,
      scoreNormalized: null,
      maxScore: 90,
      grade: null,
      detail: { reason: 'Incomplete data for one or more CEI factors', components, EL }
    };
  }

  const rawSum = validComponents.reduce((a, b) => a + b, 0); // max 90
  const rawAfterLoss = clamp(rawSum - EL, 0, 90);

  // Reported/graded score: the TRUE raw score out of 90, per spec.
  // (No /100 rescaling here — see file header for why.)
  const score = Math.round(rawAfterLoss);

  // Normalized value: NOT for display. Only for houseScoring.js's
  // internal weighted-sum combination with the 0-100 House/Lord/Yoga
  // sub-scores.
  const scoreNormalized = Math.round((rawAfterLoss / 90) * 100);

  return {
    score: clamp(score, 0, 90),
    scoreNormalized: clamp(scoreNormalized, 0, 100),
    maxScore: 90,
    grade: gradeCeiLpi(score),
    detail: {
      formula: 'CEI = L + S + M + SB + AV + N + D9 + H + P - EL (raw, out of 90 — per spec grading matrix, NOT rescaled to /100)',
      components: {
        L: round1(L), S: round1(S), M: round1(M), SB: round1(SB), AV: round1(AV),
        N: round1(N), D9: round1(D9), H: round1(H), P: round1(P)
      },
      D9_isPlaceholder: D9result.isPlaceholder,
      D9_note: D9result.isPlaceholder
        ? 'Could not compute a real D9 chart for this record (missing degree-in-sign data for Lagna or a planet).'
        : `Computed from a real Navamsha (D9) divisional chart: D9 Lagna=${D9result.d9LagnaRashi}, D9 Lagna Lord=${D9result.d9Lord} (in ${D9result.d9LordRashi}). The 5 sub-criteria checked mirror the spec-confirmed Lagna (L) criteria, applied to the D9 chart — the literal D9-specific spec wording was not legible in the source PDF.`,
      EL,
      rawSum: round1(rawSum),
      rawAfterLoss: round1(rawAfterLoss),
      maxScore: 90,
      gradingBandsUsed: '80-90 Supreme Harmony | 70-79 Good Harmony | 60-69 Average Harmony | 50-59 Energy-Loss Effect | <50 Severe Imbalance',
      doshasUsedForEL: doshas,
      nakshatraLordUsedForN: nakshatraLord
    }
  };
}

// ---- LPI's 9 life-domain factors (each 0-10) ----
// Mapped to classical house significations, using the same Bhava
// Bala / Shadbala data. House numbers below are standard Vedic
// significations (not decoded from the PDF's garbled sub-criteria).

function houseRupas(bhavaBala, houseNumber) {
  return bhavaBala && bhavaBala[houseNumber] ? bhavaBala[houseNumber].totalBhavaBalaRupas : null;
}

function avgHouseScore(bhavaBala, houseNumbers) {
  const vals = houseNumbers.map(h => houseRupas(bhavaBala, h)).filter(v => v != null);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return clamp((avg / 15) * 10, 0, 10);
}

function calculateLPI(parsedData) {
  const { bhavaBala } = parsedData;

  const physicalHealth = avgHouseScore(bhavaBala, [1, 6]); // vitality + disease-resistance houses
  const mentalHealth = avgHouseScore(bhavaBala, [4]);      // house of mind/comfort (blended with Moon in scoreM already used for CEI's M)
  const financialStatus = avgHouseScore(bhavaBala, [2, 11]); // wealth + gains
  const career = avgHouseScore(bhavaBala, [10]);            // karma/profession
  const education = avgHouseScore(bhavaBala, [4, 5, 9]);    // early education + intellect + higher wisdom
  const familyMarriedLife = avgHouseScore(bhavaBala, [2, 4, 7]); // family + domestic happiness + spouse
  const socialPrestige = avgHouseScore(bhavaBala, [10, 11]);     // status + gains/social circle
  const spiritualLife = avgHouseScore(bhavaBala, [9, 12]);       // dharma + moksha
  const lifeSatisfaction = avgHouseScore(bhavaBala, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // overall average, all houses

  const components = {
    physicalHealth, mentalHealth, financialStatus, career, education,
    familyMarriedLife, socialPrestige, spiritualLife, lifeSatisfaction
  };
  const validComponents = Object.values(components).filter(v => v != null);
  if (validComponents.length < 9) {
    return {
      score: null,
      scoreNormalized: null,
      maxScore: 90,
      grade: null,
      detail: { reason: 'Incomplete Bhava Bala data for one or more LPI domains', components }
    };
  }

  const rawSum = validComponents.reduce((a, b) => a + b, 0); // max 90

  // Reported/graded score: the TRUE raw score out of 90, per spec.
  const score = Math.round(rawSum);

  // Normalized value: NOT for display. Only for houseScoring.js's
  // internal weighted-sum combination.
  const scoreNormalized = Math.round((rawSum / 90) * 100);

  return {
    score: clamp(score, 0, 90),
    scoreNormalized: clamp(scoreNormalized, 0, 100),
    maxScore: 90,
    grade: gradeCeiLpi(score),
    detail: {
      formula: 'LPI = sum of 9 life-domain scores (Physical Health, Mental Health, Financial Status, Career, Education, Family/Married Life, Social Prestige, Spiritual Life, Life Satisfaction) — raw, out of 90, NOT rescaled to /100',
      components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, round1(v)])),
      houseMappingUsed: {
        physicalHealth: 'Houses 1, 6', mentalHealth: 'House 4', financialStatus: 'Houses 2, 11',
        career: 'House 10', education: 'Houses 4, 5, 9', familyMarriedLife: 'Houses 2, 4, 7',
        socialPrestige: 'Houses 10, 11', spiritualLife: 'Houses 9, 12', lifeSatisfaction: 'All 12 houses averaged'
      },
      rawSum: round1(rawSum),
      maxScore: 90,
      gradingBandsUsed: '80-90 Supreme Harmony | 70-79 Good Harmony | 60-69 Average Harmony | 50-59 Energy-Loss Effect | <50 Severe Imbalance'
    }
  };
}

function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }

module.exports = {
  calculateCEI,
  calculateLPI,
  scoreL, scoreS, scoreM, scoreSB, scoreAV, scoreN, scoreD9, scoreH, scoreP, scoreEL,
  ELEMENT_OF_RASHI, EXALTATION, DEBILITATION, OWN_SIGNS
};
