/**
 * LPI (Life Performance Index) — MANUAL WORKSHEET ENGINE
 * ------------------------------------------------------------
 * Per father's explicit clarification: LPI cannot be derived from a
 * birth chart. Its true criteria are real biographical facts (illness
 * history, career stability, relationships, faith practice, etc.)
 * that only the researcher (father) can assess for a given person.
 *
 * The old chart-proxy version of this file (which guessed LPI from
 * planetary positions) has been removed. LPI is now a digitized
 * version of father's worksheet: 9 life-domains x 5 criteria each,
 * every criterion scored 0 or 2 by the researcher, domain max = 10,
 * grand total max = 90.
 *
 * Reference case (Rahul Gandhi, father's filled worksheet):
 * Physical Health=10, Mental Health=8, Financial Status=8, Career=6,
 * Education & Knowledge=6, Marital & Family Life=6, Social
 * Prestige=4, Spiritual Life=6, Life Satisfaction=?? (criteria still
 * pending -- see TODO below) => running total of the other 8
 * domains = 54; grand total confirmed by father = 62, so Life
 * Satisfaction's true value should be 8 once its real criteria are
 * confirmed (currently a placeholder).
 *
 * CONFIRMED (from the CEI_Rahul_Gandhi... / Life_Performance_Index
 * reference PDF, cross-checked page by page):
 *  - "Life Satisfaction" domain's 5 criteria ARE genuinely distinct
 *    from Mental Health (self-satisfaction, future optimism,
 *    work-life balance, goal achievement, true happiness) -- the
 *    earlier worry that they were an accidental duplicate is
 *    unfounded; this domain's criteria below are correct as-is.
 *  - Career's previously-unconfirmed 5th criterion is now confirmed:
 *    "Job Satisfaction" -- daily work brings genuine inner mental
 *    satisfaction, not just stability/growth/income/prestige. The
 *    reference PDF places it 3rd in sequence (stability, growth,
 *    JOB SATISFACTION, income growth, prestige); kept in that order
 *    below to match the reference document's row order exactly.
 */

