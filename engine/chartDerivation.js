/**
 * Chart Derivation
 * ------------------------------------------------------------
 * Converts raw sidereal longitudes (from astronomy.js) into the same
 * shape pdfParser.js produces: { planetaryPositions, nakshatraLord,
 * doshas }. This lets officialScoring.js and houseScoring.js consume
 * either a parsed AstroSage PDF OR a from-scratch calculation without
 * any changes to the scoring code itself.
 */

const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra',
  'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni',
  'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta',
  'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'
];

// Vimshottari dasha lords cycle in a fixed 9-step sequence, repeating
// across the 27 nakshatras (starting from Ashwini = Ketu).
const NAKSHATRA_LORD_CYCLE = ['ketu', 'venus', 'sun', 'moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury'];

function rashiFromLongitude(siderealLong) {
  const idx = Math.floor(siderealLong / 30) % 12;
  return { rashi: RASHI_ORDER[idx], degreeInSign: siderealLong % 30 };
}

function nakshatraFromLongitude(siderealLong) {
  const span = 360 / 27; // 13deg20m
  const idx = Math.floor(siderealLong / span) % 27;
  const withinNakshatra = siderealLong % span;
  const pada = Math.floor(withinNakshatra / (span / 4)) + 1;
  return { nakshatra: NAKSHATRAS[idx], pada, lord: NAKSHATRA_LORD_CYCLE[idx % 9] };
}

function houseOfPlanet(planetRashi, lagnaRashi) {
  const li = RASHI_ORDER.indexOf(lagnaRashi);
  const pi = RASHI_ORDER.indexOf(planetRashi);
  if (li === -1 || pi === -1) return null;
  return ((pi - li + 12) % 12) + 1;
}

/**
 * Mangal Dosha check: Mars placed in houses 1, 4, 7, 8, or 12 counted
 * from a reference point (Lagna or Moon) is classically considered
 * Mangal Dosha from that reference.
 */
function checkMangalDosha(marsRashi, referenceRashi) {
  const house = houseOfPlanet(marsRashi, referenceRashi);
  return house != null && [1, 4, 7, 8, 12].includes(house);
}

/**
 * Kaal Sarp Dosha check: classically present when all seven classical
 * grahas (Sun through Saturn) fall on one side of the Rahu-Ketu axis
 * (i.e., all between Rahu and Ketu going one direction around the
 * zodiac, with none on the other side).
 */
function checkKaalSarpDosha(siderealLongitudes) {
  const rahuLong = siderealLongitudes.rahu;
  const ketuLong = siderealLongitudes.ketu;
  const classicalPlanets = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];

  // Angular position of each planet relative to Rahu, going forward (0-360).
  const relPositions = classicalPlanets.map(p => {
    const diff = ((siderealLongitudes[p] - rahuLong) % 360 + 360) % 360;
    return diff;
  });
  const rahuToKetuSpan = ((ketuLong - rahuLong) % 360 + 360) % 360;

  const allOnOneSide = relPositions.every(d => d <= rahuToKetuSpan)
    || relPositions.every(d => d >= rahuToKetuSpan);

  return allOnOneSide;
}

/**
 * Top-level: converts astronomy.js output into the pdfParser.js-shaped
 * result: { planetaryPositions, nakshatraLord, doshas }.
 */
function deriveChartData(siderealLongitudes, retrograde) {
  const planetaryPositions = {};
  Object.entries(siderealLongitudes).forEach(([planet, long]) => {
    const { rashi, degreeInSign } = rashiFromLongitude(long);
    const nak = nakshatraFromLongitude(long);
    planetaryPositions[planet] = {
      rashi,
      degreeInSign,
      retrograde: !!retrograde[planet],
      nakshatra: nak.nakshatra,
      pada: nak.pada
    };
  });

  const lagnaRashi = planetaryPositions.lagna.rashi;
  const moonRashi = planetaryPositions.moon.rashi;
  const marsRashi = planetaryPositions.mars.rashi;

  const moonNakLord = nakshatraFromLongitude(siderealLongitudes.moon).lord;

  const doshas = {
    mangalDoshaLagnaKundli: checkMangalDosha(marsRashi, lagnaRashi),
    mangalDoshaChandraKundli: checkMangalDosha(marsRashi, moonRashi),
    kaalSarpDosha: checkKaalSarpDosha(siderealLongitudes)
  };

  return {
    planetaryPositions,
    nakshatraLord: moonNakLord,
    doshas
  };
}

module.exports = { deriveChartData, houseOfPlanet, RASHI_ORDER };
