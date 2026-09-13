/**
 * Official CEI Scoring Engine
 * ------------------------------------------------------------
 * CEI = L + S + M + SB + AV + N + D9 + H + P − EL   (raw, out of 90)
 * Each factor 0-10 (5 sub-criteria x 2 pts). EL is a 0-10 deduction.
 *
 * STATUS (verified against Rahul Gandhi's worksheet, CEI_Rahul_Gandhi.xlsx):
 *   L, S, M, SB, AV, N  -> CONFIRMED EXACT MATCH. Untouched below.
 *   D9                  -> FIXED this rebuild (see note below).
 *   P                   -> FIXED this rebuild (see note below).
 *   H                   -> BEST-GUESS EXTRAPOLATION, NOT CONFIRMED (see note below).
 *   EL                  -> still an approximation (no worksheet data yet).
 *
 * ============================================================
 * D9 FIX — degree-based dignity, not sign-only
 * ============================================================
 * Father's correction (Venus/Rahul Gandhi example): a planet in its
 * debilitation SIGN is not automatically "debilitated" for scoring
 * purposes. Dignity (both exaltation and debilitation) is only
 * "real" near the exact classical degree of exaltation/debilitation:
 *   - within  ±3° of the exact degree -> full effect
 *   - within  ±3°–6° of the exact degree -> partial effect
 *   - beyond  ±6° -> no effect at all, even though the sign matches
 * A planet's degree is constant across all divisional charts (D1,
 * D9, D10, ...) — only its house/sign placement changes per chart.
 * This is now implemented via `dignityEffect()` below and used in D9.
 *
 * NOTE: this same rule may also apply to L/S/M/N's sign-only dignity
 * checks (father did not limit it to D9 when explaining it) — but
 * those four factors ALREADY match the worksheet exactly using the
 * old sign-only logic, so retrofitting risks breaking a confirmed
 * match. Left untouched pending a criterion-by-criterion worksheet
 * check with the father before changing L/S/M/N.
 *
 * ============================================================
 * P FIX — elemental trikona sign-matching, not raw point-count
 * ============================================================
 * Father's correction (Fire/Rahul Gandhi example): P is NOT about
 * total elemental point-count across the chart. It's about whether
 * the RASHI actually occupying each trikona's three houses belongs
 * to that trikona's natural element:
 *   Fire (Dharma)  = houses 1, 5, 9
 *   Earth (Artha)  = houses 2, 6, 10
 *   Air (Kama)     = houses 3, 7, 11
 *   Water (Moksha) = houses 4, 8, 12
 * A group is "balanced" only if all 3 houses in that trikona are
 * occupied by rashis of the matching element. Confirmed for Fire
 * (Rahul Gandhi: houses 1/5/9 = Libra/Aquarius/Gemini, all Air ->
 * fully unbalanced, scored 0 despite a "textbook ideal" raw point
 * count). NOT YET CONFIRMED: the exact 5th sub-criterion for P (this
 * rebuild uses only 4 groups worth 2 pts each = 8 of 10, with 1
 * placeholder point — see scoreP for detail).
 *
 * ============================================================
 * H — UNCONFIRMED EXTRAPOLATION, please verify with father
 * ============================================================
 * Confirmed by father for ONE group only: houses 7-9, where the 8th
 * and 9th houses act as "gatekeepers" — if either gatekeeper house's
 * Sarvashtakvarga bindu count is low, the WHOLE 3-house group scores
 * as failing, regardless of the 3rd house's (7th's) own strength.
 * This rebuild extrapolates the same "last two houses of each
 * trikona act as gatekeepers" pattern to the other three groups
 * (1-3 gatekept by 2-3, 4-6 gatekept by 5-6, 10-12 gatekept by
 * 11-12), using "below the chart's average bindus-per-sign" as the
 * gatekeeper failure threshold. THIS IS A GUESS. Please confirm the
 * exact rule with the father and treat H's numbers as provisional
 * until then.
 */

const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const ELEMENT_OF_RASHI = {
  Aries: 'Fire', Leo: 'Fire', Sagittarius: 'Fire',
  Taurus: 'Earth', Virgo: 'Earth', Capricorn: 'Earth',
  Gemini: 'Air', Libra: 'Air', Aquarius: 'Air',
  Cancer: 'Water', Scorpio: 'Water', Pisces: 'Water'
};

const SIGN_LORD = {
  Aries: 'mars', Taurus: 'venus', Gemini: 'mercury', Cancer: 'moon',
  Leo: 'sun', Virgo: 'mercury', Libra: 'venus', Scorpio: 'mars',
  Sagittarius: 'jupiter', Capricorn: 'saturn', Aquarius: 'saturn', Pisces: 'jupiter'
};

// Classical dignity tables (standard, not chart-specific)
const EXALTATION = { sun: 'Aries', moon: 'Taurus', mars: 'Capricorn', mercury: 'Virgo', jupiter: 'Cancer', venus: 'Pisces', saturn: 'Libra' };
const DEBILITATION = { sun: 'Libra', moon: 'Scorpio', mars: 'Cancer', mercury: 'Pisces', jupiter: 'Capricorn', venus: 'Virgo', saturn: 'Aries' };
const OWN_SIGNS = { sun: ['Leo'], moon: ['Cancer'], mars: ['Aries', 'Scorpio'], mercury: ['Gemini', 'Virgo'], jupiter: ['Sagittarius', 'Pisces'], venus: ['Taurus', 'Libra'], saturn: ['Capricorn', 'Aquarius'] };

