/**
 * Official 12-House Scoring Engine (HPS, WPS, CPS-3rd, SuPS, PPS, SVPS,
 * MPS, TPS, FPS, CPS-10th, GPS, SLPS)
 * ------------------------------------------------------------
 * Implements the formula structure given in Shubhodayah's 12 individual
 * house-score specification PDFs (same legacy-font mojibake issue as
 * the CEI/LPI and AstroSage PDFs). The digit cipher used throughout
 * those PDFs was decoded from internally-consistent evidence (e.g.
 * "˞nd House" / "˟rd House" self-labeling, and the grading bands
 * "ˤ5-100", "ˣ˜-ˤˠ.˥" etc. all resolving consistently to one mapping):
 *
 *   ˜=0  ˝=1  ˞=2  ˟=3  ˠ=4  ˡ=5  ˢ=6  ˣ=7  ˤ=8  ˥=9
 *
 * With that cipher, all 12 specs turned out to share an IDENTICAL
 * master formula and grading scale:
 *
 *   Score = (CEI × 0.30) + (LPI × 0.20) + (House Score × 0.25)
 *           + (Lord Score × 0.15) + (Yoga Score × 0.10)
 *
 *   Grading: 85-100 Exceptional | 70-84.9 Strong | 55-69.9 Moderate
 *            | 40-54.9 Vulnerable | <40 Critical
 *
 * House Score (100 = 5x20): Rashi Bala, Graha Sthiti, Shubh/Ashubh
 * Drishti (aspects received), Bhava Bala, Varga & Shadbala.
 *
 * Lord Score (100 = 5x20): Dignity, House Placement, Aspects
 * Received, Conjunctions, Shadbala & Varga.
 *
 * Yoga Score (100 = 5x20): the ONLY part that differs house-to-house
 * — each spec names 2-3 specific house-to-house "connections", 2-3
 * specific named planets whose benefic influence is checked, and a
 * final composite "named classical yogas" criterion. This is captured
 * per-house in HOUSE_CONFIGS below, and evaluated by one shared engine
 * (connection / benefic-influence / composite functions), rather than
 * 12 separate hand-written formulas.
 *
 * What is a DOCUMENTED APPROXIMATION (flagged in scoringDetails):
 *  - "Rashi Bala" for the house score uses a simplified benefic/
 *    malefic-lordship heuristic, not the full classical Shadbala
 *    Rashi Bala calculation (odd/even, uccha of sign-lord, etc.)
 *  - Aspects (drishti) use the standard Parashari rule set (all
 *    planets aspect the 7th; Mars also 4th/8th; Jupiter also 5th/9th;
 *    Saturn also 3rd/10th; Rahu/Ketu treated as 7th-only, since their
 *    extra-aspect convention is not universally agreed).
 *  - The 5th Yoga criterion ("named classical yoga combinations" e.g.
 *    Gaja-Kesari, specific Dhana/Raja Yoga combinations) is NOT a full
 *    yoga-detection engine — it's approximated as a composite of the
 *    House Score + Lord Score, since enumerating every classical yoga
 *    by name would require a dedicated rules database well beyond the
 *    data currently parsed from the AstroSage PDF.
 *
 * All of this is designed to be swapped out incrementally: each
 * building-block function below is independent, so (for example)
 * plugging in real Divisional-chart (Varga) data later only requires
 * changing vargaShadbalaHouseScore / shadbalaVargaLordScore.
 */

const {
  EXALTATION, DEBILITATION, OWN_SIGNS
} = require('./officialScoring');

const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const SIGN_LORD = {
  Aries: 'mars', Taurus: 'venus', Gemini: 'mercury', Cancer: 'moon',
  Leo: 'sun', Virgo: 'mercury', Libra: 'venus', Scorpio: 'mars',
  Sagittarius: 'jupiter', Capricorn: 'saturn', Aquarius: 'saturn', Pisces: 'jupiter'
};

const PLANET_KEYS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'rahu', 'ketu'];
const BENEFICS = ['jupiter', 'venus', 'mercury', 'moon'];

