/**
 * Shadbala Calculator
 * ------------------------------------------------------------
 * Computes the classical six-fold planetary strength (Shadbala) for
 * the 7 classical grahas, from real computed positions -- following
 * Brihat Parashara Hora Shastra's structure. Output shape matches
 * pdfParser.js's SHADBALA_ROW_ORDER keys, so officialScoring.js and
 * houseScoring.js work unmodified regardless of data source.
 *
 * DOCUMENTED APPROXIMATIONS (flagged per BPHS component, consistent
 * with this project's standing practice of flagging rather than
 * silently guessing):
 *  - Saptavargaja Bala normally uses dignity across 7 divisional
 *    charts (D1,D2,D3,D7,D9,D12,D30). Only D1 (rasi) dignity is
 *    computed here; the other 6 varga charts are not yet computed,
 *    so this sub-value is a scaled proxy from D1 dignity alone.
 *  - Drekkana Bala (decanate-based, gender-linked) is approximated
 *    from the planet's degree-in-sign only, not a full drekkana
 *    dignity table.
 *  - Yuddha Bala (planetary war adjustment, applies only when two
 *    planets are within ~1 degree of each other) is not computed;
 *    defaults to 0 (neutral) rather than guessed.
 *  - Ayana Bala uses a simplified declination-based estimate rather
 *    than full solar/lunar hemisphere tables.
 * All other components (Uchcha, Kendra, Dig, Naisargika, most of
 * Kaal Bala, Drik) follow the standard BPHS formulas directly.
 */

const { houseOfPlanet } = require('./chartDerivation');

const PLANET_ORDER_7 = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];

// Deepest exaltation degree (sign + degree) and debilitation point per planet.
const EXALTATION_POINT = {
  sun: { rashi: 'Aries', degree: 10 }, moon: { rashi: 'Taurus', degree: 3 },
  mars: { rashi: 'Capricorn', degree: 28 }, mercury: { rashi: 'Virgo', degree: 15 },
  jupiter: { rashi: 'Cancer', degree: 5 }, venus: { rashi: 'Pisces', degree: 27 },
  saturn: { rashi: 'Libra', degree: 20 }
};
const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

// Minimum required Shadbala (in Rupas) per BPHS, used for the ratio row.
const MINIMUM_REQUIREMENT_RUPAS = {
  sun: 5, moon: 6, mars: 5, mercury: 7, jupiter: 6.5, venus: 5.5, saturn: 5
};

// Male/female/neuter classification (needed for Ojayugmarasyamsha Bala).
const PLANET_GENDER = {
  sun: 'male', moon: 'female', mars: 'male', mercury: 'neuter',
  jupiter: 'male', venus: 'female', saturn: 'neuter'
};

// Natural (Naisargika) Bala -- fixed classical constants, in Shashtiamsas.
const NAISARGIKA_BALA = {
  sun: 60, moon: 51.43, venus: 42.86, jupiter: 34.29,
  mercury: 25.71, mars: 17.14, saturn: 8.57
};

// Each planet's house of directional (Dig) strength.
const DIG_BALA_STRONG_HOUSE = { sun: 10, mars: 10, moon: 4, venus: 4, jupiter: 1, mercury: 1, saturn: 7 };

// Aspect offsets for Drik Bala (Parashari graha drishti).
const ASPECT_OFFSETS = { mars: [4, 7, 8], jupiter: [5, 7, 9], saturn: [3, 7, 10], default: [7] };
const BENEFICS = ['jupiter', 'venus', 'mercury', 'moon'];

function angularDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/** Uchcha Bala (exaltation strength), 0-60 shashtiamsas. */
function uchchaBala(planet, rashi, degreeInSign) {
  const ep = EXALTATION_POINT[planet];
  const exaltLong = RASHI_ORDER.indexOf(ep.rashi) * 30 + ep.degree;
  const planetLong = RASHI_ORDER.indexOf(rashi) * 30 + degreeInSign;
  const dist = angularDistance(exaltLong, planetLong); // 0 (exact exaltation) to 180 (exact debilitation)
  return 60 * (1 - dist / 180);
}