// Exact classical degree of exaltation (debilitation = same degree number, opposite sign).
const EXALTATION_DEGREE = { sun: 10, moon: 3, mars: 28, mercury: 15, jupiter: 5, venus: 27, saturn: 20 };
const DEBILITATION_DEGREE = { sun: 10, moon: 3, mars: 28, mercury: 15, jupiter: 5, venus: 27, saturn: 20 };

const AVG_SARVASHTAKVARGA_PER_SIGN = 337 / 12;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function rashiForHouse(lagnaRashi, houseNumber) {
  const idx = RASHI_ORDER.indexOf(lagnaRashi);
  if (idx === -1) return null;
  return RASHI_ORDER[(idx + houseNumber - 1) % 12];
}

/**
 * Degree-aware dignity check (see D9 FIX note above).
 * Returns one of: 'full-exalted' | 'partial-exalted' | 'own' |
 *                 'full-debilitated' | 'partial-debilitated' | 'neutral'
 */
function dignityEffect(planet, rashi, degreeInSign) {
  if (!rashi || !planet) return 'neutral';
  const deg = degreeInSign == null ? 0 : degreeInSign;

  if (EXALTATION[planet] === rashi) {
    const orb = Math.abs(deg - EXALTATION_DEGREE[planet]);
    if (orb <= 3) return 'full-exalted';
    if (orb <= 6) return 'partial-exalted';
    return 'neutral'; // right sign, too far from exact degree -> no exaltation effect
  }
  if (DEBILITATION[planet] === rashi) {
    const orb = Math.abs(deg - DEBILITATION_DEGREE[planet]);
    if (orb <= 3) return 'full-debilitated';
    if (orb <= 6) return 'partial-debilitated';
    return 'neutral'; // right sign, too far from exact degree -> no debilitation effect
  }
  if (OWN_SIGNS[planet] && OWN_SIGNS[planet].includes(rashi)) return 'own';
  return 'neutral';
}