// Parashari aspect rules: distance counted inclusively (7 = opposite sign).
const ASPECT_OFFSETS = {
  mars: [4, 7, 8],
  jupiter: [5, 7, 9],
  saturn: [3, 7, 10],
  default: [7]
};

const AVG_SARVASHTAKVARGA_PER_SIGN = 337 / 12;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }

function rashiForHouse(lagnaRashi, houseNumber) {
  const idx = RASHI_ORDER.indexOf(lagnaRashi);
  if (idx === -1) return null;
  return RASHI_ORDER[(idx + houseNumber - 1) % 12];
}

function houseOfPlanet(planetRashi, lagnaRashi) {
  const li = RASHI_ORDER.indexOf(lagnaRashi);
  const pi = RASHI_ORDER.indexOf(planetRashi);
  if (li === -1 || pi === -1) return null;
  return ((pi - li + 12) % 12) + 1;
}

function getAspectOffsets(planet) {
  return ASPECT_OFFSETS[planet] || ASPECT_OFFSETS.default;
}

/** Which planets occupy vs. aspect a given house, by whole-sign houses. */
function planetsAffectingHouse(targetHouse, planetaryPositions, lagnaRashi) {
  const occupying = [];
  const aspecting = [];
  PLANET_KEYS.forEach(p => {
    const pos = planetaryPositions && planetaryPositions[p];
    if (!pos || !pos.rashi) return;
    const ph = houseOfPlanet(pos.rashi, lagnaRashi);
    if (ph == null) return;
    if (ph === targetHouse) occupying.push(p);
    const distance = ((targetHouse - ph + 12) % 12) + 1;
    if (getAspectOffsets(p).includes(distance)) aspecting.push(p);
  });
  return { occupying, aspecting };
}

// ---- House Score sub-criteria (each 0-20) ----

/** Simplified Rashi Bala proxy: benefic-lorded signs score higher than malefic-lorded ones. */
function rashiBalaScore(houseRashi) {
  if (!houseRashi) return null;
  const lord = SIGN_LORD[houseRashi];
  if (lord === 'jupiter' || lord === 'venus') return 16;
  if (lord === 'mercury' || lord === 'moon') return 13;
  if (lord === 'sun' || lord === 'mars') return 9;
  if (lord === 'saturn') return 7;
  return 10;
}

function grahaSthitiScore(occupying) {
  let score = 10;
  occupying.forEach(p => { score += BENEFICS.includes(p) ? 2.5 : -2.5; });
  return clamp(score, 0, 20);
}

function aspectsReceivedScore(aspecting) {
  let score = 10;
  aspecting.forEach(p => { score += BENEFICS.includes(p) ? 2 : -2; });
  return clamp(score, 0, 20);
}

function bhavaBalaScore(bhavaBala, houseNumber) {
  const rupas = bhavaBala && bhavaBala[houseNumber] && bhavaBala[houseNumber].totalBhavaBalaRupas;
  if (rupas == null) return null;
  return clamp((rupas / 15) * 20, 0, 20);
}

function vargaShadbalaHouseScore(ashtakvarga, houseRashi, shadbala, occupying) {
  let avPart = 5;
  if (ashtakvarga && houseRashi && ashtakvarga[houseRashi]) {
    const sarva = ashtakvarga[houseRashi].sarvashtakvarga;
    if (sarva != null) avPart = clamp(5 + (sarva - AVG_SARVASHTAKVARGA_PER_SIGN) * 0.35, 0, 10);
  }
  let sbPart = 5;
  if (shadbala && occupying.length) {
    const ratios = occupying.map(p => shadbala[p] && shadbala[p].ratio).filter(r => r != null);
    if (ratios.length) {
      const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      sbPart = clamp(avg * 5, 0, 10);
    }
  }
  return clamp(avPart + sbPart, 0, 20);
}

// ---- Lord Score sub-criteria (each 0-20) ----