const LPI_DOMAINS = [
  {
    key: 'physicalHealth',
    labelHi: 'शारीरिक स्वास्थ्य',
    labelEn: 'Physical Health',
    criteria: [
      { key: 'noIllness5yr', labelHi: 'पिछले 5 वर्षों में कोई गंभीर बीमारी नहीं', labelEn: 'No serious illness in last 5 years' },
      { key: 'normalWeight', labelHi: 'सामान्य वज़न', labelEn: 'Normal weight' },
      { key: 'regularEnergy', labelHi: 'नियमित ऊर्जा / सक्रियता', labelEn: 'Regular energy / active' },
      { key: 'goodSleep', labelHi: 'अच्छी नींद', labelEn: 'Good sleep' },
      { key: 'regularExercise', labelHi: 'नियमित व्यायाम', labelEn: 'Regular exercise' }
    ]
  },
  {
    key: 'mentalHealth',
    labelHi: 'मानसिक स्वास्थ्य',
    labelEn: 'Mental Health',
    criteria: [
      { key: 'stressControl', labelHi: 'तनाव नियंत्रण अच्छा', labelEn: 'Good stress control' },
      { key: 'decisionMaking', labelHi: 'निर्णय क्षमता अच्छी', labelEn: 'Good decision-making ability' },
      { key: 'confidence', labelHi: 'आत्मविश्वास अच्छा', labelEn: 'Good self-confidence' },
      { key: 'angerControl', labelHi: 'क्रोध नियंत्रण', labelEn: 'Anger control' },
      { key: 'noDepression', labelHi: 'कोई अवसाद/चिंता नहीं', labelEn: 'No depression/anxiety' }
    ]
  },
  {
    key: 'financialStatus',
    labelHi: 'आर्थिक स्थिति',
    labelEn: 'Financial Status',
    criteria: [
      { key: 'regularIncome', labelHi: 'नियमित आय', labelEn: 'Regular income' },
      { key: 'savings', labelHi: 'बचत', labelEn: 'Savings' },
      { key: 'debtControl', labelHi: 'ऋण नियंत्रण', labelEn: 'Debt control' },
      { key: 'wealthBuilding', labelHi: 'संपत्ति निर्माण', labelEn: 'Wealth-building' },
      { key: 'financialStability', labelHi: 'आर्थिक स्थिरता', labelEn: 'Financial stability' }
    ]
  },
  {
    key: 'career',
    labelHi: 'करियर',
    labelEn: 'Career',
    criteria: [
      { key: 'jobBusinessStability', labelHi: 'नौकरी/व्यवसाय स्थिरता', labelEn: 'Job/business stability' },
      { key: 'promotionGrowth', labelHi: 'पदोन्नति/विकास', labelEn: 'Promotion/growth' },
      // CONFIRMED (reference PDF, page 5): the previously-pending 5th
      // criterion. Placed 3rd to match the reference document's row order.
      { key: 'jobSatisfaction', labelHi: 'कार्य से आंतरिक मानसिक संतुष्टि (Job Satisfaction)', labelEn: 'Job satisfaction from daily work' },
      { key: 'incomeContinuity', labelHi: 'आय निरंतरता', labelEn: 'Income continuity' },
      { key: 'professionalPrestige', labelHi: 'व्यावसायिक प्रतिष्ठा', labelEn: 'Professional prestige' }
    ]
  },
  {
    key: 'education',
    labelHi: 'शिक्षा एवं ज्ञान',
    labelEn: 'Education & Knowledge',
    criteria: [
      { key: 'completedEducation', labelHi: 'पूरी शिक्षा', labelEn: 'Completed education' },
      { key: 'learnsNewSkills', labelHi: 'नए कौशल सीखना', labelEn: 'Learns new skills' },
      { key: 'decisionApplication', labelHi: 'निर्णय क्षमता / ज्ञान का सही प्रयोग', labelEn: 'Sound application in decisions' },
      { key: 'knowledgeUse', labelHi: 'ज्ञान का उपयोग', labelEn: 'Uses acquired knowledge' },
      { key: 'intellectualDevelopment', labelHi: 'बौद्धिक विकास', labelEn: 'Intellectual development' }
    ]
  },
  {
    key: 'familyMarriedLife',
    labelHi: 'वैवाहिक एवं पारिवारिक जीवन',
    labelEn: 'Marital & Family Life',
    criteria: [
      { key: 'maritalLife', labelHi: 'दांपत्य जीवन', labelEn: 'Marital life' },
      { key: 'familySupport', labelHi: 'परिवार का सहयोग', labelEn: 'Family support' },
      { key: 'children', labelHi: 'संतान सुख', labelEn: 'Children' },
      { key: 'familyPeace', labelHi: 'पारिवारिक शांति', labelEn: 'Family peace' },
      { key: 'relationshipStability', labelHi: 'रिश्तों में स्थिरता', labelEn: 'Stability in relationships' }
    ]
  },
  {
    key: 'socialPrestige',
    labelHi: 'सामाजिक प्रतिष्ठा',
    labelEn: 'Social Prestige',
    criteria: [
      { key: 'socialRespect', labelHi: 'समाज में सम्मान', labelEn: 'Social respect' },
      { key: 'friendsSupport', labelHi: 'मित्रों/सहयोगियों का सहयोग', labelEn: 'Support from friends/allies' },
      { key: 'leadershipAbility', labelHi: 'नेतृत्व क्षमता', labelEn: 'Leadership ability' },
      { key: 'socialContribution', labelHi: 'सामाजिक योगदान', labelEn: 'Social contribution' },
      { key: 'goodPublicImage', labelHi: 'अच्छी छवि', labelEn: 'Good public image' }
    ]
  },
  {
    key: 'spiritualLife',
    labelHi: 'आध्यात्मिक जीवन',
    labelEn: 'Spiritual Life',
    criteria: [
      { key: 'faithInGod', labelHi: 'ईश्वर में आस्था', labelEn: 'Faith in God' },
      { key: 'meditation', labelHi: 'ध्यान/साधना', labelEn: 'Meditation practice' },
      { key: 'ethics', labelHi: 'नैतिक जीवन', labelEn: 'Ethical life' },
      { key: 'selfContentment', labelHi: 'आत्म संतोष', labelEn: 'Self-contentment' },
      { key: 'clearLifePurpose', labelHi: 'जीवन का उद्देश्य स्पष्ट', labelEn: 'Clear sense of life purpose' }
    ]
  },
  {
    key: 'lifeSatisfaction',
    labelHi: 'जीवन संतुष्टि',
    labelEn: 'Life Satisfaction',
    criteria: [
      { key: 'selfSatisfaction', labelHi: 'स्वयं से संतुष्टि', labelEn: 'Self-satisfaction' },
      { key: 'futureOptimism', labelHi: 'भविष्य के प्रति आशावाद', labelEn: 'Optimism about the future' },
      { key: 'lifeBalance', labelHi: 'जीवन संतुलन', labelEn: 'Life balance' },
      { key: 'goalAchievement', labelHi: 'लक्ष्य की प्राप्ति', labelEn: 'Goal achievement' },
      { key: 'overallHappiness', labelHi: 'समग्र खुशी', labelEn: 'Overall happiness' }
    ]
  }
];