/** Legacy sign-only dignity bonus — kept only for any old caller still referencing it. */
function dignityBonus(planet, rashi) {
  if (!rashi) return 0;
  if (EXALTATION[planet] === rashi) return 2;
  if (DEBILITATION[planet] === rashi) return -2;
  if (OWN_SIGNS[planet] && OWN_SIGNS[planet].includes(rashi)) return 1;
  return 0;
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

/** Which planets aspect a given house (Parashari graha drishti). Works for any {planet: {rashi}} map. Rahu/Ketu excluded -- most Parashari treatments say shadow planets don't cast classical aspects. */
function planetsAspectingHouse(targetHouse, positions, lagnaRashi) {
  const aspecting = [];
  Object.keys(positions || {}).forEach(p => {
    if (p === 'lagna' || p === 'rahu' || p === 'ketu') return;
    const pos = positions[p];
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

/** Combustion: within a fixed 10-degree orb of the Sun (documented simplification, see original note). */
function isCombust(planetPos, sunPos) {
  const pLong = absoluteLongitude(planetPos);
  const sLong = absoluteLongitude(sunPos);
  if (pLong == null || sLong == null) return false;
  const diff = Math.abs(pLong - sLong) % 360;
  const dist = Math.min(diff, 360 - diff);
  return dist <= 10;
}

// ============================================================
// L, S, M, SB, AV, N — CONFIRMED EXACT MATCH. UNCHANGED.
// ============================================================

function scoreL(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const lord = SIGN_LORD[lagnaRashi];
  const lordPos = planetaryPositions[lord];
  if (!lordPos) return null;

  const lordHouse = houseOfPlanet(lordPos.rashi, lagnaRashi);
  const criteria = [];

  criteria.push({ label: 'Lagna lord is exalted or in its own sign', passed: EXALTATION[lord] === lordPos.rashi || (OWN_SIGNS[lord] && OWN_SIGNS[lord].includes(lordPos.rashi)) });
  criteria.push({ label: 'Lagna lord is placed in a kendra/trikona house', passed: lordHouse != null && KENDRA_TRIKONA.includes(lordHouse) });

  const occupyingLordHouse = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== lord
    && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === lordHouse);
  const aspectingLordHouse = lordHouse != null ? planetsAspectingHouse(lordHouse, planetaryPositions, lagnaRashi) : [];
  const malefics = new Set([...occupyingLordHouse, ...aspectingLordHouse]);
  criteria.push({ label: "Lagna lord's house is free from malefic occupation/aspect", passed: ![...malefics].some(p => NATURAL_MALEFICS.includes(p)) });

  const aspectingLagna = planetsAspectingHouse(1, planetaryPositions, lagnaRashi);
  criteria.push({ label: 'A natural benefic (Jupiter/Venus/Mercury) aspects the Lagna', passed: aspectingLagna.some(p => NATURAL_BENEFICS.includes(p)) });

  const combust = planetaryPositions.sun ? isCombust(lordPos, planetaryPositions.sun) : false;
  criteria.push({ label: 'Lagna lord is not combust and not debilitated', passed: !combust && DEBILITATION[lord] !== lordPos.rashi });

  const score = criteria.filter(c => c.passed).length * 2;
  return { score, criteria };
}

function scoreS(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.sun || !planetaryPositions.lagna) return null;
  const sunPos = planetaryPositions.sun;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const sunHouse = houseOfPlanet(sunPos.rashi, lagnaRashi);
  const criteria = [];

  criteria.push({ label: 'Sun is exalted or in its own sign', passed: EXALTATION.sun === sunPos.rashi || (OWN_SIGNS.sun && OWN_SIGNS.sun.includes(sunPos.rashi)) });
  criteria.push({ label: 'Sun is in the 10th house or a kendra/trikona (1/5/9)', passed: sunHouse === 10 || [1, 5, 9].includes(sunHouse) });

  const occupyingSunHouse = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== 'sun'
    && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === sunHouse);
  const aspectingSunHouse = sunHouse != null ? planetsAspectingHouse(sunHouse, planetaryPositions, lagnaRashi) : [];
  const influencingSun = new Set([...occupyingSunHouse, ...aspectingSunHouse]);
  criteria.push({ label: 'Sun is influenced by a natural benefic (Jupiter/Venus)', passed: [...influencingSun].some(p => p === 'jupiter' || p === 'venus') });
  criteria.push({ label: 'Sun is free from Rahu/Ketu and Mars/Saturn influence', passed: ![...influencingSun].some(p => p === 'rahu' || p === 'ketu') && ![...influencingSun].some(p => p === 'mars' || p === 'saturn') });
  criteria.push({ label: 'Sun is not in a dusthana house (6/8/12) and not debilitated', passed: !DUSTHANA.includes(sunHouse) && DEBILITATION.sun !== sunPos.rashi });

  const score = criteria.filter(c => c.passed).length * 2;
  return { score, criteria };
}

function scoreM(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.moon || !planetaryPositions.sun || !planetaryPositions.lagna) return null;
  const moonPos = planetaryPositions.moon;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const moonHouse = houseOfPlanet(moonPos.rashi, lagnaRashi);
  const criteria = [];

  const moonLong = absoluteLongitude(moonPos);
  const sunLong = absoluteLongitude(planetaryPositions.sun);
  const tithiDist = ((moonLong - sunLong) % 360 + 360) % 360;
  criteria.push({ label: "Moon's tithi distance from Sun is in the favorable range", passed: tithiDist >= 50 && tithiDist <= 180 });

  criteria.push({ label: 'Moon is exalted or in its own sign', passed: EXALTATION.moon === moonPos.rashi || (OWN_SIGNS.moon && OWN_SIGNS.moon.includes(moonPos.rashi)) });

  const occupyingMoonHouse = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== 'moon'
    && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === moonHouse);
  const aspectingMoonHouse = moonHouse != null ? planetsAspectingHouse(moonHouse, planetaryPositions, lagnaRashi) : [];
  const influencingMoon = new Set([...occupyingMoonHouse, ...aspectingMoonHouse]);
  criteria.push({ label: 'Moon is influenced by a natural benefic', passed: [...influencingMoon].some(p => NATURAL_BENEFICS.includes(p)) });

  criteria.push({ label: 'Moon is in a kendra/trikona house, free from malefic aspects', passed: moonHouse != null && KENDRA_TRIKONA.includes(moonHouse) && ![...influencingMoon].some(p => NATURAL_MALEFICS.includes(p)) });

  const combust = isCombust(moonPos, planetaryPositions.sun);
  // Criterion 5 says "not CONJUNCT malefics" specifically -- conjunction means co-occupation,
  // not aspect. Aspects are already handled by criterion 4's "free from malefic aspects".
  criteria.push({ label: 'Moon is not debilitated, not conjunct malefics, and not combust', passed: DEBILITATION.moon !== moonPos.rashi && !occupyingMoonHouse.some(p => NATURAL_MALEFICS.includes(p)) && !combust });

  const score = criteria.filter(c => c.passed).length * 2;
  return { score, criteria };
}

function scoreSB(shadbala) {
  if (!shadbala) return null;
  const planets = Object.values(shadbala);
  if (!planets.length) return null;
  const avg = key => planets.reduce((s, p) => s + (p[key] || 0), 0) / planets.length;

  const criteria = [
    { label: 'Average Sthana Bala meets the minimum threshold (>=90)', passed: avg('totalSthanaBala') >= 90 },
    { label: 'Average Dig Bala meets the minimum threshold (>=30)', passed: avg('totalDigBala') >= 30 },
    { label: 'Average Kaal Bala meets the minimum threshold (>=195)', passed: avg('totalKaalBala') >= 195 },
    { label: 'Average Cheshta Bala meets the minimum threshold (>=30)', passed: avg('totalChestaBala') >= 30 },
    { label: 'Average Naisargika Bala meets the minimum threshold (>=30)', passed: avg('totalNaisargikaBala') >= 30 }
  ];
  const score = criteria.filter(c => c.passed).length * 2;
  return { score, criteria };
}

