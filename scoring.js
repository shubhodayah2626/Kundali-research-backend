/**
 * Real Kundali Scoring Engine
 * ------------------------------------------------------------
 * CEI and LPI are computed by officialScoring.js per Shubhodayah's
 * own CEI/LPI specification. The 12 individual house scores (HPS,
 * WPS, CPS-3rd, SuPS, PPS, SVPS, MPS, TPS, FPS, CPS-10th, GPS, SLPS)
 * are now computed by houseScoring.js per Shubhodayah's own 12
 * individual house-score specification PDFs -- each house's House
 * Score / Lord Score / Yoga Score, combined with CEI and LPI using
 * that spec's official weights (0.30 / 0.20 / 0.25 / 0.15 / 0.10).
 *
 * *** FIX ***
 * CEI and LPI are graded on their OWN spec, confirmed directly from
 * the CEI/LPI comparative grading matrix: raw score out of 90,
 * bands 80-90/70-79/60-69/50-59/<50. They are NOT out of 100, and
 * must NOT be displayed or graded as if they were. officialScoring.js
 * now returns both:
 *   - cei.score / lpi.score           -> raw, out of 90 (for display,
 *                                        storage, and CEI/LPI's own
 *                                        grading — this is what
 *                                        `scores.cei` / `scores.lpi`
 *                                        below use)
 *   - cei.scoreNormalized / lpi.scoreNormalized -> rescaled to /100,
 *                                        used ONLY here, as an input
 *                                        to the house-score weighted
 *                                        formula (which combines CEI/
 *                                        LPI with the House/Lord/Yoga
 *                                        sub-scores that ARE genuinely
 *                                        out of 100). This normalized
 *                                        value must never be shown to
 *                                        the user as "the CEI score".
 * An earlier version of this file (and of officialScoring.js) treated
 * the /100-normalized value as the only value, which is why the CEI/
 * LPI shown on the site (and therefore every house score, since they
 * inherit CEI/LPI as weighted inputs) came out inflated toward 90-100
 * instead of reflecting the true 0-90 spread.
 *
 * Falls back to null-safe defaults if a kundali was entered
 * manually (no PDF data) rather than uploaded, so the old
 * manual-entry flow keeps working.
 */

const { calculateCEI: calculateCEIOfficial, calculateLPI: calculateLPIOfficial } = require('./officialScoring');
const { calculateAllHouseScores, HOUSE_CONFIGS, rashiForHouse } = require('./houseScoring');
const { calculateBirthChart } = require('./engine/birthChartEngine');

// Back-compat: HOUSE_NAMES was exported by the old version of this file
// (server.js or other callers may still import it). Rebuilt from the
// new HOUSE_CONFIGS so the {key, label} shape stays identical.
const HOUSE_NAMES = Object.fromEntries(
  Object.entries(HOUSE_CONFIGS).map(([h, cfg]) => [h, { key: cfg.key, label: cfg.label }])
);

/**
 * Computes all 14 scores from parsed PDF data.
 * parsedData: { planetaryPositions, ashtakvarga, shadbala, bhavaBala, doshas, nakshatraLord }
 */
function calculateAllScoresFromPdf(parsedData) {
  const cei = calculateCEIOfficial(parsedData);
  const lpi = calculateLPIOfficial(parsedData);

  // IMPORTANT: pass the NORMALIZED (/100) values into the house
  // formula, not the raw (/90) ones — the house weighted formula
  // (0.30*CEI + 0.20*LPI + 0.25*House + 0.15*Lord + 0.10*Yoga) needs
  // all five inputs on the same 0-100 scale to weight fairly.
  const { scores: houseScores, details: houseDetails } = calculateAllHouseScores(
    parsedData,
    cei.scoreNormalized,
    lpi.scoreNormalized
  );

  return {
    scores: {
      // Raw /90 values — these are what get displayed/stored/graded
      // as "CEI" and "LPI" themselves.
      cei: cei.score,
      lpi: lpi.score,
      hps: houseScores.hps,
      wps: houseScores.wps,
      courage: houseScores.courage,
      sups: houseScores.sups,
      pps: houseScores.pps,
      svps: houseScores.svps,
      mps: houseScores.mps,
      tps: houseScores.tps,
      fps: houseScores.fps,
      cps: houseScores.cps,
      gps: houseScores.gps,
      slps: houseScores.slps
    },
    scoringDetails: {
      source: 'pdf-upload',
      lagnaRashi: parsedData.planetaryPositions && parsedData.planetaryPositions.lagna
        ? parsedData.planetaryPositions.lagna.rashi : null,
      cei: cei.detail,
      lpi: lpi.detail,
      // Grades for CEI/LPI, per their own 90-point grading matrix
      // (NOT the 12-house 100-point grading matrix).
      ceiGrade: cei.grade,
      lpiGrade: lpi.grade,
      ceiMaxScore: cei.maxScore,
      lpiMaxScore: lpi.maxScore,
      hps: houseDetails.hps,
      wps: houseDetails.wps,
      courage: houseDetails.courage,
      sups: houseDetails.sups,
      pps: houseDetails.pps,
      svps: houseDetails.svps,
      mps: houseDetails.mps,
      tps: houseDetails.tps,
      fps: houseDetails.fps,
      cps: houseDetails.cps,
      gps: houseDetails.gps,
      slps: houseDetails.slps
    }
  };
}

/**
 * Computes all 14 scores directly from birth date/time/location, with
 * NO PDF upload required -- the real calculation engine (engine/
 * birthChartEngine.js) computes planetary positions, Shadbala,
 * Ashtakvarga, and Bhava Bala from scratch. Since the calculated
 * chart matches parseKundaliPdfText()'s exact output shape, this
 * simply feeds it through the same calculateAllScoresFromPdf logic.
 */
function calculateAllScoresFromBirthDetails(birthDetails) {
  const chartData = calculateBirthChart(birthDetails);
  const result = calculateAllScoresFromPdf(chartData);
  result.scoringDetails.source = 'calculated';
  result.scoringDetails.calculationNotes = chartData.calculationNotes;
  return result;
}

module.exports = {
  calculateAllScoresFromPdf,
  calculateAllScoresFromBirthDetails,
  HOUSE_NAMES,
  rashiForHouse
};
