/**
 * Shared classical dignity tables -- kept identical to the tables
 * already used in officialScoring.js, so the new calculation engine
 * and the PDF-parsing path agree on dignity classification.
 */
const EXALTATION = { sun: 'Aries', moon: 'Taurus', mars: 'Capricorn', mercury: 'Virgo', jupiter: 'Cancer', venus: 'Pisces', saturn: 'Libra' };
const DEBILITATION = { sun: 'Libra', moon: 'Scorpio', mars: 'Cancer', mercury: 'Pisces', jupiter: 'Capricorn', venus: 'Virgo', saturn: 'Aries' };
const OWN_SIGNS = { sun: ['Leo'], moon: ['Cancer'], mars: ['Aries', 'Scorpio'], mercury: ['Gemini', 'Virgo'], jupiter: ['Sagittarius', 'Pisces'], venus: ['Taurus', 'Libra'], saturn: ['Capricorn', 'Aquarius'] };

module.exports = { EXALTATION, DEBILITATION, OWN_SIGNS };