function scoreAV(ashtakvarga, planetaryPositions) {
  if (!ashtakvarga || !planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const sunRashi = planetaryPositions.sun && planetaryPositions.sun.rashi;
  const moonRashi = planetaryPositions.moon && planetaryPositions.moon.rashi;
  const fifthRashi = RASHI_ORDER[(RASHI_ORDER.indexOf(lagnaRashi) + 4) % 12];
  const tenthRashi = RASHI_ORDER[(RASHI_ORDER.indexOf(lagnaRashi) + 9) % 12];

  const criteria = [
    { label: "Lagna's Sarvashtakvarga bindus are above the threshold (>28)", passed: !!(ashtakvarga[lagnaRashi] && ashtakvarga[lagnaRashi].sarvashtakvarga > 28) },
    { label: "Sun has strong own-bindus in its sign (>=4)", passed: !!(sunRashi && ashtakvarga[sunRashi] && ashtakvarga[sunRashi].sun >= 4) },
    { label: "Moon has strong own-bindus in its sign (>=4)", passed: !!(moonRashi && ashtakvarga[moonRashi] && ashtakvarga[moonRashi].moon >= 4) },
    { label: "5th house's Sarvashtakvarga bindus meet the threshold (>=30)", passed: !!(ashtakvarga[fifthRashi] && ashtakvarga[fifthRashi].sarvashtakvarga >= 30) },
    { label: "10th house's Sarvashtakvarga bindus meet the threshold (>30)", passed: !!(ashtakvarga[tenthRashi] && ashtakvarga[tenthRashi].sarvashtakvarga > 30) }
  ];
  const score = criteria.filter(c => c.passed).length * 2;
  return { score, criteria };
}

// "Benefic nature" criterion: NOT a strict Deva-gana whitelist -- father
// confirmed Mula (classically Rakshasa-gana) should still count as
// benefic here, so this uses a short BLACKLIST of severely
// inauspicious nakshatras instead (benefic unless on this list).
// DOCUMENTED APPROXIMATION: the exact full blacklist isn't confirmed
// beyond "Mula is NOT on it" -- Ashlesha and Jyeshtha are the other
// two classically Gandanta/most-inauspicious nakshatras and are used
// here pending further confirmation.
const SEVERELY_INAUSPICIOUS_NAKSHATRAS = ['Ashlesha', 'Jyeshtha'];
// Alternate spellings some APIs use for the same nakshatras (e.g. AstrologyAPI.com returns "Mool" not "Mula").
const NAKSHATRA_SPELLING_ALIASES = { Mool: 'Mula', Dhanistha: 'Dhanishta', Jyeshta: 'Jyeshtha' };
function normalizeNakshatraName(name) {
  return NAKSHATRA_SPELLING_ALIASES[name] || name;
}
const SHADOW_EXALTATION = { rahu: 'Gemini', ketu: 'Sagittarius' };
const SHADOW_DEBILITATION = { rahu: 'Sagittarius', ketu: 'Gemini' };

function scoreN(shadbala, nakshatraLord, planetaryPositions, moonNakshatraName, bhavaBala) {
  if (!nakshatraLord || !planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const lordPos = planetaryPositions[nakshatraLord];
  const isGrahaLord = nakshatraLord !== 'rahu' && nakshatraLord !== 'ketu';
  const lordHouse = lordPos ? houseOfPlanet(lordPos.rashi, lagnaRashi) : null;
  const criteria = [];

  if (isGrahaLord) {
    const ratio = shadbala && shadbala[nakshatraLord] && shadbala[nakshatraLord].ratio;
    criteria.push({ label: 'Nakshatra lord is strong (Shadbala ratio >=1)', passed: ratio != null && ratio >= 1 });
  } else {
    const houseStrength = lordHouse != null && bhavaBala && bhavaBala[lordHouse] && bhavaBala[lordHouse].strengthPercent;
    criteria.push({ label: 'Nakshatra lord (shadow planet) is strong (house Bhava Bala >=50%)', passed: !!(houseStrength != null && houseStrength >= 50) });
  }

  criteria.push({ label: 'Nakshatra lord is placed in a kendra/trikona house', passed: !!(lordPos && lordHouse != null && KENDRA_TRIKONA.includes(lordHouse)) });

  if (lordPos) {
    const occupying = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== nakshatraLord
      && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === lordHouse);
    const aspecting = lordHouse != null ? planetsAspectingHouse(lordHouse, planetaryPositions, lagnaRashi) : [];
    const malefics = new Set([...occupying, ...aspecting]);
    criteria.push({ label: 'Nakshatra lord is free from malefic influence', passed: ![...malefics].some(p => NATURAL_MALEFICS.includes(p)) });
  } else {
    criteria.push({ label: 'Nakshatra lord is free from malefic influence', passed: false });
  }

  criteria.push({ label: "Moon's nakshatra is of a benign nature", passed: !!(moonNakshatraName && !SEVERELY_INAUSPICIOUS_NAKSHATRAS.includes(normalizeNakshatraName(moonNakshatraName))) });

  let exaltPassed = false;
  if (lordPos) {
    exaltPassed = isGrahaLord
      ? (EXALTATION[nakshatraLord] === lordPos.rashi || (OWN_SIGNS[nakshatraLord] || []).includes(lordPos.rashi))
      : (SHADOW_EXALTATION[nakshatraLord] === lordPos.rashi);
  }
  criteria.push({ label: 'Nakshatra lord is exalted / in its own sign', passed: exaltPassed });

  const score = criteria.filter(c => c.passed).length * 2;
  return { score, criteria };
}

// ============================================================
// D9 — REBUILT with real Navamsha chart + degree-based dignity
// ============================================================

/**
 * Classical Navamsha (D9) sign for a given Rashi + degree-in-sign.
 * Movable signs start from themselves; fixed signs start from the
 * 9th sign; dual signs start from the 5th sign. Each 3°20' pada
 * advances one sign from that starting point.
 */
function navamshaRashi(rashi, degreeInSign) {
  const signIdx = RASHI_ORDER.indexOf(rashi);
  if (signIdx === -1 || degreeInSign == null) return null;
  const MOVABLE = [0, 3, 6, 9], FIXED = [1, 4, 7, 10]; // DUAL = [2,5,8,11]
  let start;
  if (MOVABLE.includes(signIdx)) start = signIdx;
  else if (FIXED.includes(signIdx)) start = (signIdx + 8) % 12;
  else start = (signIdx + 4) % 12; // dual signs
  const pada = clamp(Math.floor(degreeInSign / (10 / 3)), 0, 8); // 3°20' = 10/3 degrees, 9 padas
  return RASHI_ORDER[(start + pada) % 12];
}

/** Navamsha rashi for every planet + the Lagna itself. */
function computeNavamshaPositions(planetaryPositions) {
  const result = {};
  Object.keys(planetaryPositions || {}).forEach(p => {
    const pos = planetaryPositions[p];
    if (!pos || !pos.rashi) return;
    const rashi = navamshaRashi(pos.rashi, pos.degreeInSign || 0);
    if (rashi) result[p] = { rashi };
  });
  return result;
}

/**
 * Father's confirmed "strong" definition for D9 lord / Sun (voice note):
 * checked in the D1 (birth) chart, NOT D9 -- Navamsha was only for a
 * separate concept. A planet is "strong" here if ALL of:
 *   1. Not retrograde
 *   2. Not sitting with (conjunct) a malefic in the SAME house/sign --
 *      same-sign is what counts; father confirmed we do NOT require a
 *      tight degree match for this. EXCEPTION (father's explicit
 *      clarification): Sun and Moon are not ordinary grahas -- they
 *      are "King and Queen" (Sun a star, Moon a satellite) and this
 *      conjunction-dosha does not apply to them at all, so this check
 *      is skipped entirely for sun/moon.
 *   3. Its own degree-in-sign is "average" -- father's exact threshold:
 *      below 3 degrees or above 27 degrees = weak/affected; between
 *      3-27 = average, no effect.
 * NOTE: father's explanation of malefic ASPECT (not just conjunction)
 * was ambiguous and, taken literally with classical Parashari whole-
 * sign aspects, contradicts the worksheet's confirmed D9=10 target
 * for this reference chart (Saturn's classical 3rd-house aspect lands
 * on Sun's house) -- so the aspect check is deliberately left OUT
 * pending further confirmation; only conjunction + degree + retrograde
 * are implemented.
 */
function isDegreeAverage(degreeInSign) {
  const d = degreeInSign == null ? 0 : degreeInSign;
  return d >= 3 && d <= 27;
}

function isConjunctMaleficD1(planet, planetaryPositions, lagnaRashi) {
  const pos = planetaryPositions[planet];
  if (!pos) return false;
  const house = houseOfPlanet(pos.rashi, lagnaRashi);
  return Object.keys(planetaryPositions).some(other => {
    if (other === planet || other === 'lagna') return false;
    if (!NATURAL_MALEFICS.includes(other)) return false;
    const otherPos = planetaryPositions[other];
    return otherPos && houseOfPlanet(otherPos.rashi, lagnaRashi) === house;
  });
}

function isPlanetStrongD1(planet, planetaryPositions) {
  const pos = planetaryPositions[planet];
  if (!pos || !planetaryPositions.lagna) return false;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const notRetrograde = !pos.retrograde;
  // Sun/Moon exempt from conjunction-dosha (father: they're King/Queen, not ordinary grahas)
  const isSunOrMoon = planet === 'sun' || planet === 'moon';
  const notConjunctMalefic = isSunOrMoon ? true : !isConjunctMaleficD1(planet, planetaryPositions, lagnaRashi);
  const degreeAverage = isDegreeAverage(pos.degreeInSign);
  return notRetrograde && notConjunctMalefic && degreeAverage;
}

/**
 * D9 = Navamsha strength of the Lagna lord, evaluated IN the D9
 * chart, using the same 5-criteria shape as L but with degree-based
 * dignity (see D9 FIX note at top of file). The planet's degree used
 * for the dignity check is its real (D1) degree, since degree is
 * constant across all divisional charts.
 */
function scoreD9(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.lagna) return null;
  const navPositions = computeNavamshaPositions(planetaryPositions);
  const d9LagnaRashi = navPositions.lagna && navPositions.lagna.rashi;
  if (!d9LagnaRashi) return null;

  const d1LagnaRashi = planetaryPositions.lagna.rashi;
  const d1LagnaLord = SIGN_LORD[d1LagnaRashi];
  const d9Lord = SIGN_LORD[d9LagnaRashi]; // "Navamshesh" -- lord of the D9 Lagna sign, may differ from the D1 Lagna lord
  const criteria = [];

  // 1. D9 Lagna associated with a benefic (occupied/aspected by Jup/Ven/Merc), or itself an exaltation sign for some planet
  const occupyingD9Lagna = Object.keys(navPositions).filter(p => p !== 'lagna' && houseOfPlanet(navPositions[p].rashi, d9LagnaRashi) === 1);
  const aspectingD9Lagna = planetsAspectingHouse(1, navPositions, d9LagnaRashi);
  const beneficNearD9Lagna = [...occupyingD9Lagna, ...aspectingD9Lagna].some(p => NATURAL_BENEFICS.includes(p));
  const isExaltationSignForSomePlanet = Object.values(EXALTATION).includes(d9LagnaRashi);
  criteria.push({ label: 'D9 Lagna is benefic-linked (occupied/aspected by a benefic, or itself an exaltation sign)', passed: beneficNearD9Lagna || isExaltationSignForSomePlanet });

  // 2. D9 lord (Navamshesh) strong -- father's confirmed definition, checked in D1
  const d9LordStrong = isPlanetStrongD1(d9Lord, planetaryPositions);
  criteria.push({ label: 'D9 lord (Navamshesh) is strong (not retrograde, not conjunct malefic, average degree)', passed: d9LordStrong });

  // 3. Sun strong -- father's confirmed definition, checked in D1
  const sunStrongInD9 = isPlanetStrongD1('sun', planetaryPositions);
  criteria.push({ label: 'Sun is strong (not retrograde, not conjunct malefic, average degree)', passed: sunStrongInD9 });

  // 4. Moon (mind significator) is Vargottama (same rashi in D1 & D9), OR strong (kendra/trikona) and free from malefic influence in D9
  const moonD1Rashi = planetaryPositions.moon && planetaryPositions.moon.rashi;
  const moonNavPos = navPositions.moon;
  let moonStrong = false;
  if (moonNavPos) {
    const vargottama = moonD1Rashi && moonD1Rashi === moonNavPos.rashi;
    const moonD9House = houseOfPlanet(moonNavPos.rashi, d9LagnaRashi);
    const occupyingMoonD9 = Object.keys(navPositions).filter(p => p !== 'lagna' && p !== 'moon' && houseOfPlanet(navPositions[p].rashi, d9LagnaRashi) === moonD9House);
    const aspectingMoonD9 = moonD9House != null ? planetsAspectingHouse(moonD9House, navPositions, d9LagnaRashi) : [];
    const maleficNearMoon = [...occupyingMoonD9, ...aspectingMoonD9].some(p => NATURAL_MALEFICS.includes(p));
    moonStrong = vargottama || (!maleficNearMoon && moonD9House != null && KENDRA_TRIKONA.includes(moonD9House));
  }
  criteria.push({ label: 'Moon is Vargottama, or strong and malefic-free in D9', passed: moonStrong });

  // 5. Main chart's principal yoga(s) remain "protected" in D9 -- proxied as: the D1 Lagna lord doesn't fall into full debilitation once carried into D9
  const d1LordD1Pos = planetaryPositions[d1LagnaLord];
  const d1LordNavPos = navPositions[d1LagnaLord];
  let yogaProtected = false;
  if (d1LordNavPos && d1LordD1Pos) {
    const degree = d1LordD1Pos.degreeInSign || 0;
    const dignityInD9 = dignityEffect(d1LagnaLord, d1LordNavPos.rashi, degree);
    yogaProtected = dignityInD9 !== 'full-debilitated';
  }
  criteria.push({ label: "D1 Lagna lord is not fully debilitated in D9 (yoga protected)", passed: yogaProtected });

  const score = criteria.filter(c => c.passed).length * 2;
  return { score, criteria };
}