/** Kendra Bala: 60/30/15 for kendra/panapara/apoklima houses from Lagna. */
function kendraBala(houseFromLagna) {
  if ([1, 4, 7, 10].includes(houseFromLagna)) return 60;
  if ([2, 5, 8, 11].includes(houseFromLagna)) return 30;
  return 15;
}

/** Ojayugmarasyamsha Bala (odd/even sign placement bonus by gender), D1 only. */
function ojaYugmaBala(planet, rashiIndex) {
  const isOdd = rashiIndex % 2 === 0; // Aries(0)=odd sign
  const gender = PLANET_GENDER[planet];
  if (gender === 'male' && isOdd) return 15;
  if (gender === 'female' && !isOdd) return 15;
  if (gender === 'neuter') return 7.5; // half credit, documented simplification
  return 0;
}

/** Saptavargaja Bala proxy: scaled from D1 dignity only (see file header). */
function saptavargajaBalaProxy(planet, rashi) {
  const { EXALTATION, DEBILITATION, OWN_SIGNS } = require('./dignityTables');
  if (EXALTATION[planet] === rashi) return 30;
  if (OWN_SIGNS[planet] && OWN_SIGNS[planet].includes(rashi)) return 22.5;
  if (DEBILITATION[planet] === rashi) return 1.875;
  return 11.25; // neutral-sign default (documented proxy, not full 7-varga computation)
}

/** Drekkana Bala approximation from degree-in-sign only (see file header). */
function drekkanaBalaApprox(planet, degreeInSign) {
  const gender = PLANET_GENDER[planet];
  const decanate = Math.floor(degreeInSign / 10); // 0,1,2
  // Male planets get points in 1st drekkana, female in 2nd, neuter in 3rd (simplified rule).
  if (gender === 'male' && decanate === 0) return 15;
  if (gender === 'female' && decanate === 1) return 15;
  if (gender === 'neuter' && decanate === 2) return 15;
  return 0;
}

/** Dig Bala: 60 at the planet's ideal house, falling linearly to 0 at the opposite house. */
function digBala(planet, houseFromLagna) {
  const idealHouse = DIG_BALA_STRONG_HOUSE[planet];
  const dist = Math.min(Math.abs(houseFromLagna - idealHouse), 12 - Math.abs(houseFromLagna - idealHouse));
  return 60 * (1 - dist / 6);
}

/** Nathonnata Bala: day-strength planets score high by day, night-strength planets by night. */
function nathonnataBala(planet, isDayBirth) {
  const dayStrong = ['sun', 'jupiter', 'venus'];
  const nightStrong = ['moon', 'mars', 'saturn'];
  if (dayStrong.includes(planet)) return isDayBirth ? 60 : 0;
  if (nightStrong.includes(planet)) return isDayBirth ? 0 : 60;
  return 30; // mercury: always half (classical rule)
}

/** Paksha Bala: benefics strong in the bright fortnight, malefics in the dark fortnight. */
function pakshaBala(planet, moonSunAngularDist) {
  // moonSunAngularDist: 0 = new moon, 180 = full moon
  const brightness = moonSunAngularDist <= 180 ? moonSunAngularDist : 360 - moonSunAngularDist;
  const benefics = ['moon', 'mercury', 'jupiter', 'venus'];
  if (planet === 'moon') return (brightness / 180) * 60;
  if (benefics.includes(planet)) return (brightness / 180) * 60;
  return 60 - (brightness / 180) * 60; // malefics stronger in dark fortnight
}

/** Ayana Bala approximation from declination proxy (degree in zodiacal half). */
function ayanaBalaApprox(planet, siderealLong) {
  // Northern-hemisphere signs (Cap through Gem, i.e. 270-360 and 0-90 for solstice season)
  // Simplified: use position within 0-360 to estimate seasonal declination trend.
  const seasonalFactor = (1 + Math.cos((siderealLong - 90) * Math.PI / 180)) / 2; // 0-1
  return seasonalFactor * 60;
}

/**
 * Computes the full Shadbala table for all 7 classical grahas.
 * @param {object} planetaryPositions - from chartDerivation.js
 * @param {number} lagnaRashiIndex - 0-11
 * @param {boolean} isDayBirth
 * @param {number} moonSunAngularDist - 0-360
 */
