/**
 * Kundali Scoring Engine — CEI + LPI only
 * ------------------------------------------------------------
 * SCOPE CHANGE (per Shubhodayah's decision): the 12 house scores
 * (HPS/WPS/etc.) have been removed entirely. This file now only
 * computes CEI (from planetary positions) and LPI (from a 45-item
 * yes/no questionnaire the father fills in on the site — LPI's
 * criteria are real-life facts like "no serious illness in the last
 * 5 years" or "marital satisfaction", which cannot be derived from a
 * birth chart, so LPI is NOT position-based).
 *
 * CEI is graded on the confirmed CEI/LPI comparative grading matrix:
 * raw score out of 90, bands 80-90/70-79/60-69/50-59/<50.
 */

const { calculateCEI: calculateCEIOfficial } = require('./officialScoring');
const { calculateFromManualPositions } = require('./engine/manualChartEngine');
const { calculateBirthChart } = require('./engine/birthChartEngine');

// CEI/LPI comparative grading matrix — shared by both indices, out of 90.
function gradeCeiLpi(score) {
  if (score == null) return null;
  if (score >= 80) return 'Supreme Harmony';
  if (score >= 70) return 'Good Harmony';
  if (score >= 60) return 'Average Harmony';
  if (score >= 50) return 'Energy-Loss Effect';
  return 'Severe Imbalance';
}

/**
 * LPI's 9 life-domains, each with 5 questions (2 points each), in the
 * exact order/wording from Shubhodayah's LPI worksheet. Used both to
 * validate submitted answers and to render the on-site questionnaire.
 */
const LPI_DOMAINS = [
  {
    key: 'physicalHealth', label: 'शारीरिक स्वास्थ्य (Physical Health)',
    questions: [
      'पिछले 5 वर्षों में गंभीर बीमारी नहीं (No serious illness in last 5 years)',
      'BMI/वजन सामान्य (BMI/weight normal)',
      'नियमित ऊर्जा व कार्यक्षमता (Regular energy & efficiency)',
      'अच्छी नींद (Good sleep)',
      'नियमित व्यायाम/योग (Regular exercise/yoga)'
    ]
  },
  {
    key: 'mentalHealth', label: 'मानसिक स्वास्थ्य (Mental Health)',
    questions: [
      'तनाव नियंत्रण अच्छा (Stress control good)',
      'निर्णय क्षमता अच्छी (Decision-making ability good)',
      'आत्मविश्वास अच्छा (Self-confidence good)',
      'क्रोध नियंत्रण (Anger control)',
      'अवसाद/चिंता नहीं (No depression/anxiety)'
    ]
  },
  {
    key: 'financialStatus', label: 'आर्थिक स्थिति (Financial Status)',
    questions: [
      'नियमित आय (Regular income)',
      'बचत (Savings)',
      'ऋण नियंत्रित (Debt controlled)',
      'संपत्ति निर्माण (Wealth building)',
      'आर्थिक स्थिरता (Financial stability)'
    ]
  },
  {
    key: 'career', label: 'करियर (Career)',
    questions: [
      'नौकरी/व्यवसाय स्थिर (Job/business stable)',
      'पदोन्नति/विकास (Promotion/growth)',
      'कार्य संतुष्टि (Work satisfaction)',
      'आय वृद्धि (Income growth)',
      'प्रोफेशनल प्रतिष्ठा (Professional reputation)'
    ]
  },
  {
    key: 'education', label: 'शिक्षा एवं ज्ञान (Education & Knowledge)',
    questions: [
      'शिक्षा पूरी (Education completed)',
      'नए कौशल सीखना (Learning new skills)',
      'निर्णय क्षमता (Decision-making ability)',
      'ज्ञान का उपयोग (Use of knowledge)',
      'बौद्धिक विकास (Intellectual development)'
    ]
  },
  {
    key: 'familyMarriedLife', label: 'वैवाहिक एवं पारिवारिक जीवन (Marital & Family Life)',
    questions: [
      'दाम्पत्य संतुष्टि (Marital satisfaction)',
      'परिवार का सहयोग (Family support)',
      'संतान संबंध (Children relationship)',
      'पारिवारिक शांति (Family peace)',
      'रिश्तों में स्थिरता (Stability in relationships)'
    ]
  },
  {
    key: 'socialPrestige', label: 'सामाजिक प्रतिष्ठा (Social Prestige)',
    questions: [
      'समाज में सम्मान (Respect in society)',
      "मित्र सहयोग (Friends' support)",
      'नेतृत्व क्षमता (Leadership ability)',
      'सामाजिक योगदान (Social contribution)',
      'अच्छी छवि (Good image)'
    ]
  },
  {
    key: 'spiritualLife', label: 'आध्यात्मिक जीवन (Spiritual Life)',
    questions: [
      'ईश्वर में आस्था (Faith in God)',
      'ध्यान/साधना (Meditation/practice)',
      'नैतिक जीवन (Moral life)',
      'आत्म-संतोष (Self-satisfaction)',
      'जीवन का उद्देश्य स्पष्ट (Life purpose clear)'
    ]
  },
  {
    key: 'lifeSatisfaction', label: 'जीवन संतुष्टि (Life Satisfaction)',
    questions: [
      'स्वयं से संतुष्टि (Satisfaction with self)',
      'भविष्य के प्रति आशावाद (Optimism about future)',
      'जीवन संतुलन (Life balance)',
      'लक्ष्य प्राप्ति (Goal achievement)',
      'समग्र खुशी (Overall happiness)'
    ]
  }
];

