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

// Shubhodayah logo (report cover) and small emblem (top-right of every
// other page). Upload both PNGs to the repo's main folder, next to
// server.js. If they are missing the report still generates, just
// without the logo.
const fs = require('fs');
const REPORT_LOGO_PATH = path.join(__dirname, 'report-logo.png');
const REPORT_EMBLEM_PATH = path.join(__dirname, 'report-emblem.png');
const HAS_LOGO = fs.existsSync(REPORT_LOGO_PATH);
const HAS_EMBLEM = fs.existsSync(REPORT_EMBLEM_PATH);

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

// ==================== PDF GENERATION (2 CEI summary pages + 10 LPI pages + 1 final page) ====================

const PAGE_LEFT = 40;
const PAGE_WIDTH_CONTENT = 515; // A4 width 595.28 - 40 - 40 margins

/** Page chrome: gold border + small footer credit line, matching the reference PDFs' look. */
function drawPageChrome(doc, { isCover = false } = {}) {
  doc.save();
  doc.lineWidth(1.5).strokeColor(GOLD)
    .rect(18, 18, doc.page.width - 36, doc.page.height - 36).stroke();
  doc.restore();
  if (HAS_EMBLEM && !isCover) {
    try { doc.image(REPORT_EMBLEM_PATH, doc.page.width - 26 - 36, 24, { width: 36 }); } catch (e) { /* no logo → no problem */ }
  }
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

// ==================== SUMMARY-STYLE CEI + RANGE CHARTS ====================
// The CEI section shows only the marks for each of the 9 pillars (bar
// chart + table), the solved formula, the final score and its range —
// NOT the rule-by-rule working, so the scoring method can't be copied.
// CEI and LPI each get their own 8-range classification chart, so every
// combination of scores is explained (the old combined CEI/LPI matrix
// only worked when both scores fell in the same range).

const CEI_FACTOR_NAMES = {
  L: 'लग्न', S: 'सूर्य', M: 'चंद्र', SB: 'षड्बल', AV: 'अष्टकवर्ग',
  N: 'नक्षत्र', D9: 'नवांश', H: 'शरीर एवं 12 भाव', P: 'पंचमहाभूत'
};
const BAND_COLORS = ['#2E7D32', '#558B2F', '#9E9D24', '#C49A45', '#E08A3C', '#D35400', '#B03A2E', '#8E1B1B'];
const BAND_RANGES = [['80 – 90', 80, 90], ['70 – 79', 70, 79], ['60 – 69', 60, 69], ['50 – 59', 50, 59],
                     ['40 – 49', 40, 49], ['30 – 39', 30, 39], ['20 – 29', 20, 29], ['20 से कम', -999, 19]];
const CEI_BANDS = [
  ['सर्वोच्च ब्रह्माण्डीय ऊर्जा', 'जन्म कुंडली ब्रह्माण्डीय ऊर्जा के साथ अत्यंत सुदृढ़ रूप से संरेखित है। प्राणिक ऊर्जा का प्रवाह उच्चतम स्तर पर है।'],
  ['उत्तम ऊर्जा', 'ऊर्जा संरचना मजबूत और संतुलित है। छोटे-मोटे अवरोध सहज रूप से दूर हो जाते हैं।'],
  ['अच्छी ऊर्जा', 'ऊर्जा का आधार अच्छा है। कुछ स्तंभों को सुदृढ़ करने से और बेहतर परिणाम संभव हैं।'],
  ['ऊर्जा ह्रास का प्रभाव', 'ऊर्जा मध्यम स्तर पर है। कुछ क्षेत्रों में ऊर्जा का क्षय दिखाई देता है, जिसके लिए संतुलन के उपाय सहायक होंगे।'],
  ['कमजोर ऊर्जा', 'कई ऊर्जा स्तंभ कमजोर हैं। थकान, अवरोध और अस्थिरता संभव है; नियमित साधना और उपाय आवश्यक हैं।'],
  ['अल्प ऊर्जा', 'ब्रह्माण्डीय ऊर्जा को ग्रहण करने की क्षमता कम है। उपचारात्मक उपाय और ऊर्जा हीलिंग की आवश्यकता है।'],
  ['गंभीर ऊर्जा अवरोध', 'आंतरिक प्राणशक्ति में गहरा अवरोध है। शीघ्र ऊर्जा हीलिंग और विशेषज्ञ परामर्श की आवश्यकता है।'],
  ['अत्यंत गंभीर असंतुलन', 'ऊर्जा तंत्र गंभीर रूप से असंतुलित है। तत्काल ऊर्जा हीलिंग और उपचारात्मक उपाय अनिवार्य हैं।']
];
const LPI_BANDS = [
  ['उत्कृष्ट जीवन निष्पादन', 'जीवन के लगभग सभी आयामों — स्वास्थ्य, धन, करियर, संबंध और अध्यात्म — में उत्कृष्ट संतुलन और सफलता है।'],
  ['बहुत अच्छा जीवन निष्पादन', 'अधिकांश आयामों में सफलता और संतुलन है। कुछ क्षेत्रों में थोड़ा सुधार जीवन को पूर्णता देगा।'],
  ['अच्छा जीवन निष्पादन', 'जीवन सामान्य रूप से प्रगतिशील है, परंतु कुछ आयामों पर ध्यान देने की आवश्यकता है।'],
  ['औसत जीवन निष्पादन', 'कई आयामों में असंतुलन है। स्वास्थ्य, करियर या संबंधों में से कुछ क्षेत्र सुधार की मांग करते हैं।'],
  ['औसत से कम', 'जीवन के कई क्षेत्रों में संघर्ष है। सचेत प्रयास, दिनचर्या में सुधार और मार्गदर्शन की आवश्यकता है।'],
  ['कमजोर जीवन निष्पादन', 'अधिकांश आयामों में कठिनाइयाँ हैं। जीवनशैली में बड़े परिवर्तन और नियमित मार्गदर्शन आवश्यक है।'],
  ['गंभीर असंतुलन', 'जीवन अनेक संकटों और अभावों से घिरा है। शीघ्र परामर्श और उपचारात्मक उपायों की आवश्यकता है।'],
  ['अत्यंत गंभीर स्थिति', 'जीवन के लगभग सभी क्षेत्र प्रभावित हैं। तत्काल विशेषज्ञ परामर्श और समग्र उपचार अनिवार्य है।']
];
function bandIndex(score) {
  if (score == null || isNaN(score)) return -1;
  const s = Math.round(Number(score));
  return BAND_RANGES.findIndex(r => s >= r[1] && s <= r[2]);
}
const PAGE_BOTTOM_LIMIT = 787; // stay clear of the footer line

function ensureSpace(doc, needed) {
  if (doc.y + needed > PAGE_BOTTOM_LIMIT) newPage(doc);
}

/** Small section heading in the report's accent colour. */
function drawHeading(doc, text) {
  ensureSpace(doc, 30);
  doc.fontSize(11.5).fillColor('#B0522B').text(text, PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT });
  doc.moveDown(0.3);
  doc.fillColor(INK);
}

