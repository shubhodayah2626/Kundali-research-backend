/**
 * Kundali Scoring Engine — CEI + LPI only
 * ------------------------------------------------------------
 * SCOPE: the 12 house scores (HPS/WPS/etc.) are removed.
 *
 * Planetary positions, Shadbala, Ashtakvarga, and Bhava Bala now
 * come from AstrologyAPI.com (see apiChartEngine.js) instead of
 * manual position entry + local approximation calculators. Your
 * father's actual CEI/LPI/D9/H/P scoring rules (officialScoring.js,
 * lpiEngine.js) are UNCHANGED -- only the underlying raw data is now
 * API-verified instead of hand-approximated.
 *
 * CEI and LPI are graded on the shared comparative grading matrix,
 * raw score out of 90, bands 80-90/70-79/60-69/50-59/<50.
 */

/**
 * Kundali Scoring Engine — CEI (chart-derived) + LPI (manual questionnaire)
 * ------------------------------------------------------------
 * SCOPE: the 12 house scores (HPS/WPS/etc.) are removed.
 *
 * IMPORTANT WORKFLOW CHANGE: CEI and LPI are no longer computed at
 * the same time. CEI comes purely from the birth chart (via
 * AstrologyAPI.com through apiChartEngine.js) and is available the
 * instant the person's birth details are entered. LPI, per father's
 * explicit direction, cannot be derived from a chart -- it requires
 * the researcher to actually ask the person (or someone who knows
 * them) a set of real-life questions and record their answers. So
 * LPI is filled in SEPARATELY, any time after the Kundali record is
 * created, via the questionnaire (see lpiEngine.js's LPI_DOMAINS).
 *
 * CEI and LPI are graded on the shared comparative grading matrix,
 * raw score out of 90, bands 80-90/70-79/60-69/50-59/<50.
 */

const { calculateCEI: calculateCEIOfficial, gradeCeiLpi } = require('./officialScoring');
const { calculateLPI, LPI_DOMAINS } = require('./lpiEngine');
const { calculateFromBirthDetails } = require('./engine/apiChartEngine');

/**
 * @param {object} birthDetails - { day, month, year, hour, min, lat, lon, tzone }
 * Computes ONLY the CEI (chart-derived). LPI is left null -- filled
 * in later via the questionnaire once the researcher has the person's
 * real-life answers.
 */
async function calculateCeiFromBirthDetails(birthDetails) {
  const chartData = await calculateFromBirthDetails(birthDetails);
  const cei = calculateCEIOfficial(chartData);

  return {
    scores: { cei: cei.score, lpi: null },
    scoringDetails: {
      lagnaRashi: chartData.planetaryPositions && chartData.planetaryPositions.lagna
        ? chartData.planetaryPositions.lagna.rashi : null,
      cei: cei.detail,
      lpi: null,
      ceiGrade: cei.grade,
      lpiGrade: null,
      ceiMaxScore: cei.maxScore,
      lpiMaxScore: 90,
      source: chartData.source,
      calculationNotes: chartData.calculationNotes
    }
  };
}

/**
 * Computes LPI from the researcher's questionnaire answers.
 * @param {Object} manualScores - { [domainKey]: { [criterionKey]: 0 | 2 } }
 */
function calculateLpiFromAnswers(manualScores) {
  const lpi = calculateLPI(manualScores);
  return { score: lpi.score, grade: lpi.grade, maxScore: lpi.maxScore, detail: lpi.detail };
}

module.exports = {
  calculateCeiFromBirthDetails,
  calculateLpiFromAnswers,
  LPI_DOMAINS,
  gradeCeiLpi
};
