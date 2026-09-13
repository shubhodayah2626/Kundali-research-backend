/**
 * Local Ashtakvarga (Bhinnashtakvarga + Sarvashtakvarga) calculator.
 * ------------------------------------------------------------
 * Built to replace AstrologyAPI.com's sarvashtak endpoint, whose
 * numbers were found to differ from AstroSage's by 5-8 points on
 * several signs despite both being genuine "raw" (337-total)
 * Sarvashtakvarga -- meaning the two use different classical bindu-
 * contribution tables. This module implements the standard
 * Parashara/B.V. Raman tables directly, computed locally from real
 * planetary positions (no external API call needed for this piece).
 *
 * Reference: B.V. Raman, "Ashtakavarga System of Prediction",
 * Chapter II. Verified against Raman's own worked example (the
 * "Standard Horoscope") before use -- see the self-test at the
 * bottom of this file.
 */

const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

/**
 * BENEFIC_PLACES[targetPlanet][contributor] = house numbers (1-12,
 * counted from the contributor's own position) where the
 * contributor gives the target planet one bindu.
 * Contributors: the 7 classical planets + 'lagna'.
 * Totals per target (must match exactly): Sun=48, Moon=49, Mars=39,
 * Mercury=54, Jupiter=56, Venus=52, Saturn=39. Grand total = 337.
 */
const BENEFIC_PLACES = {
  sun: {
    sun: [1, 2, 4, 7, 8, 9, 10, 11], moon: [3, 6, 10, 11], mars: [1, 2, 4, 7, 8, 9, 10, 11],
    mercury: [3, 5, 6, 9, 10, 11, 12], jupiter: [5, 6, 9, 11], venus: [6, 7, 12],
    saturn: [1, 2, 4, 7, 8, 9, 10, 11], lagna: [3, 4, 6, 10, 11, 12]
  },
  moon: {
    sun: [3, 6, 7, 8, 10, 11], moon: [1, 3, 6, 7, 10, 11], mars: [2, 3, 5, 6, 9, 10, 11],
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
    mercury: [1, 3, 5, 6, 9, 10, 11, 12], jupiter: [6, 8, 11, 12], venus: [1, 2, 3, 4, 5, 8, 9, 11],
    saturn: [1, 2, 4, 7, 8, 9, 10, 11], lagna: [1, 2, 4, 6, 8, 10, 11]
  },
  jupiter: {
    sun: [1, 2, 3, 4, 7, 8, 9, 10, 11], moon: [2, 5, 7, 9, 11], mars: [1, 2, 4, 7, 8, 10, 11],
    mercury: [1, 2, 4, 5, 6, 9, 10, 11], jupiter: [1, 2, 3, 4, 7, 8, 10, 11], venus: [2, 5, 6, 9, 10, 11],
    saturn: [3, 5, 6, 12], lagna: [1, 2, 4, 5, 6, 7, 9, 10, 11]
  },
  venus: {
    sun: [8, 11, 12], moon: [1, 2, 3, 4, 5, 8, 9, 11, 12], mars: [3, 5, 6, 9, 11, 12],
    mercury: [3, 5, 6, 9, 11], jupiter: [5, 8, 9, 10, 11], venus: [1, 2, 3, 4, 5, 8, 9, 10, 11],
    saturn: [3, 4, 5, 8, 9, 10, 11], lagna: [1, 2, 3, 4, 5, 8, 9, 11]
  },
  saturn: {
    sun: [1, 2, 4, 7, 8, 10, 11], moon: [3, 6, 11], mars: [3, 5, 6, 10, 11, 12],
    mercury: [6, 8, 9, 10, 11, 12], jupiter: [5, 6, 11, 12], venus: [6, 11, 12],
    saturn: [3, 5, 6, 11], lagna: [1, 3, 4, 6, 10, 11]
  }
};

const CONTRIBUTORS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn', 'lagna'];
const TARGET_PLANETS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];

function rashiOffset(startRashi, houseOffset) {
  const idx = RASHI_ORDER.indexOf(startRashi);
  if (idx === -1) return null;
  return RASHI_ORDER[(idx + houseOffset - 1) % 12];
}

/**
 * @param {object} planetaryPositions - { sun: {rashi}, moon: {rashi}, ..., lagna: {rashi} }
 * @returns {object} { RashiName: { sarvashtakvarga, sun, moon, mars, mercury, jupiter, venus, saturn } }
 */
function computeAshtakvarga(planetaryPositions) {
  const bav = {}; // bav[targetPlanet][rashi] = bindu count
  TARGET_PLANETS.forEach(target => {
    bav[target] = {};
    RASHI_ORDER.forEach(r => { bav[target][r] = 0; });

    CONTRIBUTORS.forEach(contributor => {
      const pos = planetaryPositions[contributor];
      if (!pos || !pos.rashi) return;
      const houses = BENEFIC_PLACES[target][contributor];
      houses.forEach(h => {
        const rashi = rashiOffset(pos.rashi, h);
        if (rashi) bav[target][rashi] += 1;
      });
    });
  });

  const result = {};
  RASHI_ORDER.forEach(r => {
    const entry = { sarvashtakvarga: 0 };
    TARGET_PLANETS.forEach(target => {
      entry[target] = bav[target][r];
      entry.sarvashtakvarga += bav[target][r];
    });
    result[r] = entry;
  });
  return result;
}

// ============================================================
// SELF-TEST: B.V. Raman's "Standard Horoscope" worked example.
// Run with: node ashtakvargaCalc.js
// Expected Sun BAV: Aries5 Taurus3 Gemini5 Cancer4 Leo4 Virgo4
//   Libra3 Scorpio5 Sagittarius5 Capricorn0 Aquarius5 Pisces5 (sum 48)
// Expected Sarvashtakvarga: Aries33 Taurus25 Gemini33 Cancer30 Leo26
//   Virgo23 Libra26 Scorpio29 Sagittarius30 Capricorn24 Aquarius27
//   Pisces31 (sum 337)
// ============================================================
if (require.main === module) {
  const testPositions = {
    sun: { rashi: 'Virgo' }, moon: { rashi: 'Aquarius' }, mars: { rashi: 'Scorpio' },
    mercury: { rashi: 'Libra' }, jupiter: { rashi: 'Gemini' }, venus: { rashi: 'Virgo' },
    saturn: { rashi: 'Leo' }, lagna: { rashi: 'Capricorn' }
  };
  const av = computeAshtakvarga(testPositions);
  console.log('Sun BAV:', RASHI_ORDER.map(r => `${r}=${av[r].sun}`).join(' '));
  console.log('Sun BAV total:', RASHI_ORDER.reduce((s, r) => s + av[r].sun, 0), '(expect 48)');
  console.log('SAV:', RASHI_ORDER.map(r => `${r}=${av[r].sarvashtakvarga}`).join(' '));
  console.log('SAV total:', RASHI_ORDER.reduce((s, r) => s + av[r].sarvashtakvarga, 0), '(expect 337)');
}

module.exports = { computeAshtakvarga };
