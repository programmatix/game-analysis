const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');

const { buildStickerSheetPdf } = require('./sticker-sheet-pdf');

test('buildStickerSheetPdf: generates a valid 1-page PDF from a config object', async () => {
  const logo = path.join(__dirname, '..', 'assets', 'logo.png');
  const art = path.join(__dirname, '..', 'assets', 'cyclops', 'image.png');

  const { pdfBytes, sheet } = await buildStickerSheetPdf(
    {
      version: 1,
      sheet: {
        pageSize: 'a4',
        orientation: 'landscape',
        pageWidthMm: 297,
        pageHeightMm: 210,
        marginMm: 8,
        gutterMm: 4,
        stickerWidthMm: 70,
        stickerHeightMm: 25,
        cornerRadiusMm: 2,
        columns: 2,
        rows: 5,
      },
      debug: {
        leftMm: 10,
        rightFromRightMm: 50,
        centerHorizontal: true,
      },
      stickers: [
        {
          design: 'sample1',
          logo,
          art,
          gradient: '#f7d117',
          gradientWidthMm: 34,
          logoOffsetXMm: 0,
          logoOffsetYMm: 0,
          logoMaxWidthMm: 28,
          logoMaxHeightMm: 18,
          artOffsetXMm: 0,
          artOffsetYMm: 0,
          artScale: 1.2,
        },
      ],
    },
    { debug: true },
  );

  assert.ok(Buffer.isBuffer(Buffer.from(pdfBytes)));
  assert.match(Buffer.from(pdfBytes).subarray(0, 5).toString('utf8'), /^%PDF-/);

  const doc = await PDFDocument.load(pdfBytes);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(sheet.columns, 2);
  assert.equal(sheet.rows, 5);
  assert.equal(sheet.stickers, 1);
});
