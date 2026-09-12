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

const { calculateCEI: calculateCEIOfficial } = require('./officialScoring');
const { calculateLPI } = require('./lpiEngine');
const { calculateFromBirthDetails } = require('./engine/apiChartEngine');

/**
 * Computes CEI and LPI from real chart data supplied by
 * apiChartEngine.js (positions, Shadbala, Ashtakvarga, Bhava Bala,
 * doshas, nakshatra all API-derived).
 */
function calculateCeiAndLpi(parsedData) {
  const cei = calculateCEIOfficial(parsedData);
  const lpi = calculateLPI(parsedData);

  return {
    scores: { cei: cei.score, lpi: lpi.score },
    scoringDetails: {
      lagnaRashi: parsedData.planetaryPositions && parsedData.planetaryPositions.lagna
        ? parsedData.planetaryPositions.lagna.rashi : null,
      cei: cei.detail,
      lpi: lpi.detail,
      ceiGrade: cei.grade,
      lpiGrade: lpi.grade,
      ceiMaxScore: cei.maxScore,
      lpiMaxScore: lpi.maxScore
    }
  };
}

/**
 * @param {object} birthDetails - { day, month, year, hour, min, lat, lon, tzone }
 *   Note: lat/lon/tzone must be resolved from the place name before
 *   calling this (see apiChartEngine.js header notes -- geocoding
 *   is not yet wired in; the form currently needs raw coordinates
 *   or a geocoding step needs to be added next).
 */
async function calculateAllScoresFromBirthDetails(birthDetails) {
  const chartData = await calculateFromBirthDetails(birthDetails);
  const result = calculateCeiAndLpi(chartData);
  result.scoringDetails.source = chartData.source;
  result.scoringDetails.calculationNotes = chartData.calculationNotes;
  return result;
}

module.exports = {
  calculateAllScoresFromBirthDetails
};
