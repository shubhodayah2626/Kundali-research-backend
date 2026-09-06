/**
 * Astronomical Engine
 * ------------------------------------------------------------
 * Computes real sidereal (Lahiri ayanamsa) positions of the Sun, Moon,
 * five classical planets, Ascendant (Lagna), and lunar nodes (Rahu/
 * Ketu) directly from birth date, time, and location -- no external
 * PDF or ephemeris library required.
 *
 * METHOD: standard low-precision analytical formulas widely used for
 * this purpose (Meeus-style truncated series for Sun/Moon; Keplerian
 * two-body elements for Mercury-Saturn, in the style popularized by
 * Paul Schlyter's "How to compute planetary positions"). This is NOT
 * full-precision (JPL-grade) astronomy -- typical error is a few
 * arcminutes for the Moon, well under a degree for the Sun and outer
 * planets. That is precise enough to place a planet in the correct
 * Rashi (30 degree sign) and, in the vast majority of cases, the
 * correct Nakshatra (13d20m) -- the only exception is a birth moment
 * that falls within a couple of arcminutes of a sign/nakshatra
 * boundary, which is rare.
 *
 * DOCUMENTED APPROXIMATION: nutation and atmospheric refraction are
 * ignored; the Lahiri ayanamsa is applied as a linear approximation
 * from its J2000.0 value rather than the full IAU precession model.
 * These are standard, accepted simplifications for this level of
 * precision and do not materially affect sign/nakshatra placement.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function sin(deg) { return Math.sin(deg * DEG2RAD); }
function cos(deg) { return Math.cos(deg * DEG2RAD); }
function tan(deg) { return Math.tan(deg * DEG2RAD); }
function atan2deg(y, x) { return Math.atan2(y, x) * RAD2DEG; }
function norm360(deg) { return ((deg % 360) + 360) % 360; }

/** Julian Day (UT) from a Gregorian calendar date + decimal UT hours. */
function toJulianDay(year, month, day, utHours) {
  let Y = year, M = month;
  if (M <= 2) { Y -= 1; M += 12; }
  const A = Math.floor(Y / 100);
  const B = 2 - A + Math.floor(A / 4);
  const JD0 = Math.floor(365.25 * (Y + 4716)) + Math.floor(30.6001 * (M + 1)) + day + B - 1524.5;
  return JD0 + utHours / 24;
}

/** Lahiri ayanamsa (degrees), linear approximation anchored at J2000.0. */
function lahiriAyanamsa(T) {
  // T = Julian centuries since J2000.0
  const yearsSinceJ2000 = T * 100;
  const AYANAMSA_AT_J2000 = 23.85; // approx Lahiri value at J2000.0
  const PRECESSION_RATE_DEG_PER_YEAR = 50.2388475 / 3600;
  return AYANAMSA_AT_J2000 + PRECESSION_RATE_DEG_PER_YEAR * yearsSinceJ2000;
}

/** Sun's geocentric TROPICAL ecliptic longitude (deg) and Earth-Sun distance (AU). */
function sunPosition(T) {
  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T * T);
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
    + (0.019993 - 0.000101 * T) * sin(2 * M)
    + 0.000289 * sin(3 * M);
  const trueLong = norm360(L0 + C);
  const R = 1.00014 - 0.01671 * cos(M) - 0.00014 * cos(2 * M); // AU
  return { longitude: trueLong, meanAnomaly: M, distance: R };
}

