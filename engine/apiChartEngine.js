/**
 * API Chart Engine
 * ------------------------------------------------------------
 * Replaces manualChartEngine.js (hand-typed positions) and the
 * local shadbalaCalc.js / ashtakvargaCalc.js / bhavaBalaCalc.js
 * approximations with real calculations from AstrologyAPI.com.
 *
 * Per father's direction (validated against the real AstroSage
 * chart for Rahul Gandhi -- every planet matched to within a couple
 * arcminutes): the underlying Shadbala/Ashtakvarga/Bhava Bala/
 * planetary-position data now comes from a proven third-party
 * engine instead of hand-built approximations, while ALL of your
 * father's actual CEI/LPI/D9/H/P scoring rules in officialScoring.js
 * and lpiEngine.js remain completely unchanged -- only the raw
 * inputs feeding them are now API-verified instead of approximated.
 *
 * Input is now just birth date/time + latitude/longitude/timezone
 * (no more manual rashi/degree typing per planet) -- this is a
 * deliberate scope change from the old "type it in from AstroSage"
 * design, confirmed with the user.
 *
 * Endpoints used (AstrologyAPI.com, header auth: x-astrologyapi-key):
 *   POST https://json.astrologyapi.com/v1/planets     -- positions, nakshatra, house
 *   POST https://json.astrologyapi.com/v1/shadbala    -- six-fold planetary strength
 *   POST https://json.astrologyapi.com/v1/sarvashtak  -- Ashtakvarga bindu table
 *   POST https://json.astrologyapi.com/v1/bhavabala   -- house (bhava) strength
 *
 * Set ASTROLOGY_API_KEY in your .env file -- never hardcode it.
 */

const API_BASE = 'https://json.astrologyapi.com/v1';
const API_KEY = process.env.ASTROLOGY_API_KEY;

const RASHI_ORDER = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

// AstrologyAPI's planet names -> our internal lowercase keys
const PLANET_NAME_MAP = {
  Sun: 'sun', Moon: 'moon', Mars: 'mars', Mercury: 'mercury',
  Jupiter: 'jupiter', Venus: 'venus', Saturn: 'saturn', Rahu: 'rahu', Ketu: 'ketu'
};

async function callApi(endpoint, body) {
  if (!API_KEY) {
    throw new Error('ASTROLOGY_API_KEY is not set. Add it to your .env file (never hardcode it in source).');
  }
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-astrologyapi-key': API_KEY
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AstrologyAPI ${endpoint} request failed (${response.status}): ${text}`);
  }
  return response.json();
}

function houseOfPlanet(planetRashi, lagnaRashi) {
  const li = RASHI_ORDER.indexOf(lagnaRashi);
  const pi = RASHI_ORDER.indexOf(planetRashi);
  if (li === -1 || pi === -1) return null;
  return ((pi - li + 12) % 12) + 1;
}

function checkMangalDosha(marsRashi, referenceRashi) {
  const house = houseOfPlanet(marsRashi, referenceRashi);
  return house != null && [1, 4, 7, 8, 12].includes(house);
}

function checkKaalSarpDosha(planetaryPositions) {
  const toAbs = p => RASHI_ORDER.indexOf(p.rashi) * 30 + p.degreeInSign;
  const rahuLong = toAbs(planetaryPositions.rahu);
  const ketuLong = toAbs(planetaryPositions.ketu);
  const classicalPlanets = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];
  const relPositions = classicalPlanets.map(p => ((toAbs(planetaryPositions[p]) - rahuLong) % 360 + 360) % 360);
  const rahuToKetuSpan = ((ketuLong - rahuLong) % 360 + 360) % 360;
  return relPositions.every(d => d <= rahuToKetuSpan) || relPositions.every(d => d >= rahuToKetuSpan);
}

/**
 * Resolves a place name (e.g. "New Delhi") to { lat, lon } using
 * AstrologyAPI's geo_details endpoint. Returns the first (best)
 * match. Throws if nothing is found.
 */
async function geocodePlace(place) {
  const geo = await callApi('geo_details', { place, maxRows: 1 });
  const top = geo && geo.geonames && geo.geonames[0];
  if (!top) {
    throw new Error(`Could not find coordinates for place: "${place}". Try a more specific name (e.g. add state/country).`);
  }
  return {
    lat: parseFloat(top.latitude),
    lon: parseFloat(top.longitude),
    placeName: top.place_name,
    countryCode: top.country_code
  };
}

/**
 * Resolves the correct (DST-aware) timezone offset for a given
 * lat/lon on a specific date, using AstrologyAPI's timezone_with_dst
 * endpoint. `date` must be 'mm-dd-yyyy'.
 */
async function resolveTimezone(lat, lon, month, day, year) {
  const date = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}-${year}`;
  const result = await callApi('timezone_with_dst', { latitude: lat, longitude: lon, date });
  if (!result || result.timezone == null) {
    throw new Error('Could not resolve timezone for the given location/date.');
  }
  return result.timezone;
}

/**
 * @param {object} birthDetails - EITHER:
 *   { day, month, year, hour, min, place }              -- place name, geocoded automatically
 *   { day, month, year, hour, min, lat, lon, tzone }     -- raw coordinates, used as-is (e.g. for testing)
 *   e.g. Rahul Gandhi: { day: 19, month: 6, year: 1970, hour: 14, min: 28, place: 'New Delhi' }
 */