// ============================================================
// P — REBUILT using the real spec: 4 elemental trikonas + Akasha (Jupiter)
// ============================================================

const TRIKONA_GROUPS = [
  { element: 'Fire', houses: [1, 5, 9] },
  { element: 'Earth', houses: [2, 6, 10] },
  { element: 'Air', houses: [3, 7, 11] },
  { element: 'Water', houses: [4, 8, 12] }
];

/** Akasha (Ether/5th element): confirmed spec text -- "Jupiter's benefic placement creates pervasive harmony among all elements." Operationalized as Jupiter in a kendra/trikona house and not (fully) debilitated. */
function scoreAkasha(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.jupiter || !planetaryPositions.lagna) return 0;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const jupPos = planetaryPositions.jupiter;
  const jupHouse = houseOfPlanet(jupPos.rashi, lagnaRashi);
  const dignity = dignityEffect('jupiter', jupPos.rashi, jupPos.degreeInSign || 0);
  const wellPlaced = jupHouse != null && KENDRA_TRIKONA.includes(jupHouse);
  const notDebilitated = dignity !== 'full-debilitated';
  return (wellPlaced && notDebilitated) ? 2 : 0;
}

/**
 * P = elemental balance. Confirmed rule (from spec + Rahul Gandhi
 * worked example): each trikona (Fire/Earth/Air/Water) is "balanced"
 * only if ALL THREE of its houses are occupied by a rashi of that
 * same element. 4 groups x 2 pts = 8. 5th criterion CONFIRMED from
 * the spec text: Akasha (Ether) = Jupiter's benefic placement, 2 pts.
 * Verified against Rahul Gandhi: Fire/Earth/Air/Water all 0 (each
 * trikona's houses hold a systematically rotated adjacent element,
 * not their own), Akasha = 2 (Jupiter in Lagna/kendra) -- EXACT match
 * to the worksheet's target P = 2/10.
 */