/** Horizontal bar per CEI pillar: code + Hindi name | bar | "4/10". */
function drawPillarBars(doc, components) {
  const labelW = 130, valueW = 44, gap = 10, barH = 11, rowH = 21;
  const barX = PAGE_LEFT + labelW + gap, barW = PAGE_WIDTH_CONTENT - labelW - valueW - gap * 2;
  ensureSpace(doc, rowH * CEI_FACTOR_ORDER.length);
  CEI_FACTOR_ORDER.forEach(key => {
    const v = components[key];
    const val = (v == null || isNaN(v)) ? 0 : Math.max(0, Math.min(10, Number(v)));
    const y = doc.y;
    doc.fontSize(9.5).fillColor(MAROON).text(key, PAGE_LEFT, y, { width: 28, lineBreak: false });
    doc.fillColor(INK).text(CEI_FACTOR_NAMES[key], PAGE_LEFT + 28, y, { width: labelW - 28, lineBreak: false });
    const by = y + 3;
    doc.roundedRect(barX, by, barW, barH, barH / 2).fill('#F3EAD6');
    if (val > 0) doc.roundedRect(barX, by, Math.max(barH, barW * val / 10), barH, barH / 2).fill(GOLD);
    doc.fontSize(11).fillColor(MAROON).text(v == null ? '—' : String(v), barX + barW + gap, y - 1, { width: 22, align: 'right', lineBreak: false });
    doc.fontSize(8).fillColor('#888888').text('/10', barX + barW + gap + 23, y + 2, { width: 22, lineBreak: false });
    doc.y = y + rowH;
  });
  doc.x = PAGE_LEFT;
  doc.fillColor(INK);
}

