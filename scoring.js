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
 * This replaces the earlier placeholder (which returned fixed
 * numbers like 87-100 regardless of input) and then the earlier
 * Bhava-Bala-only approximation, with the actual documented formula
 * from the spec PDFs. See officialScoring.js and houseScoring.js for
 * full derivations, formulas, and documented approximations.
 *
 * Falls back to null-safe defaults if a kundali was entered
 * manually (no PDF data) rather than uploaded, so the old
 * manual-entry flow keeps working.
 */

const { calculateCEI: calculateCEIOfficial, calculateLPI: calculateLPIOfficial } = require('./officialScoring');
const { calculateAllHouseScores, HOUSE_CONFIGS, rashiForHouse } = require('./houseScoring');

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

  const { scores: houseScores, details: houseDetails } = calculateAllHouseScores(parsedData, cei.score, lpi.score);

  return {
    scores: {
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

module.exports = {
  calculateAllScoresFromPdf,
  HOUSE_NAMES,
  rashiForHouse
};