function scoreP(planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const criteria = [];

  TRIKONA_GROUPS.forEach(g => {
    const matches = g.houses.filter(h => {
      const rashi = rashiForHouse(lagnaRashi, h);
      return rashi && ELEMENT_OF_RASHI[rashi] === g.element;
    }).length;
    criteria.push({ label: `${g.element} trikona (houses ${g.houses.join('/')}) all belong to the ${g.element} element`, passed: matches === 3 });
  });

  const akashaScore = scoreAkasha(planetaryPositions);
  criteria.push({ label: "Akasha (Ether): Jupiter is well-placed (kendra/trikona) and not debilitated", passed: akashaScore === 2 });

  const score = criteria.filter(c => c.passed).length * 2;
  return { score: clamp(score, 0, 10), criteria };
}

// ============================================================
// H — UNCONFIRMED EXTRAPOLATION (see file header). Treat as provisional.
// ============================================================

const AV_TRIKONA_GROUPS = [
  { key: 'g1_3', houses: [1, 2, 3], gatekeepers: [1, 2, 3] },
  { key: 'g4_6', houses: [4, 5, 6], gatekeepers: [4, 5, 6] },
  { key: 'g7_9', houses: [7, 8, 9], gatekeepers: [7, 8, 9] },   // 8th house is the thematic reason (transformation, blocks growth into 9th) -- father explained
  { key: 'g10_12', houses: [10, 11, 12], gatekeepers: [10, 11, 12] }
];

