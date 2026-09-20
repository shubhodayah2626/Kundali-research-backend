const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const PDFDocument = require('pdfkit');

const { calculateCeiFromBirthDetails, calculateLpiFromAnswers, LPI_DOMAINS } = require('./scoring');
const { CEI_CONTENT, LPI_CONTENT, COMPARISON_ROWS } = require('./reportContent');

// Devanagari-capable font so Hindi labels render correctly in the PDF
// (PDFKit's built-in fonts only cover Latin script). Upload the .ttf
// to a `fonts/` folder at the repo root alongside server.js.
const DEVANAGARI_FONT_PATH = path.join(__dirname, 'fonts', 'NotoSansDevanagari-Regular.ttf');

dotenv.config();

const app = express();
app.use(cors({ exposedHeaders: ['X-Kundali-Id'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/kundali-research', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// ==================== SCHEMA (CEI + LPI only — no house scores) ====================
const kundaliSchema = new mongoose.Schema({
  name: { type: String, required: true },
  dateOfBirth: Date,
  timeOfBirth: String,
  location: { city: String, country: String },
  birthDetailsUsed: mongoose.Schema.Types.Mixed, // day/month/year/hour/min/place/lat/lon/tzone actually sent to the API
  scores: { cei: Number, lpi: Number },
  lpiAnswers: mongoose.Schema.Types.Mixed, // raw questionnaire answers { domainKey: { criterionKey: 0|2 } }, null until father fills it in
  scoringDetails: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});
const Kundali = mongoose.model('Kundali', kundaliSchema);

// ==================== GRADING (CEI + LPI share this matrix, out of 90) ====================
const CEI_LPI_GRADE_COLORS = {
  'Supreme Harmony': '#27AE60',
  'Good Harmony': '#2980B9',
  'Average Harmony': '#F39C12',
  'Energy-Loss Effect': '#E67E22',
  'Severe Imbalance': '#C0392B'
};
function gradeColor(label) { return CEI_LPI_GRADE_COLORS[label] || '#7F8C8D'; }

// ==================== BRAND PALETTE ====================
const MAROON = '#721C24';
const GOLD = '#C49A45';
const CREAM = '#FCF8E3';
const INK = '#2A2A2A';

// ==================== PDF GENERATION (24 pages: 12 CEI + 12 LPI, matching the reference documents) ====================

const PAGE_LEFT = 40;
const PAGE_WIDTH_CONTENT = 515; // A4 width 595.28 - 40 - 40 margins

/** Page chrome: gold border + small footer credit line, matching the reference PDFs' look. */
function drawPageChrome(doc) {
  doc.save();
  doc.lineWidth(1.5).strokeColor(GOLD)
    .rect(18, 18, doc.page.width - 36, doc.page.height - 36).stroke();
  doc.restore();
  // IMPORTANT: this must land well clear of the page's bottom margin
  // (margins.bottom = 30, so the printable area ends at page.height-30).
  // Too close and PDFKit's own overflow check silently opens a new
  // page to finish "flowing" this text, producing a blank page before
  // every real one. lineBreak:false keeps it to a single line.
  doc.fontSize(7).fillColor(GOLD)
    .text('ॐ पीएचडी शोध परियोजना • ब्रह्माण्डीय ऊर्जा सूचकांक / जीवन निष्पादन सूचकांक मैट्रिक्स • अनुराग मिश्रा',
      18, doc.page.height - 46, { width: doc.page.width - 36, align: 'center', lineBreak: false });
  doc.fillColor(INK);
}

function newPage(doc) {
  doc.addPage();
  doc.y = 40;
}

function drawTitle(doc, text) {
  doc.fontSize(15).fillColor(MAROON).font('Devanagari').text(text, PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT });
  doc.moveDown(0.2);
  doc.save();
  doc.strokeColor(GOLD).lineWidth(1).dash(2, { space: 2 })
    .moveTo(PAGE_LEFT, doc.y).lineTo(PAGE_LEFT + PAGE_WIDTH_CONTENT, doc.y).stroke();
  doc.undash();
  doc.restore();
  doc.moveDown(0.4);
  doc.fillColor(INK);
}

function drawParagraph(doc, text, opts = {}) {
  if (!text) return;
  doc.fontSize(opts.fontSize || 9.5).fillColor(opts.color || INK)
    .text(text, PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT, align: 'justify', lineGap: 1.5 });
  doc.moveDown(0.35);
}

function drawFormulaBox(doc, formula, note) {
  const boxY = doc.y;
  const padding = 10;
  doc.fontSize(11);
  const formulaHeight = doc.heightOfString(formula, { width: PAGE_WIDTH_CONTENT - padding * 2, align: 'center' });
  const noteHeight = note ? doc.fontSize(8.5).heightOfString(note, { width: PAGE_WIDTH_CONTENT - padding * 2, align: 'justify' }) : 0;
  const boxHeight = formulaHeight + noteHeight + padding * 2 + (note ? 8 : 0);
  doc.rect(PAGE_LEFT, boxY, PAGE_WIDTH_CONTENT, boxHeight).fill(CREAM);
  doc.fillColor(MAROON).fontSize(11).text(formula, PAGE_LEFT + padding, boxY + padding, { width: PAGE_WIDTH_CONTENT - padding * 2, align: 'center' });
  if (note) {
    doc.fillColor(INK).fontSize(8.5).text(note, PAGE_LEFT + padding, doc.y + 6, { width: PAGE_WIDTH_CONTENT - padding * 2, align: 'justify' });
  }
  doc.y = boxY + boxHeight + 10;
  doc.fillColor(INK);
}

/**
 * Draws the 3-column criteria table: criterion text | fixed column
 * (निर्धारित अंक / max) | variable column (प्राप्त अंक / obtained, or
 * EL's कटौती अंक / deduction). Row height is measured per-row so
 * wrapped Hindi text never overlaps the next row.
 */
function drawCriteriaTable(doc, { headerRow, rows, totalRow, colWidths = [315, 100, 100] }) {
  const startX = PAGE_LEFT;
  const cellPad = 6;
  const drawRow = (cells, { header = false, total = false, bg = null } = {}) => {
    doc.fontSize(header || total ? 9 : 8.5);
    const heights = cells.map((c, i) => doc.heightOfString(String(c), { width: colWidths[i] - cellPad * 2 }));
    const rowHeight = Math.max(...heights) + cellPad * 2;
    if (doc.y + rowHeight > doc.page.height - 55) { newPage(doc); doc.y = 40; }
    const y = doc.y;
    let x = startX;
    const fill = bg || (header ? GOLD : (total ? CREAM : '#FFFFFF'));
    doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill(fill).strokeColor('#DDDDDD').lineWidth(0.5).stroke();
    cells.forEach((c, i) => {
      doc.fillColor(header ? '#FFFFFF' : (total ? MAROON : INK))
        .font('Devanagari').fontSize(header || total ? 9 : 8.5)
        .text(String(c), x + cellPad, y + cellPad, { width: colWidths[i] - cellPad * 2 });
      x += colWidths[i];
    });
    doc.y = y + rowHeight;
  };

  drawRow(headerRow, { header: true });
  rows.forEach(r => drawRow(r));
  if (totalRow) drawRow(totalRow, { total: true });
  doc.moveDown(0.5);
  doc.fillColor(INK);
}

/** One CEI-factor or LPI-domain page: title, intro, criteria table with प्राप्त अंक, total, closing.
 *  answerStyle: 'yesno' shows each row's result as "हाँ / Yes (2)" or
 *  "नहीं / No (0)" instead of a bare number — used for LPI, since those
 *  are real yes/no answers a person gave, not an astrological
 *  calculation. CEI keeps the plain numeric style (unchanged) to match
 *  the father's original reference-document formatting exactly. */
function renderScorePage(doc, content, { rows, score, maxScore, columnLabel, answerStyle }) {
  newPage(doc);
  drawTitle(doc, content.title);
  drawParagraph(doc, content.intro);
  doc.moveDown(0.1);
  doc.fontSize(10).fillColor(MAROON).text('मूल्यांकन नियम एवं अंक विभाजन:', PAGE_LEFT);
  doc.fillColor(INK);
  doc.moveDown(0.2);

  // Row label: prefer the verbatim reference-document wording (content.criteria[i]),
  // falling back to the code's own labelHi only if that text is missing --
  // this is what makes the PDF's rule text match the father's original
  // document word-for-word, while the score itself still comes from the
  // actual computed pass/fail in officialScoring.js / lpiEngine.js.
  const formatCell = r => {
    if (r.pending) return 'लंबित (Pending)';
    if (answerStyle === 'yesno') return r.score === 2 ? 'हाँ / Yes (2)' : 'नहीं / No (0)';
    return String(r.score);
  };
  const tableRows = rows.map((r, i) => {
    const verbatim = content.criteria && content.criteria[i];
    const label = verbatim || r.label;
    return [label, '2', formatCell(r)];
  });
  const totalLabel = `कुल अधिकतम प्राप्तांक (Total Score)`;
  drawCriteriaTable(doc, {
    headerRow: ['मूल्यांकन के नियम', 'निर्धारित अंक', columnLabel || 'प्राप्त अंक'],
    rows: tableRows,
    totalRow: [totalLabel, String(maxScore), score == null ? 'लंबित' : String(score)]
  });

  drawParagraph(doc, content.closing);
}

/** EL page: dosha-by-dosha deduction table (inverse sense: 2 = deducted when the dosha IS present). */
function renderELPage(doc, content, { rows, EL }) {
  newPage(doc);
  drawTitle(doc, content.title);
  drawParagraph(doc, content.intro);
  doc.moveDown(0.1);
  doc.fontSize(10).fillColor(MAROON).text('दोषों के आधार पर अंक कटौती:', PAGE_LEFT);
  doc.fillColor(INK);
  doc.moveDown(0.2);

  const tableRows = rows.map(r => [r.label, r.deduction ? 'उपस्थित (Present)' : 'अनुपस्थित (Absent)', `−${r.deduction}`]);
  drawCriteriaTable(doc, {
    headerRow: ['दोष (Dosha)', 'स्थिति', 'कटौती अंक'],
    rows: tableRows,
    totalRow: ['कुल ऊर्जा हानि (Total Energy Loss)', '', `−${EL}`],
    colWidths: [255, 160, 100]
  });

  drawParagraph(doc, content.closing);
}

function renderCoverPage(doc, content, headerInfo) {
  // First page of a section reuses the current page (no explicit addPage) if called right after doc creation;
  // callers pass a flag via headerInfo.isFirst to control this. Chrome for that first page is already
  // drawn once in generateCeiLpiPdf, and every later page gets it automatically via the 'pageAdded' listener.
  if (!headerInfo || !headerInfo.isFirst) newPage(doc);
  doc.y = 60;
  doc.fontSize(20).fillColor(MAROON).font('Devanagari').text(content.title, PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT, align: 'center' });
  doc.moveDown(0.3);
  if (content.subtitle) {
    doc.fontSize(10.5).fillColor(INK).text(content.subtitle, PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT, align: 'center' });
    doc.moveDown(0.5);
  }
  doc.save();
  doc.strokeColor(GOLD).lineWidth(1).moveTo(PAGE_LEFT, doc.y).lineTo(PAGE_LEFT + PAGE_WIDTH_CONTENT, doc.y).stroke();
  doc.restore();
  doc.moveDown(0.5);

  if (headerInfo && headerInfo.name) {
    doc.fontSize(11).fillColor(MAROON).text(`${headerInfo.name} — रिपोर्ट`, { align: 'center' });
    doc.fontSize(9).fillColor(INK).text(
      `DOB: ${headerInfo.dobStr}   |   Time: ${headerInfo.timeOfBirth || 'N/A'}   |   Place: ${headerInfo.place || 'N/A'}`,
      { align: 'center' }
    );
    doc.moveDown(0.6);
  }

  drawParagraph(doc, content.intro);
  if (content.formula) {
    doc.moveDown(0.2);
    drawFormulaBox(doc, content.formula, content.formulaNote);
  }
}

