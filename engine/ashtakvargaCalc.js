/**
 * Ashtakvarga Calculator
 * ------------------------------------------------------------
 * Computes Bhinnashtakavarga (per-planet bindu tables) and the
 * combined Sarvashtakvarga, using the classical Parashari contribution
 * rules: each of 8 reference points (7 grahas + Lagna) contributes a
 * bindu (point) to specific houses counted from itself, for each of
 * the 7 target planets' own Ashtakvarga.
 *
 * DOCUMENTED CAVEAT: these house-contribution tables are large,
 * fixed, classical data (from Brihat Parashara Hora Shastra) reproduced
 * here from standard memory of the well-known tables. As with any
 * large hand-transcribed classical dataset, cross-checking against a
 * canonical printed reference is recommended before relying on exact
 * bindu counts for published research -- transcription slips are
 * possible even though the overall structure and method are correct.
 */

const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

const REFERENCE_POINTS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'lagna'];
const TARGET_PLANETS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];

// Classical BAV contribution tables: for each TARGET planet, which
// houses (counted from each REFERENCE point) receive a bindu.
const BAV_TABLES = {
  sun: {
    sun: [1, 2, 4, 7, 8, 9, 10, 11], moon: [3, 6, 10, 11], mars: [1, 2, 4, 7, 8, 9, 10, 11],
    mercury: [3, 5, 6, 9, 10, 11, 12], jupiter: [5, 6, 9, 11], venus: [6, 7, 12],
    saturn: [1, 2, 4, 7, 8, 9, 10, 11], lagna: [3, 4, 6, 10, 11, 12]
  },
  moon: {
    sun: [3, 6, 10, 11], moon: [1, 3, 6, 7, 10, 11], mars: [2, 3, 5, 6, 9, 10, 11],
    mercury: [1, 3, 4, 5, 7, 8, 10, 11], jupiter: [1, 4, 7, 8, 10, 11, 12], venus: [3, 4, 5, 7, 9, 10, 11],
    saturn: [3, 5, 6, 11], lagna: [3, 6, 10, 11]
  },
  mars: {
    sun: [3, 5, 6, 10, 11], moon: [3, 6, 11], mars: [1, 2, 4, 7, 8, 10, 11],
    mercury: [3, 5, 6, 11], jupiter: [6, 10, 11, 12], venus: [6, 8, 11, 12],
    saturn: [1, 4, 7, 8, 9, 10, 11], lagna: [1, 3, 6, 10, 11]
  },
  mercury: {
    sun: [5, 6, 9, 11, 12], moon: [2, 4, 6, 8, 10, 11], mars: [1, 2, 4, 7, 8, 9, 10, 11],
    mercury: [1, 2, 3, 4, 6, 8, 10, 11], jupiter: [6, 8, 11, 12], venus: [1, 2, 3, 4, 5, 8, 9, 11],
    saturn: [1, 2, 4, 7, 8, 9, 10, 11], lagna: [1, 2, 4, 6, 8, 10, 11]
  },
  jupiter: {
    sun: [1, 2, 3, 4, 7, 8, 9, 10, 11], moon: [2, 5, 7, 9, 11], mars: [1, 2, 4, 7, 8, 10, 11],
    mercury: [1, 2, 4, 5, 6, 9, 10, 11], jupiter: [1, 2, 3, 4, 7, 8, 10, 11], venus: [2, 5, 6, 9, 10, 11],
    saturn: [3, 5, 6, 12], lagna: [1, 2, 4, 5, 6, 7, 9, 10, 11]
  },
  venus: {
    sun: [8, 11, 12], moon: [1, 2, 3, 4, 5, 8, 9, 11, 12], mars: [3, 4, 6, 9, 11, 12],
    mercury: [3, 5, 6, 9, 11], jupiter: [5, 8, 9, 10, 11], venus: [1, 2, 3, 4, 5, 8, 9, 10, 11],
    saturn: [3, 4, 5, 8, 9, 10, 11], lagna: [1, 2, 3, 4, 5, 8, 9, 11]
  },
  saturn: {
    sun: [1, 2, 4, 7, 8, 10, 11], moon: [3, 6, 11], mars: [3, 5, 6, 10, 11, 12],
    mercury: [6, 8, 9, 10, 11, 12], jupiter: [5, 6, 11, 12], venus: [6, 11, 12],
    saturn: [3, 5, 6, 11], lagna: [1, 3, 4, 6, 10, 11]
  }
};

/** Computes one target planet's Bhinnashtakavarga: bindus per house 1-12 (relative to that planet's own position mapped onto rashis). */
function computeBhinnashtakavarga(targetPlanet, planetaryPositions, lagnaRashi) {
  const table = BAV_TABLES[targetPlanet];
  const bindusPerRashi = {};
  RASHI_ORDER.forEach(r => { bindusPerRashi[r] = 0; });

  REFERENCE_POINTS.forEach(ref => {
    const refRashi = ref === 'lagna' ? lagnaRashi : planetaryPositions[ref].rashi;
    const refIndex = RASHI_ORDER.indexOf(refRashi);
    const contributingHouses = table[ref] || [];
    contributingHouses.forEach(houseNum => {
      const targetIndex = (refIndex + houseNum - 1) % 12;
      bindusPerRashi[RASHI_ORDER[targetIndex]] += 1;
    });
  });

  return bindusPerRashi;
}

/** Computes all 7 planets' Bhinnashtakavarga plus the combined Sarvashtakvarga, keyed by rashi. */
function calculateAshtakvarga(planetaryPositions, lagnaRashi) {
  const perPlanet = {};
  TARGET_PLANETS.forEach(p => {
    perPlanet[p] = computeBhinnashtakavarga(p, planetaryPositions, lagnaRashi);
  });

  const byRashi = {};
  RASHI_ORDER.forEach(rashi => {
    const entry = {};
    let sarva = 0;
    TARGET_PLANETS.forEach(p => {
      entry[p] = perPlanet[p][rashi];
      sarva += perPlanet[p][rashi];
    });
    entry.sarvashtakvarga = sarva;
    byRashi[rashi] = entry;
  });

  return byRashi;
}

module.exports = { calculateAshtakvarga };