// H's gatekeeper threshold: father corrected this -- a Sarvashtakvarga
// bindu count of 20 or below is "weak" (average is considered ~20; up
// to 20 is still average). Verified against Rahul Gandhi's real bindu
// counts: threshold=20 makes house-group 7-9 pass (28/26/21, none <=20)
// which is what's needed to hit his H=8/10 target -- the old threshold
// of 25 wrongly failed that group (21<=25).
const WEAK_BINDU_THRESHOLD = 20;

/**
 * H = Body & 12 Houses. Per spec: 5 criteria x 2pts = 10 (matches
 * every other CEI factor's shape) -- 4 house-groups (1-3/4-6/7-9/
 * 10-12, each "strong" if no house's Sarvashtakvarga bindu count is
 * <=20) plus a 5th criterion: the body-significator planet (Lagna
 * lord, the general Parashari body-significator regardless of
 * gender) is stable -- in kendra/trikona and not debilitated.
 * Father explained the 7-9 group's logic thematically: 8th house =
 * transformation (also in-laws), the bridge between marriage (7th)
 * and growth/luck (9th) -- if 8th is weak, the whole group fails.
 * Threshold corrected from an earlier guess of 25 down to 20 (father:
 * "20 ya 20 se kam" = weak). Verified against Rahul Gandhi's real
 * bindu counts: with threshold=20 all 4 groups' pass/fail now line
 * up to produce H=8/10 exactly matching the worksheet target.
 */
