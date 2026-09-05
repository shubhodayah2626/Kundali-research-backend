# 🌟 Shubhodayah Kundali Research Portal - Backend

## Overview
Complete backend server for PhD research tool with **14 Vedic astrological scoring systems**.

## Features
✅ All 14 scoring calculation engines (CEI, LPI, 12 houses)
✅ Birth data processing and storage
✅ Planetary position tracking
✅ PDF generation (hybrid format - summary + individual pages)
✅ CSV export for batch data
✅ MongoDB database integration

## Tech Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB Atlas
- **PDF Generation**: PDFKit
- **Environment**: Render.com

## Scoring Systems (14 Total)
1. **CEI** - Cosmic Energy Index
2. **LPI** - Life Performance Index
3. **HPS** - 1st House (Health Potential)
4. **WPS** - 2nd House (Wealth Potential)
5. **CPS** - 3rd House (Courage Potential)
6. **SuPS** - 4th House (Happiness Potential)
7. **PPS** - 5th House (Creativity Potential)
8. **SVPS** - 6th House (Service & Victory)
9. **MPS** - 7th House (Marriage Potential)
10. **TPS** - 8th House (Transformation)
11. **FPS** - 9th House (Fortune Potential)
12. **CPS** - 10th House (Career Potential)
13. **GPS** - 11th House (Gain Potential)
14. **SLPS** - 12th House (Liberation Potential)

## API Endpoints
- `POST /api/kundali/create` - Create new kundali
- `GET /api/kundali/:id` - Get kundali by ID
- `GET /api/kundalis` - Get all kundalis
- `GET /api/kundalis/search/:query` - Search kundalis
- `GET /api/kundali/:id/pdf` - Download PDF report
- `GET /api/kundalis/export/csv` - Export all as CSV

## Installation
```bash
npm install
