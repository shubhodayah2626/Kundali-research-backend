/**
 * Birth Chart Engine (orchestrator)
 * ------------------------------------------------------------
 * The single entry point for the "Calculate from Birth Details" mode.
 * Ties together astronomy.js -> chartDerivation.js -> shadbalaCalc.js
 * -> ashtakvargaCalc.js -> bhavaBalaCalc.js, producing EXACTLY the
 * same output shape as pdfParser.js's parseKundaliPdfText():
 *
 *   { planetaryPositions, ashtakvarga, shadbala, bhavaBala, doshas,
 *     nakshatraLord, parseWarnings }
 *
 * This means officialScoring.js, houseScoring.js, and scoring.js need
 * ZERO changes to accept this as an alternative input source -- they
 * already only care about this shape, not where it came from.
 */

const { computeSiderealPositions } = require('./astronomy');
const { deriveChartData } = require('./chartDerivation');
const { calculateShadbala } = require('./shadbalaCalc');
const { calculateAshtakvarga } = require('./ashtakvargaCalc');
const { calculateBhavaBala } = require('./bhavaBalaCalc');

/**
 * @param {object} birthDetails
 * @param {number} birthDetails.year
 * @param {number} birthDetails.month - 1-12
 * @param {number} birthDetails.day
 * @param {number} birthDetails.hour - 0-23, LOCAL time
 * @param {number} birthDetails.minute - 0-59
 * @param {number} birthDetails.utcOffsetHours - e.g. 5.5 for India
 * @param {number} birthDetails.latitude - +N
 * @param {number} birthDetails.longitude - +E
 */
function calculateBirthChart(birthDetails) {
  const { year, month, day, hour, minute, utcOffsetHours, latitude, longitude } = birthDetails;

  const localDecimalHours = hour + minute / 60;
  const utHours = localDecimalHours - utcOffsetHours;

  // utHours can go negative or >24 if the UTC offset pushes across a day
  // boundary; toJulianDay handles fractional/out-of-range hours fine since
  // it's just added as a fraction of a day, but we normalize day/month/year
  // isn't re-derived here -- acceptable for this level of precision since
  // it only shifts sub-degree amounts in planetary longitude.

  const { siderealLongitudes, retrograde } = computeSiderealPositions({
    year, month, day, utHours, latDeg: latitude, lonDeg: longitude
  });

  const { planetaryPositions, nakshatraLord, doshas } = deriveChartData(siderealLongitudes, retrograde);
  const lagnaRashi = planetaryPositions.lagna.rashi;

  // Day/night birth: Sun above horizon = houses 7-12 from Lagna (simplified: use Sun's house from Lagna).
  const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
  const { houseOfPlanet } = require('./chartDerivation');
  const sunHouse = houseOfPlanet(planetaryPositions.sun.rashi, lagnaRashi);
  const isDayBirth = sunHouse >= 7 && sunHouse <= 12;

  const sunLong = RASHI_ORDER.indexOf(planetaryPositions.sun.rashi) * 30 + planetaryPositions.sun.degreeInSign;
  const moonLong = RASHI_ORDER.indexOf(planetaryPositions.moon.rashi) * 30 + planetaryPositions.moon.degreeInSign;
  const moonSunAngularDist = ((moonLong - sunLong) % 360 + 360) % 360;

  const shadbala = calculateShadbala(planetaryPositions, lagnaRashi, isDayBirth, moonSunAngularDist);
  const ashtakvarga = calculateAshtakvarga(planetaryPositions, lagnaRashi);
  const bhavaBala = calculateBhavaBala(planetaryPositions, shadbala, lagnaRashi);

  return {
    planetaryPositions,
    ashtakvarga,
    shadbala,
    bhavaBala,
    doshas,
    nakshatraLord,
    parseWarnings: [], // calculated data is always "complete" by construction
    source: 'calculated', // distinguishes from 'pdf-upload' in scoringDetails
    calculationNotes: [
      'Planetary positions calculated using low-precision analytical formulas (Sun/Moon accurate to a few arcminutes; Mercury-Saturn via Keplerian two-body approximation). Nutation and full precession are not modeled.',
      'Shadbala: Saptavargaja Bala and Drekkana Bala are approximated (full 7-varga and drekkana dignity tables not yet computed). Abda/Masa/Vara/Hora Bala use flat proxy values (full Vedic calendar lord calculation not yet implemented). Yuddha Bala (planetary war) is not computed.',
      'Ashtakvarga: uses standard classical Parashari contribution tables; recommend cross-verification against a canonical reference for published research use.',
      'Bhava Bala: derived from computed Shadbala and house positions using a simplified formula, not the full classical multi-factor Bhava Bala derivation.'
    ]
  };
}

module.exports = { calculateBirthChart };
