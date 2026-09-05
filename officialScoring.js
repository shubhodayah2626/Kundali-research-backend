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
 *   - The final closing section of the CEI PDF states results are
 *     reported "out of a maximum of 90" then compared against bands
 *     that top out at "90-100" — so we normalize raw/90 -> /100 for
 *     the reported score, consistent with how both PDFs present the
 *     final score bands identically for CEI and LPI.
 *   - EL (Energy Loss) is a 0-10 deduction from CEI's raw total,
 *     based on doshas present (each confirmed dosha reduces the
 *     score) — applied to the raw (pre-normalization) total.
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

// ---- CEI's 9 factors (each 0-10) ----

/** L = Lagna strength: Bhava Bala of house 1, scaled to 0-10. */
function scoreL(bhavaBala) {
  const rupas = bhavaBala && bhavaBala[1] && bhavaBala[1].totalBhavaBalaRupas;
  if (rupas == null) return null;
  return clamp((rupas / 15) * 10, 0, 10);
}

/** S = Surya (Sun/vitality): Sun's Shadbala ratio + dignity bonus. */
function scoreS(shadbala, planetaryPositions) {
  const ratio = shadbala && shadbala.sun && shadbala.sun.ratio;
  const base = ratioToTen(ratio);
  if (base == null) return null;
  const bonus = dignityBonus('sun', planetaryPositions && planetaryPositions.sun && planetaryPositions.sun.rashi);
  return clamp(base + bonus, 0, 10);
}

/** M = Chandra (Moon/mind): Moon's Shadbala ratio + dignity bonus. */
function scoreM(shadbala, planetaryPositions) {
  const ratio = shadbala && shadbala.moon && shadbala.moon.ratio;
  const base = ratioToTen(ratio);
  if (base == null) return null;
  const bonus = dignityBonus('moon', planetaryPositions && planetaryPositions.moon && planetaryPositions.moon.rashi);
  return clamp(base + bonus, 0, 10);
}

/** SB = overall Shadbala: average ratio across all 7 classical grahas. */
function scoreSB(shadbala) {
  if (!shadbala) return null;
  const ratios = Object.values(shadbala).map(p => p.ratio).filter(r => r != null);
  if (!ratios.length) return null;
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return ratioToTen(avg);
}

/** AV = Ashtakvarga: Sarvashtakvarga bindus of the Lagna sign vs. the fixed 28.08 average. */
function scoreAV(ashtakvarga, lagnaRashi) {
  if (!ashtakvarga || !lagnaRashi || !ashtakvarga[lagnaRashi]) return null;
  const sarva = ashtakvarga[lagnaRashi].sarvashtakvarga;
  return clamp(5 + (sarva - AVG_SARVASHTAKVARGA_PER_SIGN) * 0.35, 0, 10);
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

/**
 * D9 = Navamsha. The full Navamsha (D9) divisional chart isn't parsed
 * yet (would need the Shodashvarga table, a separate extraction task).
 * As a documented placeholder, this uses the Lagna Lord's own dignity
 * in the main (D1) chart as a rough proxy for long-term life quality,
 * since D9 strength and D1 lord dignity are related in classical
 * theory (though not the same thing). Flagged in scoringDetails.
 */
function scoreD9(planetaryPositions, lagnaRashi) {
  if (!lagnaRashi || !planetaryPositions) return { score: null, isPlaceholder: true };
  const lagnaLordMap = { Aries: 'mars', Taurus: 'venus', Gemini: 'mercury', Cancer: 'moon', Leo: 'sun', Virgo: 'mercury', Libra: 'venus', Scorpio: 'mars', Sagittarius: 'jupiter', Capricorn: 'saturn', Aquarius: 'saturn', Pisces: 'jupiter' };
  const lord = lagnaLordMap[lagnaRashi];
  const lordPos = planetaryPositions[lord];
  if (!lordPos) return { score: null, isPlaceholder: true };
  const bonus = dignityBonus(lord, lordPos.rashi);
  // Map -2..+2 dignity bonus onto a 3..9 base range (5 = neutral)
  return { score: clamp(5 + bonus * 2, 0, 10), isPlaceholder: true, lagnaLord: lord, lagnaLordRashi: lordPos.rashi };
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

/** Computes CEI per the official 9-factor + EL formula. */
function calculateCEI(parsedData) {
  const { shadbala, bhavaBala, ashtakvarga, planetaryPositions, doshas, nakshatraLord } = parsedData;
  const lagnaRashi = planetaryPositions && planetaryPositions.lagna ? planetaryPositions.lagna.rashi : null;

  const L = scoreL(bhavaBala);
  const S = scoreS(shadbala, planetaryPositions);
  const M = scoreM(shadbala, planetaryPositions);
  const SB = scoreSB(shadbala);
  const AV = scoreAV(ashtakvarga, lagnaRashi);
  const N = scoreN(shadbala, nakshatraLord);
  const D9result = scoreD9(planetaryPositions, lagnaRashi);
  const D9 = D9result.score;
  const H = scoreH(bhavaBala);
  const P = scoreP(planetaryPositions, shadbala);
  const EL = scoreEL(doshas);

  const components = { L, S, M, SB, AV, N, D9, H, P };
  const validComponents = Object.values(components).filter(v => v != null);
  if (validComponents.length < 9) {
    return {
      score: null,
      detail: { reason: 'Incomplete data for one or more CEI factors', components, EL }
    };
  }

  const rawSum = validComponents.reduce((a, b) => a + b, 0); // max 90
  const rawAfterLoss = clamp(rawSum - EL, 0, 90);
  const normalizedScore = Math.round((rawAfterLoss / 90) * 100);

  return {
    score: clamp(normalizedScore, 0, 100),
    detail: {
      formula: 'CEI = L + S + M + SB + AV + N + D9 + H + P - EL, normalized from /90 to /100',
      components: {
        L: round1(L), S: round1(S), M: round1(M), SB: round1(SB), AV: round1(AV),
        N: round1(N), D9: round1(D9), H: round1(H), P: round1(P)
      },
      D9_isPlaceholder: D9result.isPlaceholder,
      D9_note: D9result.isPlaceholder
        ? 'Navamsha (D9) chart not yet parsed from PDF — using Lagna Lord dignity in D1 as a rough proxy. Wire in real D9 data from the Shodashvarga table for full accuracy.'
        : undefined,
      EL,
      rawSum: round1(rawSum),
      rawAfterLoss: round1(rawAfterLoss),
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

function calculateLPI(parsedData, ceiComponents) {
  const { bhavaBala, shadbala } = parsedData;

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
    return { score: null, detail: { reason: 'Incomplete Bhava Bala data for one or more LPI domains', components } };
  }

  const rawSum = validComponents.reduce((a, b) => a + b, 0); // max 90
  const normalizedScore = Math.round((rawSum / 90) * 100);

  return {
    score: clamp(normalizedScore, 0, 100),
    detail: {
      formula: 'LPI = sum of 9 life-domain scores (Physical Health, Mental Health, Financial Status, Career, Education, Family/Married Life, Social Prestige, Spiritual Life, Life Satisfaction), normalized from /90 to /100',
      components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, round1(v)])),
      houseMappingUsed: {
        physicalHealth: 'Houses 1, 6', mentalHealth: 'House 4', financialStatus: 'Houses 2, 11',
        career: 'House 10', education: 'Houses 4, 5, 9', familyMarriedLife: 'Houses 2, 4, 7',
        socialPrestige: 'Houses 10, 11', spiritualLife: 'Houses 9, 12', lifeSatisfaction: 'All 12 houses averaged'
      },
      rawSum: round1(rawSum)
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