function renderComparisonPage(doc, content, rows) {
  newPage(doc);
  drawTitle(doc, content.title);
  drawParagraph(doc, content.intro);
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor(MAROON).text('सूचकांकों के तुलनात्मक प्राप्तांकों का मानक मैट्रिक्स:', PAGE_LEFT);
  doc.fillColor(INK);
  doc.moveDown(0.2);
  drawCriteriaTable(doc, {
    headerRow: rows[0],
    rows: rows.slice(1),
    colWidths: [90, 90, 335]
  });
}

function renderConclusionPage(doc, content, summaryLine) {
  newPage(doc);
  drawTitle(doc, content.title);
  if (content.formula) drawFormulaBox(doc, content.formula, null);
  if (content.intro) drawParagraph(doc, content.intro);
  drawParagraph(doc, content.closing);
  if (summaryLine) {
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor(summaryLine.color || MAROON).text(summaryLine.text, PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT, align: 'center' });
  }
}

const CEI_FACTOR_ORDER = ['L', 'S', 'M', 'SB', 'AV', 'N', 'D9', 'H', 'P'];
const LPI_DOMAIN_ORDER = LPI_DOMAINS.map(d => d.key);

/**
 * Streams the combined 24-page CEI + LPI PDF (12 CEI pages + 12 LPI
 * pages), matching the reference documents' layout: cover, one page
 * per factor/domain with a प्राप्त अंक (marks obtained) column added
 * next to the existing निर्धारित अंक column, EL/comparison page, and
 * a conclusion page for each half.
 */