/**
 * Computes LPI from the researcher's manual worksheet entries.
 * @param {Object} manualScores - { [domainKey]: { [criterionKey]: 0 | 2 } }
 *   Missing domains/criteria are treated as 0 (not yet filled in).
 */
function calculateLPI(manualScores) {
  const scores = manualScores || {};
  const components = {};
  const domainDetail = {};
  const reasons = {};

  LPI_DOMAINS.forEach(domain => {
    const domainScores = scores[domain.key] || {};
    let domainTotal = 0;
    const domainReasons = [];
    const criteriaDetail = domain.criteria.map(c => {
      const val = domainScores[c.key] === 2 ? 2 : 0;
      domainTotal += val;
      if (val === 0) {
        domainReasons.push({ labelHi: c.labelHi || c.label, labelEn: c.labelEn || '', pending: !!c.pending });
      }
      return { key: c.key, labelHi: c.labelHi || c.label, labelEn: c.labelEn || '', score: val, pending: !!c.pending };
    });
    components[domain.key] = domainTotal;
    if (domainTotal < 10) reasons[domain.key] = domainReasons;
    domainDetail[domain.key] = {
      labelHi: domain.labelHi || domain.label,
      labelEn: domain.labelEn || '',
      score: domainTotal,
      pending: !!domain.pending,
      criteria: criteriaDetail
    };
  });

  const rawSum = Object.values(components).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.min(90, rawSum));
  const { gradeCeiLpi } = require('./officialScoring');

  return {
    score,
    maxScore: 90,
    grade: gradeCeiLpi(score),
    detail: {
      formula: 'LPI = sum of 9 life-domain scores (5 criteria x 2 pts each), out of 90 -- entered manually by the researcher from real biographical facts, NOT derived from the chart.',
      components,
      domains: domainDetail,
      reasons,
      rawSum: score,
      maxScore: 90,
      gradingBandsUsed: '80-90 Supreme Harmony | 70-79 Good Harmony | 60-69 Average Harmony | 50-59 Energy-Loss Effect | <50 Severe Imbalance',
      accuracyNote: 'This is a direct worksheet entry, not a prediction -- accuracy depends entirely on the researcher\'s assessment of the person\'s real life.'
    }
  };
}

module.exports = { calculateLPI, LPI_DOMAINS };