/** Cream box with the formula (small) and the solved formula (large). */
function drawSolvedFormula(doc, formula, solved) {
  const pad = 10, w = PAGE_WIDTH_CONTENT;
  doc.fontSize(9);
  const h1 = doc.heightOfString(formula, { width: w - pad * 2, align: 'center' });
  doc.fontSize(12.5);
  const h2 = doc.heightOfString(solved, { width: w - pad * 2, align: 'center' });
  const boxH = h1 + h2 + pad * 2 + 4;
  ensureSpace(doc, boxH + 10);
  const y = doc.y;
  doc.roundedRect(PAGE_LEFT, y, w, boxH, 5).fillAndStroke(CREAM, '#E8D3A2');
  doc.fillColor('#555555').fontSize(9).text(formula, PAGE_LEFT + pad, y + pad, { width: w - pad * 2, align: 'center' });
  doc.fillColor(MAROON).fontSize(12.5).text(solved, PAGE_LEFT + pad, doc.y + 4, { width: w - pad * 2, align: 'center' });
  doc.y = y + boxH + 12;
  doc.fillColor(INK);
}

/** Score ring (arc proportional to score/90) + category text beside it. */
function drawScoreRing(doc, score, bandIdx, catText) {
  const r = 34, ringW = 8, blockH = r * 2 + 8;
  ensureSpace(doc, blockH + 6);
  const cx = PAGE_LEFT + PAGE_WIDTH_CONTENT / 2 - 70, cy = doc.y + r + 2;
  const color = bandIdx >= 0 ? BAND_COLORS[bandIdx] : '#999999';
  doc.save();
  doc.lineWidth(ringW).strokeColor('#F1E6CF').circle(cx, cy, r).stroke();
  const frac = Math.max(0, Math.min(0.9999, (Number(score) || 0) / 90));
  if (frac > 0) {
    const a = frac * 2 * Math.PI;
    const x = cx + r * Math.sin(a), y = cy - r * Math.cos(a);
    doc.path(`M ${cx} ${cy - r} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x} ${y}`).lineWidth(ringW).strokeColor(color).stroke();
  }
  doc.restore();
  doc.fontSize(20).fillColor(MAROON).text(score == null ? '—' : String(score), cx - r, cy - 16, { width: r * 2, align: 'center', lineBreak: false });
  doc.fontSize(8).fillColor('#888888').text('/ 90', cx - r, cy + 8, { width: r * 2, align: 'center', lineBreak: false });
  const tx = cx + r + 22;
  doc.fontSize(8.5).fillColor('#888888').text('वर्गीकरण', tx, cy - 26, { width: 230, lineBreak: false });
  doc.fontSize(14).fillColor(color).text(catText, tx, cy - 13, { width: 240, lineBreak: false });
  if (bandIdx >= 0) doc.fontSize(8.5).fillColor('#888888').text(`(${BAND_RANGES[bandIdx][0]})`, tx, cy + 8, { width: 230, lineBreak: false });
  doc.x = PAGE_LEFT;
  doc.y = cy + r + 14;
  doc.fillColor(INK);
}

/** 8-range classification chart (range | category | meaning), the person's range highlighted. */
function drawBandChart(doc, title, bands, bandIdx) {
  drawHeading(doc, title);
  const cols = [70, 125, 320], pad = 5, x0 = PAGE_LEFT;
  const header = ['अंक सीमा', 'श्रेणी', 'अर्थ'];
  // header
  doc.fontSize(8.5);
  let hH = 18;
  ensureSpace(doc, hH + 30);
  let y = doc.y;
  doc.rect(x0, y, PAGE_WIDTH_CONTENT, hH).fill(GOLD);
  let x = x0;
  header.forEach((t, i) => { doc.fillColor('#FFFFFF').text(t, x + pad, y + 4, { width: cols[i] - pad * 2, lineBreak: false }); x += cols[i]; });
  doc.y = y + hH;
  bands.forEach((b, i) => {
    const hit = i === bandIdx;
    const catLabel = b[0] + (hit ? '  (आप यहाँ)' : '');
    doc.fontSize(8.3);
    const h = Math.max(
      doc.heightOfString(catLabel, { width: cols[1] - pad * 2 }),
      doc.heightOfString(b[1], { width: cols[2] - pad * 2 })
    ) + pad * 2;
    ensureSpace(doc, h);
    y = doc.y;
    doc.rect(x0, y, PAGE_WIDTH_CONTENT, h).fill(hit ? '#FFF3D6' : '#FFFFFF');
    doc.save().lineWidth(hit ? 1.2 : 0.5).strokeColor(hit ? BAND_COLORS[i] : '#EFE5CF')
      .moveTo(x0, y + h).lineTo(x0 + PAGE_WIDTH_CONTENT, y + h).stroke().restore();
    if (hit) doc.save().lineWidth(1.2).strokeColor(BAND_COLORS[i]).moveTo(x0, y).lineTo(x0 + PAGE_WIDTH_CONTENT, y).stroke().restore();
    doc.circle(x0 + pad + 3.5, y + pad + 5.5, 3.2).fill(BAND_COLORS[i]);
    doc.fillColor(INK).fontSize(8.3).text(BAND_RANGES[i][0], x0 + pad + 10, y + pad, { width: cols[0] - pad * 2 - 10, lineBreak: false });
    doc.fillColor(hit ? BAND_COLORS[i] : '#5A4630').text(catLabel, x0 + cols[0] + pad, y + pad, { width: cols[1] - pad * 2 });
    doc.fillColor(INK).text(b[1], x0 + cols[0] + cols[1] + pad, y + pad, { width: cols[2] - pad * 2 });
    doc.y = y + h;
  });
  doc.x = PAGE_LEFT;
  doc.moveDown(0.6);
  doc.fillColor(INK);
}