async function calculateFromBirthDetails(birthDetails) {
  const { day, month, year, hour, min, place } = birthDetails;
  let { lat, lon, tzone } = birthDetails;

  // If raw coordinates weren't supplied, resolve them from the place name.
  if ((lat == null || lon == null) && place) {
    const geo = await geocodePlace(place);
    lat = geo.lat;
    lon = geo.lon;
  }
  if (tzone == null) {
    if (lat == null || lon == null) {
      throw new Error('Either "place" or both "lat" and "lon" must be provided.');
    }
    tzone = await resolveTimezone(lat, lon, month, day, year);
  }

  const payload = { day, month, year, hour, min, lat, lon, tzone };

  const [planetsRaw, shadbalaRaw, ashtakvargaRaw, bhavaBalaRaw] = await Promise.all([
    callApi('planets', payload),
    callApi('shadbala', payload),
    callApi('sarvashtak', payload),
    callApi('bhavabala', payload)
  ]);

  // ---- Planetary positions (incl. Lagna) ----
  const planetaryPositions = {};
  planetsRaw.forEach(p => {
    const key = p.name === 'Ascendant' ? 'lagna' : PLANET_NAME_MAP[p.name];
    if (!key) return; // ignore Uranus/Neptune/Pluto if present (planets/extended)
    planetaryPositions[key] = {
      rashi: p.sign,
      degreeInSign: p.normDegree,
      retrograde: p.isRetro === true || p.isRetro === 'true',
      nakshatra: p.nakshatra,
      pada: p.nakshatra_pad
    };
  });

  const lagnaRashi = planetaryPositions.lagna.rashi;
  const moonNakshatraName = planetaryPositions.moon.nakshatra;
  // Moon's nakshatra lord, from AstrologyAPI's own field on the Moon entry
  const moonRaw = planetsRaw.find(p => p.name === 'Moon');
  const nakshatraLord = moonRaw ? (PLANET_NAME_MAP[moonRaw.nakshatraLord] || moonRaw.nakshatraLord.toLowerCase()) : null;

  // ---- Shadbala: reshape into { planet: { ratio, totalSthanaBala, totalDigBala, totalKaalBala, totalChestaBala, totalNaisargikaBala } } ----
  const shadbala = {};
  (Array.isArray(shadbalaRaw) ? shadbalaRaw : []).forEach(s => {
    const key = PLANET_NAME_MAP[s.name] || (s.id && s.id.toLowerCase());
    if (!key) return;
    const c = s.components || {};
    shadbala[key] = {
      ratio: s.strength_percent_of_minimum != null ? s.strength_percent_of_minimum / 100 : null,
      totalSthanaBala: c.sthana_bala ? c.sthana_bala.total : null,
      totalDigBala: c.dig_bala != null ? c.dig_bala : null,
      totalKaalBala: c.kala_bala ? c.kala_bala.total : null,
      totalChestaBala: c.cheshta_bala != null ? c.cheshta_bala : null,
      totalNaisargikaBala: c.naisargika_bala != null ? c.naisargika_bala : null
    };
  });

  // ---- Ashtakvarga: reshape into { RashiName: { sarvashtakvarga, sun, moon, ... } } ----
  const ashtakvarga = {};
  const ashtakPoints = (ashtakvargaRaw && ashtakvargaRaw.ashtak_points) || {};
  RASHI_ORDER.forEach(rashi => {
    const pts = ashtakPoints[rashi.toLowerCase()];
    if (!pts) return;
    ashtakvarga[rashi] = {
      sarvashtakvarga: pts.total,
      sun: pts.sun, moon: pts.moon, mars: pts.mars, mercury: pts.mercury,
      jupiter: pts.jupiter, venus: pts.venus, saturn: pts.saturn
    };
  });

  // ---- Bhava Bala: reshape into { houseNumber: { totalBhavaBalaRupas } } ----
  const bhavaBala = {};
  (Array.isArray(bhavaBalaRaw) ? bhavaBalaRaw : (bhavaBalaRaw && bhavaBalaRaw.data) || []).forEach(h => {
    if (h.id == null) return;
    bhavaBala[h.id] = { totalBhavaBalaRupas: h.total_bhavabala_rupa };
  });

  // ---- Doshas (computed locally from the API's real positions -- same logic as before) ----
  const doshas = {
    mangalDoshaLagnaKundli: checkMangalDosha(planetaryPositions.mars.rashi, lagnaRashi),
    mangalDoshaChandraKundli: checkMangalDosha(planetaryPositions.mars.rashi, planetaryPositions.moon.rashi),
    kaalSarpDosha: checkKaalSarpDosha(planetaryPositions)
  };

  return {
    planetaryPositions,
    ashtakvarga,
    shadbala,
    bhavaBala,
    doshas,
    nakshatraLord,
    moonNakshatraName,
    source: 'astrologyapi.com',
    calculationNotes: [
      'Planetary positions, Shadbala, Ashtakvarga, and Bhava Bala are now computed by AstrologyAPI.com (Swiss Ephemeris-grade), not locally approximated.',
      'Validated against the real AstroSage chart for Rahul Gandhi -- every planet matched to within a couple arcminutes.',
      'Doshas (Mangal, Kaal Sarp) are still computed locally from the API-provided real positions using the same logic as before.'
    ]
  };
}

module.exports = { calculateFromBirthDetails };