function dignityScore(lord, lordRashi) {
  if (!lordRashi) return null;
  if (EXALTATION[lord] === lordRashi) return 20;
  if (DEBILITATION[lord] === lordRashi) return 4;
  if (OWN_SIGNS[lord] && OWN_SIGNS[lord].includes(lordRashi)) return 16;
  return 10;
}

function housePlacementScore(lordHouseNum) {
  if (lordHouseNum == null) return null;
  if ([1, 4, 5, 7, 9, 10].includes(lordHouseNum)) return 18; // kendra/trikona
  if ([2, 3, 11].includes(lordHouseNum)) return 12;
  if ([6, 8, 12].includes(lordHouseNum)) return 6; // dusthana
  return 10;
}

function conjunctionScore(occupyingAtLordHouse, lordPlanetKey) {
  const others = occupyingAtLordHouse.filter(p => p !== lordPlanetKey);
  let score = 10;
  others.forEach(p => { score += BENEFICS.includes(p) ? 3 : -3; });
  return clamp(score, 0, 20);
}

function shadbalaVargaLordScore(lord, shadbala, ashtakvarga, lordRashi) {
  let sbPart = 5;
  const ratio = shadbala && shadbala[lord] && shadbala[lord].ratio;
  if (ratio != null) sbPart = clamp(ratio * 5, 0, 10);
  let avPart = 5;
  const bindus = ashtakvarga && lordRashi && ashtakvarga[lordRashi] && ashtakvarga[lordRashi][lord];
  if (bindus != null) avPart = clamp((bindus / 4) * 10, 0, 10); // ~4 bindus/sign is the rough per-planet average
  return clamp(sbPart + avPart, 0, 20);
}

// ---- Yoga Score sub-criteria (each 0-20) ----

/**
 * Relationship between two houses' lords: parivartana (mutual sign
 * exchange) and conjunction score highest; mutual aspect next; a
 * one-way aspect scores moderately; otherwise a low baseline.
 */
function connectionScore(houseA, houseB, planetaryPositions, lagnaRashi) {
  const rashiA = rashiForHouse(lagnaRashi, houseA);
  const rashiB = rashiForHouse(lagnaRashi, houseB);
  const lordA = rashiA && SIGN_LORD[rashiA];
  const lordB = rashiB && SIGN_LORD[rashiB];
  const posA = lordA && planetaryPositions && planetaryPositions[lordA];
  const posB = lordB && planetaryPositions && planetaryPositions[lordB];
  if (!posA || !posB) return null;
  const lordAHouse = houseOfPlanet(posA.rashi, lagnaRashi);
  const lordBHouse = houseOfPlanet(posB.rashi, lagnaRashi);
  if (lordAHouse == null || lordBHouse == null) return null;

  if (lordAHouse === houseB && lordBHouse === houseA) return 20; // parivartana
  if (lordAHouse === lordBHouse) return 18; // conjunction

  const aAspectsB = getAspectOffsets(lordA).includes(((lordBHouse - lordAHouse + 12) % 12) + 1);
  const bAspectsA = getAspectOffsets(lordB).includes(((lordAHouse - lordBHouse + 12) % 12) + 1);
  if (aAspectsB && bAspectsA) return 16;
  if (aAspectsB || bAspectsA) return 12;
  return 7;
}

/** Checks whether the specific named planets occupy or aspect the target house. */
function namedPlanetInfluenceScore(houseNumber, namedPlanets, planetaryPositions, lagnaRashi) {
  const { occupying, aspecting } = planetsAffectingHouse(houseNumber, planetaryPositions, lagnaRashi);
  const hits = namedPlanets.filter(p => occupying.includes(p) || aspecting.includes(p));
  return clamp(8 + hits.length * 4, 0, 20);
}

/** Documented approximation for "named classical yoga combinations" — see file header. */
function classicalYogaProxy(houseScoreTotal, lordScoreTotal) {
  if (houseScoreTotal == null || lordScoreTotal == null) return 10;
  return clamp(((houseScoreTotal + lordScoreTotal) / 200) * 20, 0, 20);
}

