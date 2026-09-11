/**
 * Kundali Scoring Engine — CEI + LPI only
 * ------------------------------------------------------------
 * SCOPE: the 12 house scores (HPS/WPS/etc.) are removed. This file
 * computes CEI and LPI, BOTH now derived purely from planetary
 * positions — no questionnaire. (LPI's old 45-question form has been
 * fully removed per father's decision; see lpiEngine.js.)
 *
 * CEI and LPI are graded on the shared comparative grading matrix,
 * raw score out of 90, bands 80-90/70-79/60-69/50-59/<50.
 */

const { calculateCEI: calculateCEIOfficial } = require('./officialScoring');
const { calculateLPI } = require('./lpiEngine');
const { calculateFromManualPositions } = require('./engine/manualChartEngine');
const { calculateBirthChart } = require('./engine/birthChartEngine');

/**
 * Computes CEI and LPI, both from real chart data (positions ->
 * Shadbala/Ashtakvarga/doshas/nakshatra for CEI; positions -> house-
 * lord strength for LPI — all computed internally).
 * @param {object} parsedData - chart data shape from manualChartEngine/birthChartEngine
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

/** Real planetary positions typed in directly (ground truth, no astronomy calc). */
function calculateAllScoresFromManualPositions(manualPositions) {
  const chartData = calculateFromManualPositions(manualPositions);
  const result = calculateCeiAndLpi(chartData);
  result.scoringDetails.source = 'manual-position-entry';
  result.scoringDetails.calculationNotes = chartData.calculationNotes;
  return result;
}

/** Birth date/time/location -> calculated positions (lower precision than manual entry). */
function calculateAllScoresFromBirthDetails(birthDetails) {
  const chartData = calculateBirthChart(birthDetails);
  const result = calculateCeiAndLpi(chartData);
  result.scoringDetails.source = 'calculated';
  result.scoringDetails.calculationNotes = chartData.calculationNotes;
  return result;
}

module.exports = {
  calculateAllScoresFromManualPositions,
  calculateAllScoresFromBirthDetails
};
