const test = require('node:test');
const assert = require('node:assert/strict');

const { computeLogoBoxRectMm } = require('./logo-layout');

test('computeLogoBoxRectMm: positions a fixed logo box within the logo area', () => {
  const safeRectMm = { x: 1.2, y: 1.2, width: 67.6, height: 22.6 };
  const cfg = {
    logoMaxWidthMm: 28,
    logoMaxHeightMm: 18,
    logoOffsetXMm: 0,
    logoOffsetYMm: 0,
  };

  const a = computeLogoBoxRectMm(safeRectMm, cfg);
  assert.equal(a.box.x, a.logoArea.x);
  assert.equal(a.box.y, a.logoArea.y);
  assert.equal(a.box.width, 28);
  assert.equal(a.box.height, 18);
});

test('computeLogoBoxRectMm: applies logo offsets', () => {
  const safeRectMm = { x: 1.2, y: 1.2, width: 67.6, height: 22.6 };
  const cfg = {
    logoMaxWidthMm: 28,
    logoMaxHeightMm: 18,
    logoOffsetXMm: 2,
    logoOffsetYMm: -1,
  };
  const a = computeLogoBoxRectMm(safeRectMm, cfg);
  assert.equal(a.box.x, a.logoArea.x + 2);
  assert.equal(a.box.y, a.logoArea.y + 1);
});
