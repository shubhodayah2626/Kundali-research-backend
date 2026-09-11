/**
 * Manual Chart Engine
 * ------------------------------------------------------------
 * Alternative to birthChartEngine.js: instead of calculating
 * planetary positions astronomically (which can carry a few
 * arcminutes of error from the simplified formulas), this takes
 * REAL planetary positions typed in directly by the user -- read
 * straight off an AstroSage (or similar) chart -- and runs them
 * through the exact same Shadbala / Ashtakvarga / Bhava Bala /
 * dosha / nakshatra pipeline as birthChartEngine.js.
 *
 * This is the most accurate option available when the user has
 * access to a verified real chart but not the raw AstroSage PDF
 * file itself (or when pdfParser.js can't read it) -- it removes
 * ALL astronomical approximation error, since the positions
 * themselves are ground truth, not calculated.
 *
 * Input shape: one entry per planet (sun, moon, mars, mercury,
 * jupiter, venus, saturn, rahu, ketu, lagna), each as
 * { rashi: 'Libra', degreeInSign: 1.89 }. Retrograde is optional
 * per planet (defaults: rahu/ketu always true, sun/moon always
 * false, others false unless specified -- matching the fact that
 * AstroSage charts typically mark retrograde planets with an [R]).
 *
 * *** FIX *** manualChartEngine previously returned `nakshatraLord`
 * (the Moon's nakshatra LORD PLANET, e.g. "mars") but never
 * `moonNakshatraName` (the Moon's nakshatra NAME, e.g. "Mula") --
 * officialScoring.js's scoreN() needs BOTH: nakshatraLord for 4 of
 * its 5 criteria, and moonNakshatraName specifically for the
 * "नक्षत्र शुभ प्रकृति का" (nakshatra of benefic nature) criterion.
 * Without moonNakshatraName, that criterion could never score,
 * silently losing 2 of N's 10 points on every single chart. Fixed
 * below by returning both fields.
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
const NAKSHATRA_LORD_CYCLE = ['ketu', 'venus', 'sun', 'moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury'];

const { calculateShadbala } = require('./shadbalaCalc');
const { calculateAshtakvarga } = require('./ashtakvargaCalc');
const { calculateBhavaBala } = require('./bhavaBalaCalc');
const { houseOfPlanet } = require('./chartDerivation');

function toAbsoluteLongitude(rashi, degreeInSign) {
  return RASHI_ORDER.indexOf(rashi) * 30 + degreeInSign;
}

function nakshatraFromLongitude(absLong) {
  const span = 360 / 27;
  const idx = Math.floor(absLong / span) % 27;
  const within = absLong % span;
  const pada = Math.floor(within / (span / 4)) + 1;
  return { nakshatra: NAKSHATRAS[idx], pada, lord: NAKSHATRA_LORD_CYCLE[idx % 9] };
}

function checkMangalDosha(marsRashi, referenceRashi) {
  const house = houseOfPlanet(marsRashi, referenceRashi);
  return house != null && [1, 4, 7, 8, 12].includes(house);
}

function checkKaalSarpDosha(absoluteLongitudes) {
  const rahuLong = absoluteLongitudes.rahu;
  const ketuLong = absoluteLongitudes.ketu;
  const classicalPlanets = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];
  const relPositions = classicalPlanets.map(p => ((absoluteLongitudes[p] - rahuLong) % 360 + 360) % 360);
  const rahuToKetuSpan = ((ketuLong - rahuLong) % 360 + 360) % 360;
  return relPositions.every(d => d <= rahuToKetuSpan) || relPositions.every(d => d >= rahuToKetuSpan);
}

/**
 * @param {object} manualPositions - { sun: {rashi, degreeInSign, retrograde?}, moon: {...}, ... lagna: {...} }
 */
function calculateFromManualPositions(manualPositions) {
  const requiredPlanets = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'rahu', 'ketu', 'lagna'];
  const missing = requiredPlanets.filter(p => !manualPositions[p] || !manualPositions[p].rashi);
  if (missing.length) {
    throw new Error(`Missing position(s) for: ${missing.join(', ')}`);
  }

  const absoluteLongitudes = {};
  const planetaryPositions = {};

  requiredPlanets.forEach(p => {
    const { rashi, degreeInSign, retrograde } = manualPositions[p];
    absoluteLongitudes[p] = toAbsoluteLongitude(rashi, degreeInSign);
    const nak = nakshatraFromLongitude(absoluteLongitudes[p]);
    const defaultRetro = (p === 'rahu' || p === 'ketu');
    planetaryPositions[p] = {
      rashi,
      degreeInSign,
      retrograde: retrograde != null ? !!retrograde : defaultRetro,
      nakshatra: nak.nakshatra,
      pada: nak.pada
    };
  });

  const lagnaRashi = planetaryPositions.lagna.rashi;
  const moonRashi = planetaryPositions.moon.rashi;
  const marsRashi = planetaryPositions.mars.rashi;
  const moonNak = nakshatraFromLongitude(absoluteLongitudes.moon);
  const moonNakLord = moonNak.lord;

  const doshas = {
    mangalDoshaLagnaKundli: checkMangalDosha(marsRashi, lagnaRashi),
    mangalDoshaChandraKundli: checkMangalDosha(marsRashi, moonRashi),
    kaalSarpDosha: checkKaalSarpDosha(absoluteLongitudes)
  };

  const sunHouse = houseOfPlanet(planetaryPositions.sun.rashi, lagnaRashi);
  const isDayBirth = sunHouse >= 7 && sunHouse <= 12;
  const moonSunAngularDist = ((absoluteLongitudes.moon - absoluteLongitudes.sun) % 360 + 360) % 360;

  const shadbala = calculateShadbala(planetaryPositions, lagnaRashi, isDayBirth, moonSunAngularDist);
  const ashtakvarga = calculateAshtakvarga(planetaryPositions, lagnaRashi);
  const bhavaBala = calculateBhavaBala(planetaryPositions, shadbala, lagnaRashi);

  return {
    planetaryPositions,
    ashtakvarga,
    shadbala,
    bhavaBala,
    doshas,
    nakshatraLord: moonNakLord,
    moonNakshatraName: moonNak.nakshatra, // FIX: this field was previously missing entirely
    parseWarnings: [],
    source: 'manual-position-entry',
    calculationNotes: [
      'Planetary positions entered manually (no astronomical calculation) -- these are treated as ground truth exactly as entered.',
      'Shadbala: Saptavargaja Bala and Drekkana Bala are approximated (full 7-varga and drekkana dignity tables not yet computed). Abda/Masa/Vara/Hora Bala use flat proxy values. Yuddha Bala is not computed.',
      'Ashtakvarga: uses standard classical Parashari contribution tables.',
      'Bhava Bala: derived from computed Shadbala and house positions using a simplified formula.'
    ]
  };
}

module.exports = { calculateFromManualPositions };
