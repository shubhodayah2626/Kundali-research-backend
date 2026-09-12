const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const PDFDocument = require('pdfkit');

const { calculateAllScoresFromBirthDetails } = require('./scoring');

// Devanagari-capable font so Hindi labels render correctly in the PDF
// (PDFKit's built-in fonts only cover Latin script). Upload the .ttf
// to a `fonts/` folder at the repo root alongside server.js.
const DEVANAGARI_FONT_PATH = path.join(__dirname, 'fonts', 'NotoSansDevanagari-Regular.ttf');

dotenv.config();

const app = express();
app.use(cors());
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

// ==================== PDF GENERATION (single page, matches worksheet layout) ====================
function drawTable(doc, rows, { colWidths = [300, 60, 60], startX = 40, fontSize = 8, rowHeight = 15 } = {}) {
  let y = doc.y;
  rows.forEach((row, i) => {
    if (y > 770) { doc.addPage(); y = 30; }
    const isHeader = i === 0;
    doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight)
      .fill(isHeader ? '#E8E8E8' : (i % 2 === 0 ? '#FFFFFF' : '#F9F9F9')).stroke('#DDDDDD');
    let x = startX;
    row.forEach((cell, ci) => {
      const w = colWidths[ci] || 80;
      doc.fillColor('#000000').fontSize(isHeader ? fontSize + 0.5 : fontSize)
        .text(String(cell), x + 4, y + 3, { width: w - 8 });
      x += w;
    });
    y += rowHeight;
  });
  doc.y = y + 6;
}

function sectionHeading(doc, text, color = '#5B2333') {
  if (doc.y > 740) doc.addPage();
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor(color).text(text, { underline: true });
  doc.fillColor('#000000');
  doc.moveDown(0.15);
}

/** Streams a single combined CEI + LPI PDF directly to the response, matching the worksheet's layout. */
function generateCeiLpiPdf(res, { name, dateOfBirth, timeOfBirth, location, scores, scoringDetails }) {
  const doc = new PDFDocument({ bufferPages: true, size: 'A4', compress: true, margins: { top: 30, bottom: 30, left: 40, right: 40 } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-CEI-LPI-Report.pdf"`);
  doc.pipe(res);

  // Use the Devanagari font for the WHOLE document (it also covers
  // Latin/numerals) so Hindi labels render correctly instead of the
  // default Helvetica's mojibake. Falls back to default font if the
  // .ttf hasn't been uploaded yet, so the PDF still generates.
  try {
    doc.registerFont('Devanagari', DEVANAGARI_FONT_PATH);
    doc.font('Devanagari');
  } catch (fontErr) {
    console.error('Devanagari font not found, falling back to default font (Hindi text will be garbled):', fontErr.message);
  }

  const sd = scoringDetails || {};
  const ceiGrade = sd.ceiGrade || null;
  const lpiGrade = sd.lpiGrade || null;

  // ---- Header ----
  doc.fontSize(16).fillColor('#5B2333').text(`${name} — CEI & LPI Report`, { align: 'center' });
  doc.fillColor('#000000').fontSize(9);
  doc.moveDown(0.2);
  const dobStr = dateOfBirth ? new Date(dateOfBirth).toLocaleDateString() : 'N/A';
  doc.text(`DOB: ${dobStr}   |   Time: ${timeOfBirth || 'N/A'}   |   Place: ${location && location.city ? location.city : 'N/A'}`, { align: 'center' });
  doc.moveDown(0.5);

  // ---- CEI Summary + components ----
  sectionHeading(doc, `Cosmic Energy Index (CEI): ${scores.cei ?? 'N/A'}/90  —  ${ceiGrade || 'N/A'}`);
  doc.fontSize(7.5).fillColor('#555555').text('CEI = L + S + M + SB + AV + N + D9 + H + P − EL').fillColor('#000000');
  doc.moveDown(0.2);
  if (sd.cei && sd.cei.components) {
    const rows = [['CEI Factor', 'Score', '/10']];
    const labelMap = { L: 'लग्न (Lagna)', S: 'सूर्य (Sun)', M: 'चंद्र (Moon)', SB: 'षड्बल (Shadbala)', AV: 'अष्टकवर्ग (Ashtakvarga)', N: 'नक्षत्र (Nakshatra)', D9: 'नवांश (Navamsha)', H: 'शरीर एवं 12 भाव (Body & Houses)', P: 'पंचमहाभूत (5 Elements)' };
    Object.entries(sd.cei.components).forEach(([k, v]) => rows.push([labelMap[k] || k, v ?? 'N/A', '10']));
    rows.push(['EL (Energy Loss deduction)', `−${sd.cei.EL ?? 0}`, '']);
    drawTable(doc, rows, { colWidths: [340, 70, 50] });
  }

  // ---- LPI Summary + domains ----
  sectionHeading(doc, `Life Performance Index (LPI): ${scores.lpi ?? 'N/A'}/90  —  ${lpiGrade || 'N/A'}`);
  doc.fontSize(7.5).fillColor('#555555').text('LPI = sum of 9 life-domain scores (5 criteria x 2 points each) — astrological proxy computed from planetary positions').fillColor('#000000');
  doc.moveDown(0.2);
  if (sd.lpi && sd.lpi.domains) {
    const rows = [['LPI Domain', 'Score', '/10']];
    Object.values(sd.lpi.domains).forEach(d => rows.push([d.label || '', d.score ?? 'N/A', '10']));
    drawTable(doc, rows, { colWidths: [340, 70, 50] });
  }

  // ---- Comparison / conclusion ----
  sectionHeading(doc, 'CEI और LPI की तुलना (Comparison & Conclusion)');
  drawTable(doc, [
    ['CEI Range', 'LPI Range', 'निष्कर्ष (Conclusion)'],
    ['80–90', '80–90', 'वास्तविक जीवन में मजबूत सामंजस्य (Strong life harmony)'],
    ['70–79', '70–79', 'अच्छा सामंजस्य (Good harmony)'],
    ['60–69', '60–69', 'औसत सामंजस्य (Average harmony)'],
    ['50–59', '50–59', 'ऊर्जा में कमी का जीवन पर प्रभाव (Energy-deficiency impact)'],
    ['50 से कम', '50 से कम', 'गंभीर असंतुलन (Severe imbalance)']
  ], { colWidths: [90, 90, 280] });

  doc.moveDown(0.3);
  doc.fontSize(8).fillColor(gradeColor(ceiGrade)).text(`CEI: ${scores.cei ?? 'N/A'}/90 — ${ceiGrade || 'N/A'}`);
  doc.fillColor(gradeColor(lpiGrade)).text(`LPI: ${scores.lpi ?? 'N/A'}/90 — ${lpiGrade || 'N/A'}`);
  doc.fillColor('#000000');

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

    const { scores, scoringDetails } = await calculateAllScoresFromBirthDetails(birthDetails);

    // Save in the background — don't block the PDF download on DB latency.
    new Kundali({
      name, dateOfBirth: dateOfBirth || null, timeOfBirth: timeOfBirth || null,
      location: location || {}, birthDetailsUsed: birthDetails, scores, scoringDetails
    }).save().catch(err => console.error('Background save failed:', err));

    generateCeiLpiPdf(res, { name, dateOfBirth, timeOfBirth, location, scores, scoringDetails });
  } catch (error) {
    console.error('Generate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Re-download a previously generated report by ID
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