function generateCeiLpiPdf(res, { name, dateOfBirth, timeOfBirth, location, scores, scoringDetails }) {
  const doc = new PDFDocument({ bufferPages: true, size: 'A4', compress: true, margins: { top: 30, bottom: 30, left: 40, right: 40 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-CEI-LPI-Report.pdf"`);
  doc.pipe(res);

  try {
    doc.registerFont('Devanagari', DEVANAGARI_FONT_PATH);
    doc.font('Devanagari');
  } catch (fontErr) {
    console.error('Devanagari font not found, falling back to default font (Hindi text will be garbled):', fontErr.message);
  }

  // Draw the border + footer on EVERY page, including ones PDFKit adds
  // on its own (e.g. a long closing paragraph overflowing a page) --
  // not just pages created via our explicit newPage() helper.
  doc.on('pageAdded', () => drawPageChrome(doc));
  drawPageChrome(doc); // the very first page doesn't fire 'pageAdded'

  const sd = scoringDetails || {};
  const ceiGrade = sd.ceiGrade || null;
  const lpiGrade = sd.lpiGrade || null;
  const dobStr = dateOfBirth ? new Date(dateOfBirth).toLocaleDateString() : 'N/A';
  const headerInfo = { isFirst: true, name, dobStr, timeOfBirth, place: location && location.city };

  // ================= CEI: 12 pages =================
  renderCoverPage(doc, CEI_CONTENT.cover, headerInfo);

  const ceiComponents = (sd.cei && sd.cei.components) || {};
  const ceiCriteriaByFactor = (sd.cei && sd.cei.criteriaByFactor) || {};
  CEI_FACTOR_ORDER.forEach(key => {
    const content = CEI_CONTENT[key];
    const criteria = ceiCriteriaByFactor[key] || [];
    const rows = criteria.map(c => ({ label: c.labelHi || c.labelEn, score: c.score, pending: c.pending }));
    renderScorePage(doc, content, { rows, score: ceiComponents[key], maxScore: 10, columnLabel: 'प्राप्त अंक' });
  });

  const elCriteria = ceiCriteriaByFactor.EL || [];
  renderELPage(doc, CEI_CONTENT.EL, {
    rows: elCriteria.map(c => ({ label: c.labelHi || c.labelEn, deduction: c.deduction })),
    EL: sd.cei ? sd.cei.EL : 0
  });

  renderConclusionPage(doc, CEI_CONTENT.conclusion, {
    text: `CEI: ${scores.cei ?? 'N/A'}/90 — ${ceiGrade || 'N/A'}`,
    color: gradeColor(ceiGrade)
  });

  // ================= LPI: 12 pages =================
  renderCoverPage(doc, LPI_CONTENT.cover, { isFirst: false, name, dobStr, timeOfBirth, place: location && location.city });

  const lpiDomains = (sd.lpi && sd.lpi.domains) || {};
  LPI_DOMAIN_ORDER.forEach(key => {
    const content = LPI_CONTENT[key];
    const domain = lpiDomains[key];
    const rows = domain ? domain.criteria.map(c => ({ label: c.labelHi || c.labelEn, score: c.score, pending: c.pending })) : [];
    const score = domain ? domain.score : null;
    renderScorePage(doc, content, { rows, score, maxScore: 10, columnLabel: 'उत्तर (Answer)', answerStyle: 'yesno' });
  });

  renderComparisonPage(doc, LPI_CONTENT.comparison, COMPARISON_ROWS);

  renderConclusionPage(doc, LPI_CONTENT.conclusion, {
    text: `LPI: ${scores.lpi ?? 'लंबित (Pending)'}${scores.lpi != null ? '/90' : ''} — ${lpiGrade || (scores.lpi == null ? 'प्रश्नावली लंबित' : 'N/A')}`,
    color: gradeColor(lpiGrade)
  });

  // ---- Variability disclaimer (final line of the document) ----
  doc.moveDown(0.6);
  doc.fontSize(7.5).fillColor('#777777');
  doc.text(
    'नोट: CEI पूर्णतः जन्म कुंडली से निकाला जाता है, इसलिए यह किसी भी शोधकर्ता द्वारा भरने पर नहीं बदलता। LPI शोधकर्ता के व्यक्तिगत आकलन पर आधारित है, इसलिए भरने वाले व्यक्ति के अनुसार इसमें लगभग 10% तक का अंतर आ सकता है।',
    { width: PAGE_WIDTH_CONTENT }
  );
  doc.fillColor(INK);

  doc.end();
}

/** Splits a "YYYY-MM-DD" date string and "HH:MM" time string into the day/month/year/hour/min integers the API needs. */
function splitDateTime(dateOfBirth, timeOfBirth) {
  const [year, month, day] = String(dateOfBirth).split('-').map(Number);
  const [hour, min] = String(timeOfBirth || '00:00').split(':').map(Number);
  return { day, month, year, hour, min };
}

// ==================== ROUTES ====================

/**
 * MAIN FLOW: father submits name + date/time/place of birth -> this
 * resolves the location, calls AstrologyAPI.com for real planetary
 * positions/Shadbala/Ashtakvarga/Bhava Bala, computes CEI + LPI, and
 * streams the single combined PDF directly as the response -> browser
 * downloads it immediately. No separate "results page" click needed.
 * Also saves a record in the background (non-blocking) for history.
 */
app.post('/api/kundali/generate', async (req, res) => {
  try {
    const { name, dateOfBirth, timeOfBirth, location } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!dateOfBirth) return res.status(400).json({ error: 'Date of birth is required' });
    if (!timeOfBirth) return res.status(400).json({ error: 'Time of birth is required' });
    if (!location || !location.city) return res.status(400).json({ error: 'Place of birth (city) is required' });

    const { day, month, year, hour, min } = splitDateTime(dateOfBirth, timeOfBirth);
    const birthDetails = { day, month, year, hour, min, place: location.city };

    // CEI only -- LPI is filled in separately via the questionnaire, since it can't come from the chart.
    const { scores, scoringDetails } = await calculateCeiFromBirthDetails(birthDetails);

    const record = new Kundali({
      name, dateOfBirth: dateOfBirth || null, timeOfBirth: timeOfBirth || null,
      location: location || {}, birthDetailsUsed: birthDetails, scores, scoringDetails, lpiAnswers: null
    });
    await record.save();

    // IMPORTANT: response body stays a raw PDF (same contract as before) so the
    // existing frontend keeps working with ZERO changes. The saved record's ID
    // is passed via a response header instead, for the LPI-questionnaire flow
    // to pick up later without breaking this download.
    res.setHeader('X-Kundali-Id', record._id.toString());
    generateCeiLpiPdf(res, { name, dateOfBirth, timeOfBirth, location, scores, scoringDetails });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Returns the LPI question list (domains + criteria labels) for the frontend
// questionnaire form to render. No scores here -- just the structure.
app.get('/api/lpi-questions', (req, res) => {
  res.json({ domains: LPI_DOMAINS });
});

// Submit the researcher's filled-in LPI questionnaire for a given Kundali.
// Body: { answers: { domainKey: { criterionKey: 0|2, ... }, ... } }
app.post('/api/kundali/:id/lpi', async (req, res) => {
  try {
    const k = await Kundali.findById(req.params.id);
    if (!k) return res.status(404).json({ error: 'Kundali not found' });

    const { answers } = req.body;
    if (!answers) return res.status(400).json({ error: 'answers is required' });

    const lpi = calculateLpiFromAnswers(answers);

    k.lpiAnswers = answers;
    k.scores.lpi = lpi.score;
    k.scoringDetails.lpi = lpi.detail;
    k.scoringDetails.lpiGrade = lpi.grade;
    k.scoringDetails.lpiMaxScore = lpi.maxScore;
    // scoringDetails is a Mongoose "Mixed" type, so mutating just one of
    // its nested properties (scoringDetails.lpi, above) does NOT get
    // auto-detected as a change — Mongoose only tracks Mixed fields by
    // reference, not by deep comparison. Without this line, k.save()
    // below silently writes nothing for this update: the LPI answers
    // score correctly in memory and in this response, but the database
    // keeps the old (pre-LPI) scoringDetails, so a PDF fetched moments
    // later would still show every question as pending.
    k.markModified('scoringDetails');
    await k.save();

    res.json({ id: k._id, scores: k.scores, lpiDetail: lpi.detail });
  } catch (error) {
    console.error('LPI submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download the combined PDF (CEI always present; LPI section shows
// "pending" until the questionnaire above has been submitted).
app.get('/api/kundali/:id/pdf', async (req, res) => {
  try {
    const k = await Kundali.findById(req.params.id);
    if (!k) return res.status(404).json({ error: 'Kundali not found' });
    generateCeiLpiPdf(res, k);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List saved records (name + scores only, for a history view if needed)
app.get('/api/kundalis', async (req, res) => {
  try {
    const list = await Kundali.find().sort({ createdAt: -1 }).select('name dateOfBirth scores createdAt');
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/kundali/:id', async (req, res) => {
  try {
    const deleted = await Kundali.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Kundali not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Kundali CEI/LPI Backend running on http://localhost:${PORT}`);
});

module.exports = app;
