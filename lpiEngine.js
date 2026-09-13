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
 * TODO (pending father's clarification -- do not treat as final):
 *  - "Life Satisfaction" domain's 5 criteria are still unconfirmed.
 *    What father dictated under this label the first time turned out
 *    to be word-for-word identical to what he later confirmed, a
 *    second time, as "Mental Health" -- so this domain's real,
 *    distinct criteria have not actually been given yet.
 *  - Career's 5th criterion (of 5) was lost in a garbled recording.
 *    Only 4 are confirmed: job/business stability, promotion/growth,
 *    income continuity, professional prestige.
 * Both are marked with `pending: true` below so the frontend/PDF can
 * flag them visually until father confirms the real wording.
 */

/**
 * 9 LPI domains with their real criteria, as dictated by father.
 * Each criterion is worth 0 or 2 points; 5 criteria x 2 = 10 per domain.
 */
const LPI_DOMAINS = [
  {
    key: 'physicalHealth',
    label: 'शारीरिक स्वास्थ्य (Physical Health)',
    criteria: [
      { key: 'noIllness5yr', label: 'पिछले 5 वर्षों में कोई गंभीर बीमारी नहीं (No serious illness in last 5 years)' },
      { key: 'normalWeight', label: 'सामान्य वज़न (Normal weight)' },
      { key: 'regularEnergy', label: 'नियमित ऊर्जा / सक्रियता (Regular energy / active)' },
      { key: 'goodSleep', label: 'अच्छी नींद (Good sleep)' },
      { key: 'regularExercise', label: 'नियमित व्यायाम (Regular exercise)' }
    ]
  },
  {
    key: 'mentalHealth',
    label: 'मानसिक स्वास्थ्य (Mental Health)',
    criteria: [
      { key: 'stressControl', label: 'तनाव नियंत्रण अच्छा (Good stress control)' },
      { key: 'decisionMaking', label: 'निर्णय क्षमता अच्छी (Good decision-making ability)' },
      { key: 'confidence', label: 'आत्मविश्वास अच्छा (Good self-confidence)' },
      { key: 'angerControl', label: 'क्रोध नियंत्रण (Anger control)' },
      { key: 'noDepression', label: 'कोई अवसाद/चिंता नहीं (No depression/anxiety)' }
    ]
  },
  {
    key: 'financialStatus',
    label: 'आर्थिक स्थिति (Financial Status)',
    criteria: [
      { key: 'regularIncome', label: 'नियमित आय (Regular income)' },
      { key: 'savings', label: 'बचत (Savings)' },
      { key: 'debtControl', label: 'ऋण नियंत्रण (Debt control)' },
      { key: 'wealthBuilding', label: 'संपत्ति निर्माण (Wealth-building)' },
      { key: 'financialStability', label: 'आर्थिक स्थिरता (Financial stability)' }
    ]
  },
  {
    key: 'career',
    label: 'करियर (Career)',
    criteria: [
      { key: 'jobBusinessStability', label: 'नौकरी/व्यवसाय स्थिरता (Job/business stability)' },
      { key: 'promotionGrowth', label: 'पदोन्नति/विकास (Promotion/growth)' },
      { key: 'incomeContinuity', label: 'आय निरंतरता (Income continuity)' },
      { key: 'professionalPrestige', label: 'व्यावसायिक प्रतिष्ठा (Professional prestige)' },
      { key: 'careerCriterion5', label: '(पापा से पुष्टि लंबित -- 5वां criterion) [PENDING confirmation]', pending: true }
    ]
  },
  {
    key: 'education',
    label: 'शिक्षा एवं ज्ञान (Education & Knowledge)',
    criteria: [
      { key: 'completedEducation', label: 'पूरी शिक्षा (Completed education)' },
      { key: 'learnsNewSkills', label: 'नए कौशल सीखना (Learns new skills)' },
      { key: 'decisionApplication', label: 'निर्णय क्षमता / ज्ञान का सही प्रयोग (Sound application in decisions)' },
      { key: 'knowledgeUse', label: 'ज्ञान का उपयोग (Uses acquired knowledge)' },
      { key: 'intellectualDevelopment', label: 'बौद्धिक विकास (Intellectual development)' }
    ]
  },
  {
    key: 'familyMarriedLife',
    label: 'वैवाहिक एवं पारिवारिक जीवन (Marital & Family Life)',
    criteria: [
      { key: 'maritalLife', label: 'दांपत्य जीवन (Marital life)' },
      { key: 'familySupport', label: 'परिवार का सहयोग (Family support)' },
      { key: 'children', label: 'संतान सुख (Children)' },
      { key: 'familyPeace', label: 'पारिवारिक शांति (Family peace)' },
      { key: 'relationshipStability', label: 'रिश्तों में स्थिरता (Stability in relationships)' }
    ]
  },
  {
    key: 'socialPrestige',
    label: 'सामाजिक प्रतिष्ठा (Social Prestige)',
    criteria: [
      { key: 'socialRespect', label: 'समाज में सम्मान (Social respect)' },
      { key: 'friendsSupport', label: 'मित्रों/सहयोगियों का सहयोग (Support from friends/allies)' },
      { key: 'leadershipAbility', label: 'नेतृत्व क्षमता (Leadership ability)' },
      { key: 'socialContribution', label: 'सामाजिक योगदान (Social contribution)' },
      { key: 'goodPublicImage', label: 'अच्छी छवि (Good public image)' }
    ]
  },
  {
    key: 'spiritualLife',
    label: 'आध्यात्मिक जीवन (Spiritual Life)',
    criteria: [
      { key: 'faithInGod', label: 'ईश्वर में आस्था (Faith in God)' },
      { key: 'meditation', label: 'ध्यान/साधना (Meditation practice)' },
      { key: 'ethics', label: 'नैतिक जीवन (Ethical life)' },
      { key: 'selfContentment', label: 'आत्म संतोष (Self-contentment)' },
      { key: 'clearLifePurpose', label: 'जीवन का उद्देश्य स्पष्ट (Clear sense of life purpose)' }
    ]
  },
  {
    key: 'lifeSatisfaction',
    label: 'जीवन संतुष्टि (Life Satisfaction)',
    pending: true, // ENTIRE DOMAIN pending -- see TODO note at top of file
    criteria: [
      { key: 'lifeSatisfaction1', label: '(पापा से पुष्टि लंबित) [PENDING -- distinct from Mental Health]', pending: true },
      { key: 'lifeSatisfaction2', label: '(पापा से पुष्टि लंबित) [PENDING]', pending: true },
      { key: 'lifeSatisfaction3', label: '(पापा से पुष्टि लंबित) [PENDING]', pending: true },
      { key: 'lifeSatisfaction4', label: '(पापा से पुष्टि लंबित) [PENDING]', pending: true },
      { key: 'lifeSatisfaction5', label: '(पापा से पुष्टि लंबित) [PENDING]', pending: true }
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

  LPI_DOMAINS.forEach(domain => {
    const domainScores = scores[domain.key] || {};
    let domainTotal = 0;
    const criteriaDetail = domain.criteria.map(c => {
      const val = domainScores[c.key] === 2 ? 2 : 0;
      domainTotal += val;
      return { key: c.key, label: c.label, score: val, pending: !!c.pending };
    });
    components[domain.key] = domainTotal;
    domainDetail[domain.key] = {
      label: domain.label,
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
      rawSum: score,
      maxScore: 90,
      gradingBandsUsed: '80-90 Supreme Harmony | 70-79 Good Harmony | 60-69 Average Harmony | 50-59 Energy-Loss Effect | <50 Severe Imbalance',
      accuracyNote: 'This is a direct worksheet entry, not a prediction -- accuracy depends entirely on the researcher\'s assessment of the person\'s real life.'
    }
  };
}

module.exports = { calculateLPI, LPI_DOMAINS };