/** Moon's geocentric TROPICAL ecliptic longitude (deg), truncated major-term series. */
function moonPosition(T, sunMeanAnomaly) {
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T);
  const M = sunMeanAnomaly;
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T);
  const F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T);

  const dL =
    6.288774 * sin(Mp) + 1.274027 * sin(2 * D - Mp) + 0.658314 * sin(2 * D)
    + 0.213618 * sin(2 * Mp) - 0.185116 * sin(M) - 0.114332 * sin(2 * F)
    + 0.058793 * sin(2 * D - 2 * Mp) + 0.057066 * sin(2 * D - M - Mp)
    + 0.053322 * sin(2 * D + Mp) + 0.045758 * sin(2 * D - M)
    - 0.040923 * sin(M - Mp) - 0.034720 * sin(D) - 0.030383 * sin(M + Mp)
    + 0.015327 * sin(2 * D - 2 * F) - 0.012528 * sin(Mp + 2 * F)
    + 0.010980 * sin(Mp - 2 * F) + 0.010675 * sin(4 * D - Mp)
    + 0.010034 * sin(3 * Mp) + 0.008548 * sin(4 * D - 2 * Mp);

  return norm360(Lp + dL);
}

/** Mean obliquity of the ecliptic (deg), nutation ignored (documented approximation). */
function obliquity(T) {
  return 23.439291 - 0.0130042 * T - 0.00000016 * T * T + 0.000000504 * T * T * T;
}

/** Greenwich Mean Sidereal Time (deg). */
function gmst(JD, T) {
  return norm360(
    280.46061837 + 360.98564736629 * (JD - 2451545.0)
    + 0.000387933 * T * T - (T * T * T) / 38710000
  );
}

/** Tropical Ascendant (deg) from local sidereal time, obliquity, and geographic latitude. */
function ascendant(ramcDeg, eps, latDeg) {
  const asc = atan2deg(
    cos(ramcDeg),
    -(sin(ramcDeg) * cos(eps) + tan(latDeg) * sin(eps))
  );
  return norm360(asc);
}

/** Mean lunar ascending node (Rahu, tropical, deg). */
function meanLunarNode(T) {
  return norm360(
    125.0445479 - 1934.1362891 * T + 0.0020754 * T * T
    + (T * T * T) / 467441 - (T * T * T * T) / 60616000
  );
}

// ---- Schlyter-style Keplerian elements for Mercury-Saturn (J2000.0 epoch, deg/day rates) ----
const PLANET_ELEMENTS = {
  mercury: { N: [48.3313, 3.24587e-5], i: [7.0047, 5.00e-8], w: [29.1241, 1.01444e-5], a: 0.387098, e: [0.205635, 5.59e-10], M: [168.6562, 4.0923344368] },
  venus: { N: [76.6799, 2.46590e-5], i: [3.3946, 2.75e-8], w: [54.8910, 1.38374e-5], a: 0.723330, e: [0.006773, -1.302e-9], M: [48.0052, 1.6021302244] },
  mars: { N: [49.5574, 2.11081e-5], i: [1.8497, -1.78e-8], w: [286.5016, 2.92961e-5], a: 1.523688, e: [0.093405, 2.516e-9], M: [18.6021, 0.5240207766] },
  jupiter: { N: [100.4542, 2.76854e-5], i: [1.3030, -1.557e-7], w: [273.8777, 1.64505e-5], a: 5.20256, e: [0.048498, 4.469e-9], M: [19.8950, 0.0830853001] },
  saturn: { N: [113.6634, 2.38980e-5], i: [2.4886, -1.081e-7], w: [339.3939, 2.97661e-5], a: 9.55475, e: [0.055546, -9.499e-9], M: [316.9670, 0.0334442282] }
};

function solveKepler(Mdeg, e) {
  let Erad = Mdeg * DEG2RAD;
  const Mrad = Mdeg * DEG2RAD;
  for (let iter = 0; iter < 8; iter++) {
    Erad = Erad - (Erad - e * Math.sin(Erad) - Mrad) / (1 - e * Math.cos(Erad));
  }
  return Erad * RAD2DEG;
}