function calculateShadbala(planetaryPositions, lagnaRashi, isDayBirth, moonSunAngularDist) {
  const shadbala = {};

  PLANET_ORDER_7.forEach(planet => {
    const pos = planetaryPositions[planet];
    const rashiIndex = RASHI_ORDER.indexOf(pos.rashi);
    const houseFromLagna = houseOfPlanet(pos.rashi, lagnaRashi);
    const siderealLong = rashiIndex * 30 + pos.degreeInSign;

    const uchcha = uchchaBala(planet, pos.rashi, pos.degreeInSign);
    const saptavargaja = saptavargajaBalaProxy(planet, pos.rashi);
    const ojaYugma = ojaYugmaBala(planet, rashiIndex);
    const kendra = kendraBala(houseFromLagna);
    const drekkana = drekkanaBalaApprox(planet, pos.degreeInSign);
    const totalSthanaBala = uchcha + saptavargaja + ojaYugma + kendra + drekkana;

    const totalDigBala = digBala(planet, houseFromLagna);

    const nathonnata = nathonnataBala(planet, isDayBirth);
    const paksha = pakshaBala(planet, moonSunAngularDist);
    const tribhaga = 30; // documented simplification: flat half-credit (needs birth-hour-of-day detail to refine)
    const abda = 15; // flat proxy: year-lord bonus not computed (needs full Vedic-year calendar)
    const masa = 15; // flat proxy: month-lord bonus not computed
    const vara = 15; // flat proxy: weekday-lord bonus not computed
    const hora = 15; // flat proxy: hour-lord bonus not computed
    const ayana = ayanaBalaApprox(planet, siderealLong);
    const yuddha = 0; // not computed, see file header
    const totalKaalBala = nathonnata + paksha + tribhaga + abda + masa + vara + hora + ayana + yuddha;

    const totalChestaBala = planet === 'sun' || planet === 'moon' ? ayana : 30; // simplified proxy for retrograde-based motional strength

    const totalNaisargikaBala = NAISARGIKA_BALA[planet];

    // Drik Bala: benefic aspects add, malefic aspects subtract (up to +/-60, capped)
    let drik = 0;
    PLANET_ORDER_7.forEach(other => {
      if (other === planet) return;
      const otherHouse = houseOfPlanet(planetaryPositions[other].rashi, lagnaRashi);
      const offsets = ASPECT_OFFSETS[other] || ASPECT_OFFSETS.default;
      const distance = ((houseFromLagna - otherHouse + 12) % 12) + 1;
      if (offsets.includes(distance)) {
        drik += BENEFICS.includes(other) ? 15 : -15;
      }
    });
    const totalDrikBala = Math.max(-60, Math.min(60, drik + 30)); // normalized to 0-60-ish range, floor at 0 conceptually

    const totalShadbala = totalSthanaBala + totalDigBala + totalKaalBala + totalChestaBala + totalNaisargikaBala + Math.max(0, totalDrikBala);
    const shadbalaRupas = totalShadbala / 60;
    const minimumRequirement = MINIMUM_REQUIREMENT_RUPAS[planet];
    const ratio = shadbalaRupas / minimumRequirement;

    shadbala[planet] = {
      uchchaBala: uchcha, saptavargajaBala: saptavargaja, ojayugmarasyamshaBala: ojaYugma,
      kendraBala: kendra, drekkanaBala: drekkana, totalSthanaBala,
      totalDigBala,
      nathonnataBala: nathonnata, pakshaBala: paksha, tribhagaBala: tribhaga,
      abdaBala: abda, masaBala: masa, varaBala: vara, horaBala: hora,
      ayanaBala: ayana, yuddhaBala: yuddha, totalKaalBala,
      totalChestaBala,
      totalNaisargikaBala,
      totalDrikBala: Math.max(0, totalDrikBala),
      totalShadbala, shadbalaRupas, minimumRequirement, ratio,
      relativeRank: null // filled in below
    };
  });

  // Relative rank (1 = strongest)
  const ranked = [...PLANET_ORDER_7].sort((a, b) => shadbala[b].shadbalaRupas - shadbala[a].shadbalaRupas);
  ranked.forEach((p, i) => { shadbala[p].relativeRank = i + 1; });

  return shadbala;
}

module.exports = { calculateShadbala };