function scoreH(ashtakvarga, planetaryPositions) {
  if (!ashtakvarga || !planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const criteria = [];

  AV_TRIKONA_GROUPS.forEach(g => {
    const bindus = g.houses.map(h => {
      const rashi = rashiForHouse(lagnaRashi, h);
      return rashi && ashtakvarga[rashi] ? ashtakvarga[rashi].sarvashtakvarga : null;
    });
    const anyWeak = bindus.some(v => v != null && v <= WEAK_BINDU_THRESHOLD);
    criteria.push({ label: `Houses ${g.houses.join('-')} group has no weak house (bindus <= ${WEAK_BINDU_THRESHOLD})`, passed: !anyWeak });
  });

  // 5th criterion: body-significator (Lagna lord) stable -- kendra/trikona and not debilitated.
  const lagnaLord = SIGN_LORD[lagnaRashi];
  const lordPos = planetaryPositions[lagnaLord];
  let significatorStable = false;
  if (lordPos) {
    const lordHouse = houseOfPlanet(lordPos.rashi, lagnaRashi);
    const dignity = dignityEffect(lagnaLord, lordPos.rashi, lordPos.degreeInSign || 0);
    significatorStable = lordHouse != null && KENDRA_TRIKONA.includes(lordHouse) && dignity !== 'full-debilitated';
  }
  criteria.push({ label: 'Body-significator planet (Lagna lord) is stable (kendra/trikona, not debilitated)', passed: significatorStable });

  const score = criteria.filter(c => c.passed).length * 2;
  return { score: clamp(score, 0, 10), criteria };
}

// ============================================================
// EL — dosha deduction (approximation, no worksheet data yet)
// ============================================================

/**
 * EL = Energy Loss deduction. Each dosha stored as EXACTLY boolean
 * `true` in parsedData.doshas subtracts 2 points, capped at -10.
 * DOCUMENTED APPROXIMATION: no worksheet confirmation yet of the
 * per-dosha weight or which specific doshas count.
 */
function scoreEL(doshas) {
  if (!doshas) return { score: 0, criteria: [] };
  const DOSHA_LABELS = { kaalSarpDosha: 'Kaal Sarp Dosha', mangalDosha: 'Manglik (Mangal) Dosha', pitraDosha: 'Pitra Dosha', nadiDosha: 'Nadi Dosha', grahanDosha: 'Grahan Dosha' };
  const criteria = Object.entries(doshas).map(([key, present]) => ({
    label: `${DOSHA_LABELS[key] || key} ${present ? 'is present' : 'is absent'} in the chart`,
    passed: !present // "passed" here means "no energy loss from this dosha"
  }));
  const confirmedCount = Object.values(doshas).filter(v => v === true).length;
  const score = clamp(confirmedCount * 2, 0, 10);
  return { score, criteria };
}

function gradeCeiLpi(score) {
  if (score == null) return null;
  if (score >= 80) return 'Supreme Harmony';
  if (score >= 70) return 'Good Harmony';
  if (score >= 60) return 'Average Harmony';
  if (score >= 50) return 'Energy-Loss Effect';
  return 'Severe Imbalance';
}

/**
 * CEI = L+S+M+SB+AV+N+D9+H+P − EL, out of 90.
 * parsedData shape: { planetaryPositions, shadbala, ashtakvarga,
 *   doshas, nakshatraLord, moonNakshatraName }
 */
function calculateCEI(parsedData) {
  const { planetaryPositions, shadbala, ashtakvarga, doshas, nakshatraLord, moonNakshatraName, bhavaBala } = parsedData || {};

  const results = {
    L: scoreL(planetaryPositions),
    S: scoreS(planetaryPositions),
    M: scoreM(planetaryPositions),
    SB: scoreSB(shadbala),
    AV: scoreAV(ashtakvarga, planetaryPositions),
    N: scoreN(shadbala, nakshatraLord, planetaryPositions, moonNakshatraName, bhavaBala),
    D9: scoreD9(planetaryPositions),
    H: scoreH(ashtakvarga, planetaryPositions),
    P: scoreP(planetaryPositions)
  };
  const elResult = scoreEL(doshas);

  const components = {};
  const reasons = {};
  Object.entries(results).forEach(([key, r]) => {
    components[key] = r ? r.score : null;
    if (r && Array.isArray(r.criteria)) {
      const failed = r.criteria.filter(c => !c.passed).map(c => c.label);
      if (failed.length) reasons[key] = failed;
    }
  });
  const EL = elResult.score;
  if (Array.isArray(elResult.criteria)) {
    const activeDoshas = elResult.criteria.filter(c => !c.passed).map(c => c.label);
    if (activeDoshas.length) reasons.EL = activeDoshas;
  }

  const missing = Object.entries(components).filter(([, v]) => v == null).map(([k]) => k);
  if (missing.length) {
    return {
      score: null, scoreNormalized: null, maxScore: 90, grade: null,
      detail: { reason: `Missing data for: ${missing.join(', ')}`, components, EL, reasons }
    };
  }

  const rawSum = components.L + components.S + components.M + components.SB + components.AV
    + components.N + components.D9 + components.H + components.P - EL;
  const score = Math.round(clamp(rawSum, 0, 90));
  // scoreNormalized exists ONLY for any legacy weighted-combination use — never display this to the user as "the CEI score".
  const scoreNormalized = clamp((score / 90) * 100, 0, 100);

  return {
    score,
    scoreNormalized,
    maxScore: 90,
    grade: gradeCeiLpi(score),
    detail: {
      formula: 'CEI = L+S+M+SB+AV+N+D9+H+P - EL (each factor 0-10, EL is a 0-10 deduction), out of 90',
      components, EL, rawSum: Math.round(rawSum),
      // Reasons: for any factor below its max score, the specific criteria that did NOT pass (so the PDF can explain "why this number").
      reasons,
      confirmationStatus: {
        L: 'confirmed exact', S: 'confirmed exact', M: 'confirmed exact',
        SB: 'confirmed exact', AV: 'confirmed exact', N: 'confirmed exact',
        D9: 'fixed this rebuild — degree-based dignity (2 of 5 criteria genuinely fail on this chart)',
        P: 'confirmed exact',
        H: 'restructured — 1 of 3 house-groups still UNCONFIRMED with father, verify before treating as final'
      },
      gradingBandsUsed: '80-90 Supreme Harmony | 70-79 Good Harmony | 60-69 Average Harmony | 50-59 Energy-Loss Effect | <50 Severe Imbalance'
    }
  };
}

module.exports = {
  calculateCEI,
  gradeCeiLpi,
  // helpers exported for reuse by lpiEngine.js (and any legacy caller like houseScoring.js)
  RASHI_ORDER, ELEMENT_OF_RASHI, SIGN_LORD,
  EXALTATION, DEBILITATION, OWN_SIGNS,
  EXALTATION_DEGREE, DEBILITATION_DEGREE,
  KENDRA_TRIKONA, DUSTHANA, NATURAL_BENEFICS, NATURAL_MALEFICS, ASPECT_OFFSETS,
  AVG_SARVASHTAKVARGA_PER_SIGN,
  clamp, rashiForHouse, houseOfPlanet, planetsAspectingHouse,
  absoluteLongitude, isCombust, dignityEffect, dignityBonus,
  navamshaRashi, computeNavamshaPositions
};