function evaluateYogaCriterion(criterion, houseNumber, planetaryPositions, lagnaRashi, houseScoreTotal, lordScoreTotal) {
  if (criterion.type === 'connection') {
    return connectionScore(houseNumber, criterion.pair, planetaryPositions, lagnaRashi);
  }
  if (criterion.type === 'benefic') {
    return namedPlanetInfluenceScore(houseNumber, criterion.planets, planetaryPositions, lagnaRashi);
  }
  return classicalYogaProxy(houseScoreTotal, lordScoreTotal); // 'composite'
}

function gradeLabel(score) {
  if (score == null) return null;
  if (score >= 85) return 'Exceptional';
  if (score >= 70) return 'Strong';
  if (score >= 55) return 'Moderate';
  if (score >= 40) return 'Vulnerable';
  return 'Critical';
}

/**
 * Per-house config: exactly what differs between the 12 specs.
 * yogaCriteria: 5 entries reproducing each spec's own Yoga table,
 * in the order given in the PDF (connections first, then named-
 * planet benefic influence, then the final composite criterion).
 */
const HOUSE_CONFIGS = {
  1: {
    key: 'hps', label: 'Health Potential Score (HPS)',
    yogaCriteria: [
      { type: 'connection', pair: 6 }, { type: 'connection', pair: 8 }, { type: 'connection', pair: 12 },
      { type: 'benefic', planets: ['sun', 'moon', 'jupiter'] }, { type: 'composite' }
    ]
  },
  2: {
    key: 'wps', label: 'Wealth Potential Score (WPS)',
    yogaCriteria: [
      { type: 'connection', pair: 11 }, { type: 'connection', pair: 5 }, { type: 'connection', pair: 9 },
      { type: 'benefic', planets: ['jupiter', 'venus'] }, { type: 'composite' }
    ]
  },
  3: {
    key: 'courage', label: 'Courage Potential Score (CPS)',
    yogaCriteria: [
      { type: 'connection', pair: 1 }, { type: 'connection', pair: 6 }, { type: 'connection', pair: 10 },
      { type: 'benefic', planets: ['mars', 'mercury'] }, { type: 'composite' }
    ]
  },
  4: {
    key: 'sups', label: 'Happiness Potential Score (SuPS)',
    yogaCriteria: [
      { type: 'connection', pair: 9 }, { type: 'connection', pair: 11 }, { type: 'connection', pair: 1 },
      { type: 'benefic', planets: ['moon', 'venus'] }, { type: 'composite' }
    ]
  },
  5: {
    key: 'pps', label: 'Pancham Potential Score (PPS)',
    yogaCriteria: [
      { type: 'connection', pair: 1 }, { type: 'connection', pair: 9 }, { type: 'connection', pair: 10 },
      { type: 'benefic', planets: ['jupiter', 'mercury'] }, { type: 'composite' }
    ]
  },
  6: {
    key: 'svps', label: 'Service & Victory Potential Score (SVPS)',
    yogaCriteria: [
      { type: 'connection', pair: 1 }, { type: 'connection', pair: 10 }, { type: 'connection', pair: 11 },
      { type: 'benefic', planets: ['mars', 'saturn', 'mercury'] }, { type: 'composite' }
    ]
  },
  7: {
    key: 'mps', label: 'Marriage Potential Score (MPS)',
    yogaCriteria: [
      { type: 'benefic', planets: ['venus', 'jupiter'] }, { type: 'connection', pair: 2 }, { type: 'connection', pair: 5 },
      { type: 'composite' }, { type: 'composite' }
    ]
  },
  8: {
    key: 'tps', label: 'Transformation Potential Score (TPS)',
    yogaCriteria: [
      { type: 'connection', pair: 1 }, { type: 'connection', pair: 5 }, { type: 'connection', pair: 9 },
      { type: 'benefic', planets: ['saturn', 'ketu', 'mars'] }, { type: 'composite' }
    ]
  },
  9: {
    key: 'fps', label: 'Fortune Potential Score (FPS)',
    yogaCriteria: [
      { type: 'connection', pair: 1 }, { type: 'connection', pair: 5 }, { type: 'connection', pair: 10 },
      { type: 'benefic', planets: ['jupiter', 'sun'] }, { type: 'composite' }
    ]
  },
  10: {
    key: 'cps', label: 'Career Potential Score (CPS)',
    yogaCriteria: [
      { type: 'connection', pair: 6 }, { type: 'connection', pair: 11 }, { type: 'connection', pair: 9 },
      { type: 'benefic', planets: ['saturn', 'mercury', 'sun'] }, { type: 'composite' }
    ]
  },
  11: {
    key: 'gps', label: 'Gain Potential Score (GPS)',
    yogaCriteria: [
      { type: 'connection', pair: 2 }, { type: 'connection', pair: 10 }, { type: 'connection', pair: 5 },
      { type: 'benefic', planets: ['jupiter', 'mercury'] }, { type: 'composite' }
    ]
  },
  12: {
    key: 'slps', label: 'Spiritual & Liberation Potential Score (SLPS)',
    yogaCriteria: [
      { type: 'connection', pair: 1 }, { type: 'connection', pair: 9 }, { type: 'connection', pair: 8 },
      { type: 'benefic', planets: ['jupiter', 'ketu', 'venus'] }, { type: 'composite' }
    ]
  }
};

