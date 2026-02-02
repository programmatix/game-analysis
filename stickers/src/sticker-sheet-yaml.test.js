const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { buildStickerSheetYamlConfig } = require('./sticker-sheet-yaml');

test('buildStickerSheetYamlConfig: builds a sample-1 config with N stickers', () => {
  const cfg = buildStickerSheetYamlConfig({
    pageSize: 'a4',
    orientation: 'auto',
    sheetMarginMm: 8,
    gutterMm: 4,
    stickerWidthMm: 70,
    topStickerHeightMm: 25,
    frontStickerHeightMm: 40,
    cornerRadiusMm: 2,
    columns: 2,
    count: 10,
    sampleNumber: 1,
    sample1Logo: path.join(__dirname, '..', 'assets', 'logo.png'),
    sample1Art: path.join(__dirname, '..', 'assets', 'sample', 'image.png'),
    sample1Gradient: '#f7d117',
    sample1GradientWidthMm: 34,
    sample1LogoOffsetXMm: 0,
    sample1LogoOffsetYMm: 0,
    sample1LogoMaxWidthMm: 28,
    sample1LogoMaxHeightMm: 18,
    sample1ArtOffsetXMm: 0,
    sample1ArtOffsetYMm: 0,
    sample1ArtScale: 1,
  });

  assert.equal(cfg.version, 2);
  assert.equal(cfg.sheet.stickerWidthMm, 70);
  assert.equal(cfg.sheet.topStickerHeightMm, 25);
  assert.equal(cfg.sheet.frontStickerHeightMm, 40);
  assert.equal(cfg.stickers.length, 10);
  assert.equal(cfg.stickers[0].kind, 'top');
  assert.equal(cfg.stickers[1].kind, 'front');
  assert.equal(cfg.defaults.gradient, '#f7d117');
  assert.equal(cfg.defaults.artScale, 1);
});