/**
 * Computes LPI from the father's questionnaire answers.
 * @param {object} answers - { physicalHealth: [true,true,false,true,true], mentalHealth: [...], ... }
 *   Each domain must have exactly 5 booleans (true = 2 points, false = 0).
 */
function calculateLPIFromAnswers(answers) {
  if (!answers) {
    return { score: null, maxScore: 90, grade: null, detail: { reason: 'No LPI answers submitted' } };
  }

  const components = {};
  let rawSum = 0;
  let complete = true;

  LPI_DOMAINS.forEach(domain => {
    const domainAnswers = answers[domain.key];
    if (!Array.isArray(domainAnswers) || domainAnswers.length !== 5) {
      components[domain.key] = null;
      complete = false;
      return;
    }
    const domainScore = domainAnswers.filter(Boolean).length * 2;
    components[domain.key] = domainScore;
    rawSum += domainScore;
  });

  if (!complete) {
    return {
      score: null, maxScore: 90, grade: null,
      detail: { reason: 'Incomplete LPI questionnaire — all 9 domains (5 questions each) are required', components }
    };
  }

  const score = Math.round(rawSum);
  return {
    score,
    maxScore: 90,
    grade: gradeCeiLpi(score),
    detail: {
      formula: 'LPI = sum of 9 life-domain scores (5 questions x 2 points each), out of 90 — answered directly by the father, not derived from planetary positions',
      components,
      domainLabels: Object.fromEntries(LPI_DOMAINS.map(d => [d.key, d.label])),
      rawSum: score,
      maxScore: 90,
      gradingBandsUsed: '80-90 Supreme Harmony | 70-79 Good Harmony | 60-69 Average Harmony | 50-59 Energy-Loss Effect | <50 Severe Imbalance'
    }
  };
}

/**
 * Computes CEI from real chart data (positions -> Shadbala/Ashtakvarga/
 * Bhava Bala/doshas/nakshatra, all computed internally) plus LPI from
 * the father's questionnaire answers.
 * @param {object} parsedData - chart data shape from manualChartEngine/birthChartEngine
 * @param {object} lpiAnswers - see calculateLPIFromAnswers above
 */
function calculateCeiAndLpi(parsedData, lpiAnswers) {
  const cei = calculateCEIOfficial(parsedData);
  const lpi = calculateLPIFromAnswers(lpiAnswers);

  return {
    scores: { cei: cei.score, lpi: lpi.score },
    scoringDetails: {
      lagnaRashi: parsedData.planetaryPositions && parsedData.planetaryPositions.lagna
        ? parsedData.planetaryPositions.lagna.rashi : null,
      cei: cei.detail,
      lpi: lpi.detail,
      ceiGrade: cei.grade,
      lpiGrade: lpi.grade,
      ceiMaxScore: cei.maxScore,
      lpiMaxScore: lpi.maxScore
    }
  };
}

/** Real planetary positions typed in directly (ground truth, no astronomy calc). */
function calculateAllScoresFromManualPositions(manualPositions, lpiAnswers) {
  const chartData = calculateFromManualPositions(manualPositions);
  const result = calculateCeiAndLpi(chartData, lpiAnswers);
  result.scoringDetails.source = 'manual-position-entry';
  result.scoringDetails.calculationNotes = chartData.calculationNotes;
  return result;
}

/** Birth date/time/location -> calculated positions (lower precision than manual entry). */
function calculateAllScoresFromBirthDetails(birthDetails, lpiAnswers) {
  const chartData = calculateBirthChart(birthDetails);
  const result = calculateCeiAndLpi(chartData, lpiAnswers);
  result.scoringDetails.source = 'calculated';
  result.scoringDetails.calculationNotes = chartData.calculationNotes;
  return result;
}

module.exports = {
  calculateAllScoresFromManualPositions,
  calculateAllScoresFromBirthDetails,
  LPI_DOMAINS
};