/** CEI page 1: logo, title, name, intro, formula box, 9-pillar bar chart. */
function renderCeiSummaryCover(doc, content, headerInfo, components) {
  doc.y = 34;
  if (HAS_LOGO) {
    const logoY = doc.y, logoW = 118, logoH = logoW * (1130 / 1214);
    try { doc.image(REPORT_LOGO_PATH, (doc.page.width - logoW) / 2, logoY, { width: logoW }); doc.y = logoY + logoH + 4; } catch (e) { doc.y = 60; }
  } else doc.y = 60;
  doc.fontSize(19).fillColor(MAROON).font('Devanagari').text(content.title, PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT, align: 'center' });
  if (content.subtitle) doc.fontSize(10).fillColor(INK).text(content.subtitle, PAGE_LEFT, doc.y + 2, { width: PAGE_WIDTH_CONTENT, align: 'center' });
  doc.moveDown(0.4);
  doc.save().strokeColor(GOLD).lineWidth(1).moveTo(PAGE_LEFT, doc.y).lineTo(PAGE_LEFT + PAGE_WIDTH_CONTENT, doc.y).stroke().restore();
  doc.moveDown(0.4);
  if (headerInfo && headerInfo.name) {
    doc.fontSize(11).fillColor(MAROON).text(`${headerInfo.name} — रिपोर्ट`, PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT, align: 'center' });
    doc.fontSize(9).fillColor(INK).text(
      `DOB: ${headerInfo.dobStr}   |   Time: ${headerInfo.timeOfBirth || 'N/A'}   |   Place: ${headerInfo.place || 'N/A'}`,
      PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT, align: 'center' });
    doc.moveDown(0.5);
  }
  drawParagraph(doc, content.intro, { fontSize: 9 });
  if (content.formula) drawFormulaBox(doc, content.formula, content.formulaNote);
  drawHeading(doc, 'नौ ऊर्जा स्तंभ — प्राप्त अंक');
  drawPillarBars(doc, components);
}

/** CEI page 2: marks table, solved formula, score ring, CEI range chart. */
function renderCeiResultPage(doc, conclusionContent, { components, EL, cei }) {
  newPage(doc);
  drawTitle(doc, conclusionContent.title || 'कॉस्मिक ऊर्जा सूचकांक (CEI) : अंतिम विश्लेषण एवं वर्गीकरण');
  const rows = CEI_FACTOR_ORDER.map(k => [k, CEI_FACTOR_NAMES[k], '10', components[k] == null ? '—' : String(components[k])]);
  rows.push(['EL', 'ऊर्जा हानि (Energy Loss)', '—', `−${EL || 0}`]);
  drawCriteriaTable(doc, {
    headerRow: ['सूत्र', 'मानक', 'अधिकतम अंक', 'प्राप्त अंक'],
    rows,
    totalRow: ['CEI', 'कुल प्राप्तांक', '90', cei == null ? '—' : String(cei)],
    colWidths: [55, 260, 100, 100]
  });
  const solved = 'CEI = ' + CEI_FACTOR_ORDER.map(k => components[k] == null ? '0' : String(components[k])).join(' + ') +
    ` − ${EL || 0} = ${cei == null ? '—' : cei} / 90`;
  drawSolvedFormula(doc, 'CEI = L + S + M + SB + AV + N + D9 + H + P − EL', solved);
  const bi = bandIndex(cei);
  drawScoreRing(doc, cei, bi, bi >= 0 ? CEI_BANDS[bi][0] : '—');
  drawBandChart(doc, 'CEI वर्गीकरण तालिका (Cosmic Energy Index)', CEI_BANDS, bi);
}