/** Averages the available (non-null) sub-scores and rescales to /100, requiring at least 3 of 5. */
function combineSubScores(subs) {
  const available = subs.filter(v => v != null);
  if (available.length < 3) return null;
  return clamp(available.reduce((a, b) => a + b, 0) * (100 / (20 * available.length)), 0, 100);
}

/** Computes one house's full House/Lord/Yoga breakdown and final weighted score. */
function computeHouseSystemScore(houseNumber, parsedData, ceiScore, lpiScore) {
  const config = HOUSE_CONFIGS[houseNumber];
  const { planetaryPositions, ashtakvarga, shadbala, bhavaBala } = parsedData;
  const lagnaRashi = planetaryPositions && planetaryPositions.lagna && planetaryPositions.lagna.rashi;
  if (!lagnaRashi) return { score: null, detail: { reason: 'Lagna rashi not available from parsed PDF' } };

  const houseRashi = rashiForHouse(lagnaRashi, houseNumber);
  const { occupying, aspecting } = planetsAffectingHouse(houseNumber, planetaryPositions, lagnaRashi);

  // House Score
  const rashiBala = rashiBalaScore(houseRashi);
  const grahaSthiti = grahaSthitiScore(occupying);
  const aspectsReceivedHouse = aspectsReceivedScore(aspecting);
  const bhavaBalaSub = bhavaBalaScore(bhavaBala, houseNumber);
  const vargaShadbalaHouse = vargaShadbalaHouseScore(ashtakvarga, houseRashi, shadbala, occupying);
  const houseScoreTotal = combineSubScores([rashiBala, grahaSthiti, aspectsReceivedHouse, bhavaBalaSub, vargaShadbalaHouse]);

  // Lord Score
  const lord = SIGN_LORD[houseRashi];
  const lordPos = planetaryPositions[lord];
  const lordRashi = lordPos && lordPos.rashi;
  const lordHouseNum = lordRashi ? houseOfPlanet(lordRashi, lagnaRashi) : null;
  const dignity = dignityScore(lord, lordRashi);
  const placement = housePlacementScore(lordHouseNum);
  const lordAffecting = lordHouseNum != null ? planetsAffectingHouse(lordHouseNum, planetaryPositions, lagnaRashi) : { occupying: [], aspecting: [] };
  const aspectsReceivedLord = aspectsReceivedScore(lordAffecting.aspecting);
  const conjunction = conjunctionScore(lordAffecting.occupying, lord);
  const shadbalaVargaLord = shadbalaVargaLordScore(lord, shadbala, ashtakvarga, lordRashi);
  const lordScoreTotal = combineSubScores([dignity, placement, aspectsReceivedLord, conjunction, shadbalaVargaLord]);

  // Yoga Score (5 criteria, always fully populated with sensible defaults)
  const yogaSubScores = config.yogaCriteria.map(c =>
    evaluateYogaCriterion(c, houseNumber, planetaryPositions, lagnaRashi, houseScoreTotal, lordScoreTotal) ?? 10
  );
  const yogaScoreTotal = clamp(yogaSubScores.reduce((a, b) => a + b, 0), 0, 100);

  if (ceiScore == null || lpiScore == null || houseScoreTotal == null || lordScoreTotal == null) {
    return {
      score: null,
      detail: {
        reason: 'Incomplete data for one or more weighted components',
        houseScoreTotal: round1(houseScoreTotal), lordScoreTotal: round1(lordScoreTotal),
        yogaScoreTotal: round1(yogaScoreTotal), ceiScore, lpiScore
      }
    };
  }

  const master = clamp(
    0.30 * ceiScore + 0.20 * lpiScore + 0.25 * houseScoreTotal + 0.15 * lordScoreTotal + 0.10 * yogaScoreTotal,
    0, 100
  );

  return {
    score: Math.round(master),
    detail: {
      formula: `${config.label} = (CEI x 0.30) + (LPI x 0.20) + (House Score x 0.25) + (Lord Score x 0.15) + (Yoga Score x 0.10)`,
      houseRashi, lordPlanet: lord, lordRashi, lordHouseNumber: lordHouseNum,
      houseScore: {
        total: round1(houseScoreTotal),
        rashiBala: round1(rashiBala), grahaSthiti: round1(grahaSthiti),
        aspectsReceived: round1(aspectsReceivedHouse), bhavaBala: round1(bhavaBalaSub),
        vargaShadbala: round1(vargaShadbalaHouse)
      },
      lordScore: {
        total: round1(lordScoreTotal),
        dignity: round1(dignity), housePlacement: round1(placement),
        aspectsReceived: round1(aspectsReceivedLord), conjunctions: round1(conjunction),
        shadbalaVarga: round1(shadbalaVargaLord)
      },
      yogaScore: {
        total: round1(yogaScoreTotal),
        criteria: config.yogaCriteria.map((c, i) => ({
          type: c.type, pair: c.pair, planets: c.planets, score: round1(yogaSubScores[i])
        }))
      },
      weightedInputs: { cei: ceiScore, lpi: lpiScore, houseScoreTotal: round1(houseScoreTotal), lordScoreTotal: round1(lordScoreTotal), yogaScoreTotal: round1(yogaScoreTotal) },
      grade: gradeLabel(master),
      approximationNotes: [
        'Rashi Bala uses a simplified benefic/malefic sign-lordship heuristic, not full classical Shadbala Rashi Bala.',
        'Aspects use standard Parashari rules (7th for all; Mars +4th/8th; Jupiter +5th/9th; Saturn +3rd/10th; Rahu/Ketu 7th-only).',
        'The final Yoga criterion (named classical yoga combinations) is approximated as a composite of House Score + Lord Score rather than detecting each named yoga individually.'
      ]
    }
  };
}

/** Computes all 12 house-based scores given parsed PDF data and already-computed CEI/LPI. */
function calculateAllHouseScores(parsedData, ceiScore, lpiScore) {
  const scores = {};
  const details = {};
  for (let h = 1; h <= 12; h++) {
    const { key } = HOUSE_CONFIGS[h];
    const result = computeHouseSystemScore(h, parsedData, ceiScore, lpiScore);
    scores[key] = result.score;
    details[key] = result.detail;
  }
  return { scores, details };
}

module.exports = {
  calculateAllHouseScores,
  computeHouseSystemScore,
  HOUSE_CONFIGS,
  SIGN_LORD,
  rashiForHouse,
  houseOfPlanet,
  planetsAffectingHouse,
  connectionScore,
  gradeLabel
};
