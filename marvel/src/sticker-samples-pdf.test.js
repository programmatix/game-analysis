const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildStickerSampleSheetPdf } = require('./sticker-samples-pdf');

test('buildStickerSampleSheetPdf builds a 10-slot sheet and returns PDF bytes', async () => {
  const logo = path.join(__dirname, '..', 'assets', 'logo.png');
  const art = path.join(__dirname, '..', 'assets', 'cyclops', 'image.png');

  const { pdfBytes, sheet } = await buildStickerSampleSheetPdf({
    pageSize: 'a4',
    orientation: 'auto',
    columns: 2,
    rows: 5,
    count: 10,
    stickerWidthMm: 70,
    stickerHeightMm: 25,
    sheetMarginMm: 8,
    gutterMm: 3,
    sheetHeaderHeightMm: 12,
    cornerRadiusMm: 2,
    sample1Logo: logo,
    sample1Art: art,
    sample1Yellow: '#f7d117',
    sample1GradientWidthMm: 34,
  });

  assert.ok(pdfBytes instanceof Uint8Array);
  assert.ok(pdfBytes.length > 10_000);

  assert.equal(sheet.count, 10);
  assert.equal(sheet.columns, 2);
  assert.equal(sheet.rows, 5);
  assert.equal(sheet.stickerWidthMm, 70);
  assert.equal(sheet.stickerHeightMm, 25);
});