/** Last page: solved LPI, LPI range chart, both results side by side, conclusion, note. */
function renderLpiFinalPage(doc, { lpiDomains, lpi, cei }) {
  newPage(doc);
  drawTitle(doc, 'जीवन निष्पादन सूचकांक (LPI) : अंतिम वर्गीकरण');
  const parts = LPI_DOMAIN_ORDER.map(k => (lpiDomains[k] && lpiDomains[k].score != null) ? String(lpiDomains[k].score) : '—');
  drawSolvedFormula(doc, 'LPI = (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9)',
    lpi == null ? 'LPI = लंबित (प्रश्नावली अभी भरी नहीं गई)' : `LPI = ${parts.join(' + ')} = ${lpi} / 90`);
  const li = bandIndex(lpi), ci = bandIndex(cei);
  drawBandChart(doc, 'LPI वर्गीकरण तालिका (Life Performance Index)', LPI_BANDS, li);

  // Both results side by side
  drawHeading(doc, 'आपका समग्र परिणाम');
  const boxW = (PAGE_WIDTH_CONTENT - 14) / 2, boxH = 72;
  ensureSpace(doc, boxH + 10);
  const y = doc.y;
  [[0, 'कॉस्मिक ऊर्जा सूचकांक (CEI)', cei, ci, CEI_BANDS], [1, 'जीवन निष्पादन सूचकांक (LPI)', lpi, li, LPI_BANDS]].forEach(([i, label, sc, bi, bands]) => {
    const x = PAGE_LEFT + i * (boxW + 14);
    const col = bi >= 0 ? BAND_COLORS[bi] : '#999999';
    doc.roundedRect(x, y, boxW, boxH, 5).fillAndStroke('#FFFBF0', '#E8D3A2');
    doc.fontSize(8.5).fillColor('#777777').text(label, x, y + 8, { width: boxW, align: 'center', lineBreak: false });
    doc.fontSize(20).fillColor(col).text(sc == null ? 'लंबित' : `${sc} / 90`, x, y + 22, { width: boxW, align: 'center', lineBreak: false });
    doc.fontSize(10.5).fillColor(col).text(bi >= 0 ? bands[bi][0] : '—', x, y + 50, { width: boxW, align: 'center', lineBreak: false });
  });
  doc.x = PAGE_LEFT;
  doc.y = y + boxH + 14;

  drawHeading(doc, 'निष्कर्ष');
  drawParagraph(doc, 'CEI जातक की आंतरिक, सूक्ष्म और खगोलीय ऊर्जा का सूचक है, जबकि LPI उसके प्रत्यक्ष, व्यावहारिक जीवन के प्रदर्शन का आईना है। दोनों सूचकांकों को साथ देखने से जातक के संपूर्ण अस्तित्व का यथार्थवादी चित्र प्राप्त होता है। जीवन की सच्ची पूर्णता तभी संभव है जब आंतरिक कॉस्मिक ऊर्जा और बाहरी व्यावहारिक जीवनशैली के बीच पूर्ण सामंजस्य स्थापित हो।', { fontSize: 9 });
  ensureSpace(doc, 30);
  doc.fontSize(7.5).fillColor('#777777').text(
    'नोट: CEI पूर्णतः जन्म कुंडली से निकाला जाता है, इसलिए यह किसी भी शोधकर्ता द्वारा भरने पर नहीं बदलता। LPI शोधकर्ता के व्यक्तिगत आकलन पर आधारित है, इसलिए भरने वाले व्यक्ति के अनुसार इसमें लगभग 10% तक का अंतर आ सकता है।',
    PAGE_LEFT, doc.y, { width: PAGE_WIDTH_CONTENT });
  doc.fillColor(INK);
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
  drawPageChrome(doc, { isCover: true }); // the very first page doesn't fire 'pageAdded'; it carries the big logo instead

  const sd = scoringDetails || {};
  const ceiGrade = sd.ceiGrade || null;
  const lpiGrade = sd.lpiGrade || null;
  const dobStr = dateOfBirth ? new Date(dateOfBirth).toLocaleDateString() : 'N/A';
  const headerInfo = { isFirst: true, name, dobStr, timeOfBirth, place: location && location.city };

  // ================= CEI: 2 summary pages =================
  // (the rule-by-rule working is deliberately NOT printed)
  const ceiComponents = (sd.cei && sd.cei.components) || {};
  renderCeiSummaryCover(doc, CEI_CONTENT.cover, headerInfo, ceiComponents);
  renderCeiResultPage(doc, CEI_CONTENT.conclusion, {
    components: ceiComponents,
    EL: sd.cei ? sd.cei.EL : 0,
    cei: scores.cei
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

  // Final page: LPI range chart + both results + conclusion + note.
  // (Replaces the old combined CEI/LPI comparison matrix.)
  renderLpiFinalPage(doc, { lpiDomains, lpi: scores.lpi, cei: scores.cei });

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
