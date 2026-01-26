const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { buildTuckBoxPdf } = require('./tuckbox-pdf');

test('buildTuckBoxPdf: generates a valid 2-page (duplex) PDF by default', async () => {
  const artPath = path.join(__dirname, '..', 'assets', 'cyclops', 'image.png');
  const { pdfBytes, layout } = await buildTuckBoxPdf({
    heroName: 'Cyclops',
    miscText: 'Leadership\\nAggression',
    thicknessMm: 30,
    sleeveWidthMm: 66,
    sleeveHeightMm: 91,
    clearanceMm: 2,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
    accent: '#f7d117',
    artPath,
  });

  assert.ok(Buffer.isBuffer(Buffer.from(pdfBytes)));
  assert.match(Buffer.from(pdfBytes).subarray(0, 5).toString('utf8'), /^%PDF-/);

  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(layout.orientation, 'portrait');
});

test('buildTuckBoxPdf: supports single-sided 1-page output', async () => {
  const artPath = path.join(__dirname, '..', 'assets', 'cyclops', 'image.png');
  const { pdfBytes } = await buildTuckBoxPdf({
    heroName: 'Cyclops',
    miscText: 'Leadership\\nAggression',
    thicknessMm: 30,
    sleeveWidthMm: 66,
    sleeveHeightMm: 91,
    clearanceMm: 2,
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
