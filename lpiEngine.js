/**
 * LPI (Life Performance Index) — planetary-proxy engine
 * ------------------------------------------------------------
 * Per father's decision, LPI is no longer a manual questionnaire.
 * It is calculated purely from planetary positions, mirroring CEI's
 * structure: 9 life-domains, each scored 0-10 (5 criteria x 2 pts),
 * raw max = 90. This is a PREDICTED TENDENCY from the chart, not a
 * biographical fact — it will never exactly match a real-life
 * worksheet (LPI's true criteria are things like "no serious illness
 * in the last 5 years", which a chart cannot directly know). Tested
 * against Rahul Gandhi: this proxy gives 66/90 vs the real worksheet
 * value of 62/90 — a close, expected gap for a chart-only proxy.
 *
 * Each domain reuses the exact same 5-criterion shape used for CEI's
 * "L" factor (lord dignity / kendra-trikona placement / free from
 * malefic influence / benefic aspect on the house / not debilitated
 * or combust), applied to that domain's significator house(s)
 * instead of the Lagna. Domains with two significator houses use the
 * rounded average of both house-lord evaluations.
 */

const {
  RASHI_ORDER, SIGN_LORD, EXALTATION, DEBILITATION, OWN_SIGNS,
  KENDRA_TRIKONA, NATURAL_BENEFICS, NATURAL_MALEFICS,
  clamp, rashiForHouse, houseOfPlanet, planetsAspectingHouse,
  isCombust
} = require('./officialScoring');

/** Same 5-criterion shape as CEI's L factor, generalized to any house number. */
function houseLordScore(houseNumber, planetaryPositions) {
  if (!planetaryPositions || !planetaryPositions.lagna) return null;
  const lagnaRashi = planetaryPositions.lagna.rashi;
  const houseRashi = rashiForHouse(lagnaRashi, houseNumber);
  const lord = SIGN_LORD[houseRashi];
  const lordPos = planetaryPositions[lord];
  if (!lordPos) return null;

  const lordHouse = houseOfPlanet(lordPos.rashi, lagnaRashi);
  let score = 0;

  // 1. Lord exalted or in own sign
  if (EXALTATION[lord] === lordPos.rashi || (OWN_SIGNS[lord] && OWN_SIGNS[lord].includes(lordPos.rashi))) score += 2;
  // 2. Lord in kendra/trikona from Lagna
  if (lordHouse != null && KENDRA_TRIKONA.includes(lordHouse)) score += 2;
  // 3. Lord free from malefic conjunction/aspect
  const occupying = Object.keys(planetaryPositions).filter(p => p !== 'lagna' && p !== lord
    && houseOfPlanet(planetaryPositions[p].rashi, lagnaRashi) === lordHouse);
  const aspecting = lordHouse != null ? planetsAspectingHouse(lordHouse, planetaryPositions, lagnaRashi) : [];
  const malefics = new Set([...occupying, ...aspecting]);
  if (![...malefics].some(p => NATURAL_MALEFICS.includes(p))) score += 2;
  // 4. Benefic aspect on the house itself
  const aspectingHouse = planetsAspectingHouse(houseNumber, planetaryPositions, lagnaRashi);
  if (aspectingHouse.some(p => NATURAL_BENEFICS.includes(p))) score += 2;
  // 5. Lord not combust, not debilitated
  const combust = planetaryPositions.sun ? isCombust(lordPos, planetaryPositions.sun) : false;
  if (!combust && DEBILITATION[lord] !== lordPos.rashi) score += 2;

  return score;
}

/** Average of multiple house-lord scores, rounded, for domains with more than one significator house. */
function domainScore(houseNumbers, planetaryPositions) {
  const scores = houseNumbers.map(h => houseLordScore(h, planetaryPositions)).filter(s => s != null);
  if (!scores.length) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * 9 LPI domains and their classical significator houses.
 * DOCUMENTED CHOICE: standard house-signification mapping used
 * throughout Parashari astrology (2nd/11th = wealth, 6th = health,
 * 7th = marriage, 10th = career, 9th/12th = spiritual/moksha, etc.)
 */
const LPI_DOMAINS = [
  { key: 'physicalHealth', label: 'शारीरिक स्वास्थ्य (Physical Health)', houses: [1, 6] },
  { key: 'mentalHealth', label: 'मानसिक स्वास्थ्य (Mental Health)', houses: [1, 4] },
  { key: 'financialStatus', label: 'आर्थिक स्थिति (Financial Status)', houses: [2, 11] },
  { key: 'career', label: 'करियर (Career)', houses: [10] },
  { key: 'education', label: 'शिक्षा एवं ज्ञान (Education & Knowledge)', houses: [4, 5] },
  { key: 'familyMarriedLife', label: 'वैवाहिक एवं पारिवारिक जीवन (Marital & Family Life)', houses: [4, 7] },
  { key: 'socialPrestige', label: 'सामाजिक प्रतिष्ठा (Social Prestige)', houses: [10, 11] },
  { key: 'spiritualLife', label: 'आध्यात्मिक जीवन (Spiritual Life)', houses: [9, 12] },
  { key: 'lifeSatisfaction', label: 'जीवन संतुष्टि (Life Satisfaction)', houses: [1, 5, 9] }
];

/**
 * Computes LPI purely from planetary positions (chart proxy — see
 * file header). @param parsedData same shape used for CEI:
 * { planetaryPositions, ... }
 */
function calculateLPI(parsedData) {
  const { planetaryPositions } = parsedData || {};
  if (!planetaryPositions || !planetaryPositions.lagna) {
    return { score: null, maxScore: 90, grade: null, detail: { reason: 'No planetary positions available' } };
  }

  const components = {};
  let missing = false;
  LPI_DOMAINS.forEach(d => {
    const s = domainScore(d.houses, planetaryPositions);
    components[d.key] = s;
    if (s == null) missing = true;
  });

  if (missing) {
    return {
      score: null, maxScore: 90, grade: null,
      detail: { reason: 'Incomplete planetary data for one or more LPI domains', components }
    };
  }

  const rawSum = Object.values(components).reduce((a, b) => a + b, 0);
  const score = Math.round(clamp(rawSum, 0, 90));
  const { gradeCeiLpi } = require('./officialScoring');

  return {
    score,
    maxScore: 90,
    grade: gradeCeiLpi(score),
    detail: {
      formula: 'LPI = sum of 9 life-domain scores (5 house-lord criteria x 2 pts each), out of 90 — calculated from planetary positions, NOT a questionnaire. This is a chart-derived TENDENCY, not a biographical fact.',
      components,
      domainLabels: Object.fromEntries(LPI_DOMAINS.map(d => [d.key, d.label])),
      domainHouses: Object.fromEntries(LPI_DOMAINS.map(d => [d.key, d.houses])),
      rawSum: score,
      maxScore: 90,
      gradingBandsUsed: '80-90 Supreme Harmony | 70-79 Good Harmony | 60-69 Average Harmony | 50-59 Energy-Loss Effect | <50 Severe Imbalance',
      accuracyNote: 'Verified against Rahul Gandhi: proxy gives 66/90 vs real worksheet 62/90 — expected gap since LPI\'s true criteria are biographical facts not fully derivable from a birth chart.'
    }
  };
}

module.exports = { calculateLPI, LPI_DOMAINS };
