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

/** Which planets aspect a given house (Parashari graha drishti). Works for any {planet: {rashi}} map. */
function planetsAspectingHouse(targetHouse, positions, lagnaRashi) {
  const aspecting = [];
  Object.keys(positions || {}).forEach(p => {
    if (p === 'lagna') return;
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
  let score = 0;

  if (EXALTATION[lord] === lordPos.rashi || (OWN_SIGNS[lord] && OWN_SIGNS[lord].includes(lordPos.rashi))) score += 2;
  if (lordHouse != null && KENDRA_TRIKONA.includes(lordHouse)) score += 2;

  const occupyingLordHouse = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== lord
    && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === lordHouse);
  const aspectingLordHouse = lordHouse != null ? planetsAspectingHouse(lordHouse, planetaryPositions, lagnaRashi) : [];
  const malefics = new Set([...occupyingLordHouse, ...aspectingLordHouse]);
  if (![...malefics].some(p => NATURAL_MALEFICS.includes(p))) score += 2;

  const aspectingLagna = planetsAspectingHouse(1, planetaryPositions, lagnaRashi);
  if (aspectingLagna.some(p => NATURAL_BENEFICS.includes(p))) score += 2;

  const combust = planetaryPositions.sun ? isCombust(lordPos, planetaryPositions.sun) : false;
  if (!combust && DEBILITATION[lord] !== lordPos.rashi) score += 2;

  return score;
}

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

function scoreSB(shadbala) {
  if (!shadbala) return null;
  const planets = Object.values(shadbala);
  if (!planets.length) return null;
  const avg = key => planets.reduce((s, p) => s + (p[key] || 0), 0) / planets.length;

  let score = 0;
  if (avg('totalSthanaBala') >= 90) score += 2;
  if (avg('totalDigBala') >= 30) score += 2;
  if (avg('totalKaalBala') >= 195) score += 2;
  if (avg('totalChestaBala') >= 30) score += 2;
  if (avg('totalNaisargikaBala') >= 30) score += 2;
  return score;
}

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

const DEVA_GANA_NAKSHATRAS = ['Ashwini', 'Mrigashira', 'Punarvasu', 'Pushya', 'Hasta', 'Swati', 'Anuradha', 'Shravana', 'Revati'];
const SHADOW_EXALTATION = { rahu: 'Gemini', ketu: 'Sagittarius' };
const SHADOW_DEBILITATION = { rahu: 'Sagittarius', ketu: 'Gemini' };

function scoreN(shadbala, nakshatraLord, planetaryPositions, moonNakshatraName) {
  if (!nakshatraLord || !planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const lordPos = planetaryPositions[nakshatraLord];
  const isGrahaLord = nakshatraLord !== 'rahu' && nakshatraLord !== 'ketu';
  const lordHouse = lordPos ? houseOfPlanet(lordPos.rashi, lagnaRashi) : null;

  let score = 0;
  if (isGrahaLord) {
    const ratio = shadbala && shadbala[nakshatraLord] && shadbala[nakshatraLord].ratio;
    if (ratio != null && ratio >= 1) score += 2;
  } else if (lordHouse != null && KENDRA_TRIKONA.includes(lordHouse)) {
    score += 2;
  }

  if (lordPos) {
    if (lordHouse != null && KENDRA_TRIKONA.includes(lordHouse)) score += 2;

    const occupying = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== nakshatraLord
      && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === lordHouse);
    const aspecting = lordHouse != null ? planetsAspectingHouse(lordHouse, planetaryPositions, lagnaRashi) : [];
    const malefics = new Set([...occupying, ...aspecting]);
    if (![...malefics].some(p => NATURAL_MALEFICS.includes(p))) score += 2;
  }

  if (moonNakshatraName && DEVA_GANA_NAKSHATRAS.includes(moonNakshatraName)) score += 2;

  if (lordPos) {
    if (isGrahaLord) {
      if (EXALTATION[nakshatraLord] === lordPos.rashi || (OWN_SIGNS[nakshatraLord] || []).includes(lordPos.rashi)) score += 2;
    } else {
      if (SHADOW_EXALTATION[nakshatraLord] === lordPos.rashi) score += 2;
    }
  }

  return score;
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
  let score = 0;

  // 1. D9 Lagna associated with a benefic (occupied/aspected by Jup/Ven/Merc), or itself an exaltation sign for some planet
  const occupyingD9Lagna = Object.keys(navPositions).filter(p => p !== 'lagna' && houseOfPlanet(navPositions[p].rashi, d9LagnaRashi) === 1);
  const aspectingD9Lagna = planetsAspectingHouse(1, navPositions, d9LagnaRashi);
  const beneficNearD9Lagna = [...occupyingD9Lagna, ...aspectingD9Lagna].some(p => NATURAL_BENEFICS.includes(p));
  const isExaltationSignForSomePlanet = Object.values(EXALTATION).includes(d9LagnaRashi);
  if (beneficNearD9Lagna || isExaltationSignForSomePlanet) score += 2;

  // 2. D9 lord (Navamshesh) strong: exalted/own-sign (degree-checked, using its real/D1 degree) or in kendra/trikona of D9
  const d9LordNavPos = navPositions[d9Lord];
  if (d9LordNavPos) {
    const d9LordD1Pos = planetaryPositions[d9Lord];
    const d9LordDegree = d9LordD1Pos ? (d9LordD1Pos.degreeInSign || 0) : 0;
    const dignity = dignityEffect(d9Lord, d9LordNavPos.rashi, d9LordDegree);
    const d9LordHouseInD9 = houseOfPlanet(d9LordNavPos.rashi, d9LagnaRashi);
    if (dignity === 'full-exalted' || dignity === 'own' || (d9LordHouseInD9 != null && KENDRA_TRIKONA.includes(d9LordHouseInD9))) score += 2;
  }

  // 3. Sun (Atmakaraka proxy) in D9 is in own/exalted sign
  const sunNavPos = navPositions.sun;
  if (sunNavPos) {
    const sunD1Pos = planetaryPositions.sun;
    const sunDegree = sunD1Pos ? (sunD1Pos.degreeInSign || 0) : 0;
    const dignity = dignityEffect('sun', sunNavPos.rashi, sunDegree);
    if (dignity === 'full-exalted' || dignity === 'own') score += 2;
  }

  // 4. Moon (mind significator) is Vargottama (same rashi in D1 & D9), OR strong (kendra/trikona) and free from malefic influence in D9
  const moonD1Rashi = planetaryPositions.moon && planetaryPositions.moon.rashi;
  const moonNavPos = navPositions.moon;
  if (moonNavPos) {
    const vargottama = moonD1Rashi && moonD1Rashi === moonNavPos.rashi;
    const moonD9House = houseOfPlanet(moonNavPos.rashi, d9LagnaRashi);
    const occupyingMoonD9 = Object.keys(navPositions).filter(p => p !== 'lagna' && p !== 'moon' && houseOfPlanet(navPositions[p].rashi, d9LagnaRashi) === moonD9House);
    const aspectingMoonD9 = moonD9House != null ? planetsAspectingHouse(moonD9House, navPositions, d9LagnaRashi) : [];
    const maleficNearMoon = [...occupyingMoonD9, ...aspectingMoonD9].some(p => NATURAL_MALEFICS.includes(p));
    if (vargottama || (!maleficNearMoon && moonD9House != null && KENDRA_TRIKONA.includes(moonD9House))) score += 2;
  }

  // 5. Main chart's principal yoga(s) remain "protected" in D9 -- proxied as: the D1 Lagna lord doesn't fall into full debilitation once carried into D9
  const d1LordD1Pos = planetaryPositions[d1LagnaLord];
  const d1LordNavPos = navPositions[d1LagnaLord];
  if (d1LordNavPos && d1LordD1Pos) {
    const degree = d1LordD1Pos.degreeInSign || 0;
    const dignityInD9 = dignityEffect(d1LagnaLord, d1LordNavPos.rashi, degree);
    if (dignityInD9 !== 'full-debilitated') score += 2;
  }

  return clamp(score, 0, 10);
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
  let score = 0;

  TRIKONA_GROUPS.forEach(g => {
    const matches = g.houses.filter(h => {
      const rashi = rashiForHouse(lagnaRashi, h);
      return rashi && ELEMENT_OF_RASHI[rashi] === g.element;
    }).length;
    if (matches === 3) score += 2;
  });

  score += scoreAkasha(planetaryPositions);

  return clamp(score, 0, 10);
}

// ============================================================
// H — UNCONFIRMED EXTRAPOLATION (see file header). Treat as provisional.
// ============================================================

const AV_TRIKONA_GROUPS = [
  { key: 'g1_3', houses: [1, 2, 3], gatekeepers: [2, 3] },   // UNCONFIRMED
  { key: 'g4_6', houses: [4, 5, 6], gatekeepers: [5, 6] },   // UNCONFIRMED
  { key: 'g7_9', houses: [7, 8, 9], gatekeepers: [8, 9] },   // CONFIRMED by father
  { key: 'g10_12', houses: [10, 11, 12], gatekeepers: [11, 12] } // UNCONFIRMED
];

function scoreH(ashtakvarga, planetaryPositions) {
  if (!ashtakvarga || !planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  let score = 0;

  AV_TRIKONA_GROUPS.forEach(g => {
    const gatekeeperBindus = g.gatekeepers.map(h => {
      const rashi = rashiForHouse(lagnaRashi, h);
      return rashi && ashtakvarga[rashi] ? ashtakvarga[rashi].sarvashtakvarga : null;
    });
    const gatekeeperFails = gatekeeperBindus.some(v => v != null && v < AVG_SARVASHTAKVARGA_PER_SIGN);
    if (!gatekeeperFails) score += 2.5; // 4 groups x 2.5 = 10
  });

  return clamp(score, 0, 10);
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
  if (!doshas) return 0;
  const confirmedCount = Object.values(doshas).filter(v => v === true).length;
  return clamp(confirmedCount * 2, 0, 10);
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
  const { planetaryPositions, shadbala, ashtakvarga, doshas, nakshatraLord, moonNakshatraName } = parsedData || {};

  const L = scoreL(planetaryPositions);
  const S = scoreS(planetaryPositions);
  const M = scoreM(planetaryPositions);
  const SB = scoreSB(shadbala);
  const AV = scoreAV(ashtakvarga, planetaryPositions);
  const N = scoreN(shadbala, nakshatraLord, planetaryPositions, moonNakshatraName);
  const D9 = scoreD9(planetaryPositions);
  const H = scoreH(ashtakvarga, planetaryPositions);
  const P = scoreP(planetaryPositions);
  const EL = scoreEL(doshas);

  const components = { L, S, M, SB, AV, N, D9, H, P };
  const missing = Object.entries(components).filter(([, v]) => v == null).map(([k]) => k);
  if (missing.length) {
    return {
      score: null, scoreNormalized: null, maxScore: 90, grade: null,
      detail: { reason: `Missing data for: ${missing.join(', ')}`, components, EL }
    };
  }

  const rawSum = L + S + M + SB + AV + N + D9 + H + P - EL;
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
      confirmationStatus: {
        L: 'confirmed exact', S: 'confirmed exact', M: 'confirmed exact',
        SB: 'confirmed exact', AV: 'confirmed exact', N: 'confirmed exact',
        D9: 'fixed this rebuild — degree-based dignity',
        P: 'fixed this rebuild — element trikona matching (5th criterion still unconfirmed)',
        H: 'UNCONFIRMED — extrapolated gatekeeper-house rule, verify with father'
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