/** Geocentric tropical ecliptic longitude (deg) of an outer/inner planet, given days since J2000.0. */
function planetPosition(planetKey, d, earthHelioLongDeg, earthDist) {
  const el = PLANET_ELEMENTS[planetKey];
  const N = norm360(el.N[0] + el.N[1] * d);
  const i = el.i[0] + el.i[1] * d;
  const w = norm360(el.w[0] + el.w[1] * d);
  const a = el.a;
  const e = el.e[0] + el.e[1] * d;
  const M = norm360(el.M[0] + el.M[1] * d);

  const E = solveKepler(M, e);
  const xv = a * (cos(E) - e);
  const yv = a * (Math.sqrt(1 - e * e) * sin(E));
  const v = atan2deg(yv, xv);
  const r = Math.sqrt(xv * xv + yv * yv);

  const vw = v + w;
  const xh = r * (cos(N) * cos(vw) - sin(N) * sin(vw) * cos(i));
  const yh = r * (sin(N) * cos(vw) + cos(N) * sin(vw) * cos(i));
  const zh = r * (sin(vw) * sin(i));

  const xs = earthDist * cos(earthHelioLongDeg);
  const ys = earthDist * sin(earthHelioLongDeg);

  const xg = xh - xs;
  const yg = yh - ys;
  const zg = zh;

  const geoLong = norm360(atan2deg(yg, xg));
  return { longitude: geoLong, distance: Math.sqrt(xg * xg + yg * yg + zg * zg) };
}

/**
 * Top-level: computes sidereal longitudes for Sun, Moon, 5 planets,
 * Rahu/Ketu, and the Ascendant, given a birth moment.
 *
 * @param {number} year, month (1-12), day
 * @param {number} utHours - decimal UT hours (already timezone-adjusted)
 * @param {number} latDeg - geographic latitude, +N
 * @param {number} lonDeg - geographic longitude, +E
 */
function computeSiderealPositions({ year, month, day, utHours, latDeg, lonDeg }) {
  const JD = toJulianDay(year, month, day, utHours);
  const T = (JD - 2451545.0) / 36525;
  const d = JD - 2451545.0;

  const ayanamsa = lahiriAyanamsa(T);
  const eps = obliquity(T);

  const sun = sunPosition(T);
  const moonTropical = moonPosition(T, sun.meanAnomaly);

  const earthHelioLong = norm360(sun.longitude + 180);

  const tropicalLongitudes = {
    sun: sun.longitude,
    moon: moonTropical
  };

  ['mercury', 'venus', 'mars', 'jupiter', 'saturn'].forEach(p => {
    tropicalLongitudes[p] = planetPosition(p, d, earthHelioLong, sun.distance).longitude;
  });

  const rahuTropical = meanLunarNode(T);
  tropicalLongitudes.rahu = rahuTropical;
  tropicalLongitudes.ketu = norm360(rahuTropical + 180);

  // Ascendant
  const ramc = norm360(gmst(JD, T) + lonDeg);
  const ascTropical = ascendant(ramc, eps, latDeg);
  tropicalLongitudes.lagna = ascTropical;

  // Retrograde check: compare longitude now vs +1 day (Rahu/Ketu always retrograde by convention)
  const dNext = d + 1;
  const earthHelioLongNext = norm360(sunPosition(T + 1 / 36525).longitude + 180);
  const retrograde = {};
  ['mercury', 'venus', 'mars', 'jupiter', 'saturn'].forEach(p => {
    const now = tropicalLongitudes[p];
    const next = planetPosition(p, dNext, earthHelioLongNext, sun.distance).longitude;
    const delta = norm360(next - now + 180) - 180; // signed shortest delta
    retrograde[p] = delta < 0;
  });
  retrograde.rahu = true;
  retrograde.ketu = true;
  retrograde.sun = false;
  retrograde.moon = false;

  const siderealLongitudes = {};
  Object.entries(tropicalLongitudes).forEach(([k, v]) => {
    siderealLongitudes[k] = norm360(v - ayanamsa);
  });

  return { siderealLongitudes, retrograde, ayanamsa, JD, T };
}

module.exports = {
  computeSiderealPositions,
  toJulianDay,
  lahiriAyanamsa,
  norm360
};
