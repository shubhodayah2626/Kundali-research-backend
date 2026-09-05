const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const { parseKundaliPdfText } = require('./pdfParser');
const { calculateAllScoresFromPdf, HOUSE_NAMES } = require('./scoring');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Multer: accept the uploaded kundli PDF into memory (no disk writes needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are accepted'));
    }
    cb(null, true);
  }
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/kundali-research', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// ==================== SCHEMA ====================
// planetaryPositions / rawParsedData / scoringDetails are stored as Mixed
// (schema-less) because the real parser output (retrograde, pada,
// nakshatra, shadbala, bhavaBala, ashtakvarga, doshas, etc.) is much
// richer than the old rashi/degree-only shape, and a rigid schema would
// silently strip fields Mongoose doesn't recognize.
const kundaliSchema = new mongoose.Schema({
  name: { type: String, required: true },
  dateOfBirth: Date,
  timeOfBirth: String,
  location: {
    city: String,
    country: String,
    latitude: Number,
    longitude: Number
  },
  planetaryPositions: mongoose.Schema.Types.Mixed,
  rawParsedData: mongoose.Schema.Types.Mixed, // full pdfParser output: ashtakvarga, shadbala, bhavaBala, doshas, nakshatraLord
  scores: {
    cei: Number,
    lpi: Number,
    hps: Number, wps: Number, courage: Number, sups: Number, pps: Number,
    svps: Number, mps: Number, tps: Number, fps: Number, cps: Number,
    gps: Number, slps: Number
  },
  scoringDetails: mongoose.Schema.Types.Mixed, // full per-parameter breakdown (cei.detail, lpi.detail, per-house detail)
  parseWarnings: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Kundali = mongoose.model('Kundali', kundaliSchema);

// House metadata for display (order + label), built from scoring.js's HOUSE_NAMES
const HOUSE_ORDER = Object.entries(HOUSE_NAMES)
  .sort((a, b) => Number(a[0]) - Number(b[0])) // by house number
  .map(([houseNum, cfg]) => ({ houseNum: Number(houseNum), key: cfg.key, label: cfg.label }));

// ==================== ROUTES ====================

// Create Kundali by UPLOADING a kundli PDF (main flow)
// multipart/form-data: name (required), dateOfBirth, timeOfBirth,
// location.city, location.country (all optional metadata) + kundaliPdf (file)
app.post('/api/kundali/upload-pdf', upload.single('kundaliPdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded (field name must be "kundaliPdf")' });
    }
    const { name, dateOfBirth, timeOfBirth } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const city = req.body['location.city'] || req.body.city || '';
    const country = req.body['location.country'] || req.body.country || '';

    const pdfData = await pdfParse(req.file.buffer);
    const parsedData = parseKundaliPdfText(pdfData.text);

    const { scores, scoringDetails } = calculateAllScoresFromPdf(parsedData);

    const kundali = new Kundali({
      name,
      dateOfBirth: dateOfBirth || null,
      timeOfBirth: timeOfBirth || null,
      location: { city, country },
      planetaryPositions: parsedData.planetaryPositions,
      rawParsedData: parsedData,
      scores,
      scoringDetails
    });

    await kundali.save();

    res.json({
      success: true,
      kundaliId: kundali._id,
      kundali,
      parseWarnings: parsedData.parseWarnings || []
    });
  } catch (error) {
    console.error('PDF upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Legacy manual-entry route. NOTE: since calculateAllScoresFromPdf needs
// real parsed data (shadbala/bhavaBala/ashtakvarga), manually-typed
// rashi+degree values alone will mostly produce null scores. Kept only
// as a fallback; the PDF upload route above is the real flow.
app.post('/api/kundali/create', async (req, res) => {
  try {
    const { name, dateOfBirth, timeOfBirth, location, planetaryPositions } = req.body;

    const { scores, scoringDetails } = calculateAllScoresFromPdf({ planetaryPositions });

    const kundali = new Kundali({
      name,
      dateOfBirth,
      timeOfBirth,
      location,
      planetaryPositions,
      scores,
      scoringDetails
    });

    await kundali.save();

    res.json({ success: true, kundaliId: kundali._id, kundali, scores });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Kundali by ID (full record, including scoringDetails, for the drill-down view)
app.get('/api/kundali/:id', async (req, res) => {
  try {
    const kundali = await Kundali.findById(req.params.id);
    if (!kundali) {
      return res.status(404).json({ error: 'Kundali not found' });
    }
    res.json(kundali);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all Kundalis (name + summary scores list, for the "all saved kundalis" tab)
app.get('/api/kundalis', async (req, res) => {
  try {
    const kundalis = await Kundali.find().sort({ createdAt: -1 });
    res.json(kundalis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search Kundalis
app.get('/api/kundalis/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const results = await Kundali.find({
      $or: [
        { name: new RegExp(query, 'i') },
        { 'location.city': new RegExp(query, 'i') }
      ]
    });
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a Kundali record
app.delete('/api/kundali/:id', async (req, res) => {
  try {
    const deleted = await Kundali.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Kundali not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PDF REPORT (single combined PDF, all tables included) ====================

const GRADE_BANDS = [
  { min: 85, label: 'Exceptional', color: '#27AE60' },
  { min: 70, label: 'Strong', color: '#2980B9' },
  { min: 55, label: 'Moderate', color: '#F39C12' },
  { min: 40, label: 'Vulnerable', color: '#E67E22' },
  { min: 0, label: 'Critical', color: '#C0392B' }
];
function gradeOf(score) {
  if (score == null) return { label: 'N/A', color: '#7F8C8D' };
  return GRADE_BANDS.find(b => score >= b.min);
}

// Draws a simple 2-column table starting at current doc.y; returns new y.
function drawTable(doc, rows, { colWidths = [260, 200], startX = 50, headerRow = true, fontSize = 10 } = {}) {
  let y = doc.y;
  rows.forEach((row, i) => {
    if (y > 740) {
      doc.addPage();
      y = 50;
    }
    const isHeader = headerRow && i === 0;
    const bg = isHeader ? '#E8E8E8' : (i % 2 === 0 ? '#FFFFFF' : '#F7F7F7');
    let x = startX;
    row.forEach((cell, ci) => {
      const w = colWidths[ci] || 100;
      doc.rect(x, y, w, 20).fill(bg).stroke('#CCCCCC');
      doc.fillColor('#000000').fontSize(isHeader ? fontSize + 1 : fontSize)
        .text(String(cell), x + 5, y + 5, { width: w - 10 });
      x += w;
    });
    y += 20;
  });
  doc.y = y + 10;
  return y;
}

function sectionHeading(doc, text) {
  if (doc.y > 700) doc.addPage();
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor('#5B2333').text(text, { underline: true });
  doc.fillColor('#000000');
  doc.moveDown(0.3);
}

app.get('/api/kundali/:id/pdf', async (req, res) => {
  try {
    const kundali = await Kundali.findById(req.params.id);
    if (!kundali) return res.status(404).json({ error: 'Kundali not found' });

    const doc = new PDFDocument({ bufferPages: true, size: 'A4', compress: true, margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${kundali.name}-kundali-report.pdf"`);
    doc.pipe(res);

    const sd = kundali.scoringDetails || {};

    // ---- Page 1: Birth details + Summary table ----
    doc.fontSize(20).fillColor('#5B2333').text(`${kundali.name} - Kundali Analysis Report`, { align: 'center' });
    doc.fillColor('#000000');
    doc.moveDown();

    doc.fontSize(12).text('Birth Details:', { underline: true });
    doc.fontSize(10);
    if (kundali.dateOfBirth) doc.text(`Date of Birth: ${new Date(kundali.dateOfBirth).toLocaleDateString()}`);
    if (kundali.timeOfBirth) doc.text(`Time of Birth: ${kundali.timeOfBirth}`);
    if (kundali.location && (kundali.location.city || kundali.location.country)) {
      doc.text(`Location: ${kundali.location.city || ''}${kundali.location.city && kundali.location.country ? ', ' : ''}${kundali.location.country || ''}`);
    }
    doc.moveDown();

    sectionHeading(doc, 'Summary of All 14 Scores');
    const summaryRows = [['Score Type', 'Value / 100', 'Grade']];
    summaryRows.push(['Cosmic Energy Index (CEI)', kundali.scores.cei ?? 'N/A', gradeOf(kundali.scores.cei).label]);
    summaryRows.push(['Life Performance Index (LPI)', kundali.scores.lpi ?? 'N/A', gradeOf(kundali.scores.lpi).label]);
    HOUSE_ORDER.forEach(h => {
      const score = kundali.scores[h.key];
      summaryRows.push([h.label, score ?? 'N/A', gradeOf(score).label]);
    });
    drawTable(doc, summaryRows, { colWidths: [280, 90, 100] });

    // ---- CEI detail page ----
    doc.addPage();
    sectionHeading(doc, `Cosmic Energy Index (CEI) — Score: ${kundali.scores.cei ?? 'N/A'}/100`);
    if (sd.cei && sd.cei.formula) doc.fontSize(9).fillColor('#555555').text(sd.cei.formula).fillColor('#000000');
    doc.moveDown(0.3);
    if (sd.cei && sd.cei.components) {
      const rows = [['Component', 'Score (/10)']];
      Object.entries(sd.cei.components).forEach(([k, v]) => rows.push([k, v ?? 'N/A']));
      rows.push(['EL (Energy Loss deduction)', sd.cei.EL ?? 0]);
      drawTable(doc, rows, { colWidths: [280, 190] });
      if (sd.cei.D9_note) { doc.fontSize(8).fillColor('#888888').text(`Note: ${sd.cei.D9_note}`); doc.fillColor('#000000'); }
    } else {
      doc.fontSize(10).text('Detail not available for this record.');
    }

    // ---- LPI detail page ----
    doc.addPage();
    sectionHeading(doc, `Life Performance Index (LPI) — Score: ${kundali.scores.lpi ?? 'N/A'}/100`);
    if (sd.lpi && sd.lpi.formula) doc.fontSize(9).fillColor('#555555').text(sd.lpi.formula).fillColor('#000000');
    doc.moveDown(0.3);
    if (sd.lpi && sd.lpi.components) {
      const rows = [['Life Domain', 'Score (/10)']];
      Object.entries(sd.lpi.components).forEach(([k, v]) => rows.push([k, v ?? 'N/A']));
      drawTable(doc, rows, { colWidths: [280, 190] });
    } else {
      doc.fontSize(10).text('Detail not available for this record.');
    }

    // ---- 12 House detail pages ----
    HOUSE_ORDER.forEach(h => {
      doc.addPage();
      const detail = sd[h.key];
      const score = kundali.scores[h.key];
      const grade = gradeOf(score);
      doc.fontSize(15).fillColor('#5B2333').text(h.label, { align: 'center', underline: true });
      doc.fillColor('#000000');
      doc.fontSize(13).fillColor(grade.color).text(`Score: ${score ?? 'N/A'}/100  (${grade.label})`, { align: 'center' });
      doc.fillColor('#000000');
      doc.moveDown();

      if (!detail || !detail.houseScore) {
        doc.fontSize(10).text('Detail not available for this record.');
        return;
      }

      if (detail.formula) doc.fontSize(8).fillColor('#555555').text(detail.formula).fillColor('#000000');
      doc.fontSize(9).text(`House Rashi: ${detail.houseRashi || 'N/A'}  |  Lord: ${detail.lordPlanet || 'N/A'} (in ${detail.lordRashi || 'N/A'})`);
      doc.moveDown(0.3);

      sectionHeading(doc, `House Score (weight 0.25): ${detail.houseScore.total ?? 'N/A'}/100`);
      drawTable(doc, [
        ['Sub-parameter', 'Score (/20)'],
        ['Rashi Bala', detail.houseScore.rashiBala ?? 'N/A'],
        ['Graha Sthiti (occupants)', detail.houseScore.grahaSthiti ?? 'N/A'],
        ['Aspects Received', detail.houseScore.aspectsReceived ?? 'N/A'],
        ['Bhava Bala', detail.houseScore.bhavaBala ?? 'N/A'],
        ['Varga & Shadbala', detail.houseScore.vargaShadbala ?? 'N/A']
      ], { colWidths: [280, 190] });

      sectionHeading(doc, `Lord Score (weight 0.15): ${detail.lordScore.total ?? 'N/A'}/100`);
      drawTable(doc, [
        ['Sub-parameter', 'Score (/20)'],
        ['Dignity', detail.lordScore.dignity ?? 'N/A'],
        ['House Placement', detail.lordScore.housePlacement ?? 'N/A'],
        ['Aspects Received', detail.lordScore.aspectsReceived ?? 'N/A'],
        ['Conjunctions', detail.lordScore.conjunctions ?? 'N/A'],
        ['Shadbala & Varga', detail.lordScore.shadbalaVarga ?? 'N/A']
      ], { colWidths: [280, 190] });

      sectionHeading(doc, `Yoga Score (weight 0.10): ${detail.yogaScore.total ?? 'N/A'}/100`);
      const yogaRows = [['Criterion', 'Score']];
      (detail.yogaScore.criteria || []).forEach((c, i) => {
        const label = c.type === 'connection' ? `Connection with house ${c.pair}`
          : c.type === 'benefic' ? `Benefic influence (${(c.planets || []).join(', ')})`
          : 'Named classical yoga composite';
        yogaRows.push([label, c.score ?? 'N/A']);
      });
      drawTable(doc, yogaRows, { colWidths: [280, 190] });

      sectionHeading(doc, `Weighted Final: CEI(0.30) + LPI(0.20) + House(0.25) + Lord(0.15) + Yoga(0.10)`);
      drawTable(doc, [
        ['Input', 'Value'],
        ['CEI', detail.weightedInputs?.cei ?? 'N/A'],
        ['LPI', detail.weightedInputs?.lpi ?? 'N/A'],
        ['House Score', detail.weightedInputs?.houseScoreTotal ?? 'N/A'],
        ['Lord Score', detail.weightedInputs?.lordScoreTotal ?? 'N/A'],
        ['Yoga Score', detail.weightedInputs?.yogaScoreTotal ?? 'N/A'],
        ['Final Score', score ?? 'N/A']
      ], { colWidths: [280, 190] });
    });

    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export CSV (all records, summary scores only)
app.get('/api/kundalis/export/csv', async (req, res) => {
  try {
    const kundalis = await Kundali.find();
    let csv = 'Name,DOB,Time,Location,CEI,LPI,HPS,WPS,CPS_3rd,SuPS,PPS,SVPS,MPS,TPS,FPS,CPS_10th,GPS,SLPS\n';
    kundalis.forEach(k => {
      csv += `${k.name},${k.dateOfBirth ? new Date(k.dateOfBirth).toLocaleDateString() : ''},${k.timeOfBirth || ''},${k.location?.city || ''},`;
      csv += `${k.scores.cei},${k.scores.lpi},${k.scores.hps},${k.scores.wps},${k.scores.courage},`;
      csv += `${k.scores.sups},${k.scores.pps},${k.scores.svps},${k.scores.mps},${k.scores.tps},`;
      csv += `${k.scores.fps},${k.scores.cps},${k.scores.gps},${k.scores.slps}\n`;
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="kundali-research-export.csv"');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Kundali Research Portal Backend running on http://localhost:${PORT}`);
  console.log(`📊 Real scoring engine wired: CEI, LPI, and 12 house scores from scoring.js`);
});

module.exports = app;
