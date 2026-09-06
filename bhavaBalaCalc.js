/**
 * Bhava Bala Calculator
 * ------------------------------------------------------------
 * Computes house (Bhava) strength for all 12 houses, per BPHS:
 *  - Bhavadhipati Bala: the house lord's own Shadbala contributes to
 *    its house's strength.
 *  - Bhava Dig Bala: houses 1/10 (kendra to angles) get directional
 *    bonus, tapering for other houses (simplified from planet-based
 *    Dig Bala logic, applied at the house level).
 *  - Bhava Drishti Bala: net benefic/malefic aspect strength landing
 *    on that house.
 *  Output shape matches pdfParser.js's BHAVA_ROW_ORDER keys.
 */

const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const SIGN_LORD = {
  Aries: 'mars', Taurus: 'venus', Gemini: 'mercury', Cancer: 'moon',
  Leo: 'sun', Virgo: 'mercury', Libra: 'venus', Scorpio: 'mars',
  Sagittarius: 'jupiter', Capricorn: 'saturn', Aquarius: 'saturn', Pisces: 'jupiter'
};
const ASPECT_OFFSETS = { mars: [4, 7, 8], jupiter: [5, 7, 9], saturn: [3, 7, 10], default: [7] };
const BENEFICS = ['jupiter', 'venus', 'mercury', 'moon'];

function rashiForHouse(lagnaRashi, houseNumber) {
  const idx = RASHI_ORDER.indexOf(lagnaRashi);
  return RASHI_ORDER[(idx + houseNumber - 1) % 12];
}
function houseOfPlanet(planetRashi, lagnaRashi) {
  const li = RASHI_ORDER.indexOf(lagnaRashi);
  const pi = RASHI_ORDER.indexOf(planetRashi);
  if (li === -1 || pi === -1) return null;
  return ((pi - li + 12) % 12) + 1;
}

function calculateBhavaBala(planetaryPositions, shadbala, lagnaRashi) {
  const bhavaBala = {};

  for (let house = 1; house <= 12; house++) {
    const houseRashi = rashiForHouse(lagnaRashi, house);
    const lord = SIGN_LORD[houseRashi];

    // Bhavadhipati Bala: house lord's total Shadbala, scaled to a 0-60ish range.
    const lordShadbala = shadbala[lord];
    const bhavadhipatiBala = lordShadbala ? Math.min(60, lordShadbala.totalShadbala / 10) : 0;

    // Bhava Dig Bala: angles (1,4,7,10) get full strength, others taper.
    const kendraDistance = Math.min(
      Math.abs(house - 1), Math.abs(house - 4), Math.abs(house - 7), Math.abs(house - 10),
      12 - Math.abs(house - 1), 12 - Math.abs(house - 4), 12 - Math.abs(house - 7), 12 - Math.abs(house - 10)
    );
    const bhavaDigBala = 60 * (1 - kendraDistance / 6);

    // Bhava Drishti Bala: net aspect strength on this house from all 7 planets.
    let drishti = 0;
    Object.keys(shadbala).forEach(planet => {
      const planetHouse = houseOfPlanet(planetaryPositions[planet].rashi, lagnaRashi);
      const offsets = ASPECT_OFFSETS[planet] || ASPECT_OFFSETS.default;
      const distance = ((house - planetHouse + 12) % 12) + 1;
      if (offsets.includes(distance)) {
        drishti += BENEFICS.includes(planet) ? 10 : -10;
      }
    });
    const bhavaDrishtiBala = Math.max(0, 30 + drishti); // normalized floor at 0

    const totalBhavaBala = bhavadhipatiBala + bhavaDigBala + bhavaDrishtiBala;
    const totalBhavaBalaRupas = totalBhavaBala / 60 * 15; // scaled so ~15 rupas = strong (matches officialScoring.js's /15 normalization)

    bhavaBala[house] = {
      bhavadhipatiBala, bhavaDigBala, bhavaDrishtiBala,
      totalBhavaBala, totalBhavaBalaRupas, relativeRank: null
    };
  }

  const ranked = Object.keys(bhavaBala).sort((a, b) => bhavaBala[b].totalBhavaBalaRupas - bhavaBala[a].totalBhavaBalaRupas);
  ranked.forEach((h, i) => { bhavaBala[h].relativeRank = i + 1; });

  return bhavaBala;
}

module.exports = { calculateBhavaBala };
