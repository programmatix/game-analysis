const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
const { buildFontSheetPdf } = require('./font-sheet-pdf');

test('buildFontSheetPdf: generates a valid 1-page PDF', async () => {
  const { pdfBytes, warnings } = await buildFontSheetPdf({
    fontsDir: '__does_not_exist__',
    fontOverrides: {},
  });

  assert.ok(Buffer.isBuffer(Buffer.from(pdfBytes)));
  assert.match(Buffer.from(pdfBytes).subarray(0, 5).toString('utf8'), /^%PDF-/);

  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 1);
  assert.ok(Array.isArray(warnings));
});

