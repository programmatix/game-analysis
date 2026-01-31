const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { buildTuckBoxPdf, buildTuckBoxTopSampleSheetPdf } = require('./tuckbox-pdf');

test('buildTuckBoxPdf: generates a valid 2-page (duplex) PDF by default', async () => {
  const artPath = path.join(__dirname, '..', 'assets', 'cyclops', 'image.png');
  const { pdfBytes, layout } = await buildTuckBoxPdf({
    heroName: 'Cyclops',
    miscText: 'Leadership\\nAggression',
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 32,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
    accent: '#f7d117',
    artPath,
  });

  assert.ok(Buffer.isBuffer(Buffer.from(pdfBytes)));
  assert.match(Buffer.from(pdfBytes).subarray(0, 5).toString('utf8'), /^%PDF-/);
  assert.doesNotMatch(Buffer.from(pdfBytes).toString('latin1'), /ObjStm/);

  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(layout.orientation, 'portrait');
});

test('buildTuckBoxPdf: supports single-sided 1-page output', async () => {
  const artPath = path.join(__dirname, '..', 'assets', 'cyclops', 'image.png');
  const { pdfBytes } = await buildTuckBoxPdf({
    heroName: 'Cyclops',
    miscText: 'Leadership\\nAggression',
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 32,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
    accent: '#f7d117',
    artPath,
    duplex: false,
  });

  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 1);
});

test('buildTuckBoxPdf: supports --print mode (no labels)', async () => {
  const artPath = path.join(__dirname, '..', 'assets', 'cyclops', 'image.png');
  const { pdfBytes } = await buildTuckBoxPdf({
    heroName: 'Cyclops',
    miscText: 'Leadership\\nAggression',
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 32,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
    accent: '#f7d117',
    artPath,
    print: true,
  });

  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 2);
});

test('buildTuckBoxTopSampleSheetPdf: generates a valid 1-page PDF', async () => {
  const artPath = path.join(__dirname, '..', 'assets', 'cyclops', 'image.png');
  const { pdfBytes, sheet } = await buildTuckBoxTopSampleSheetPdf({
    heroName: 'Cyclops',
    miscText: 'The Black Guard',
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 25,
    accent: '#d4252a',
    artPath,
    logoScale: 0.75,
    pageSize: 'a4',
    orientation: 'auto',
    columns: 4,
    rows: 4,
    count: 16,
    sheetMarginMm: 8,
    gutterMm: 3,
    topArtOffsetXMm: 0,
    topArtOffsetYMm: -20,
  });

  assert.ok(Buffer.isBuffer(Buffer.from(pdfBytes)));
  assert.match(Buffer.from(pdfBytes).subarray(0, 5).toString('utf8'), /^%PDF-/);

  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(sheet.count, 16);
});
