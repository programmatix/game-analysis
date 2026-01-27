const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTuckBoxLayout } = require('./tuckbox-layout');

test('computeTuckBoxLayout: defaults fit A4 portrait', () => {
  const layout = computeTuckBoxLayout({
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 32,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
  });

  assert.equal(layout.pageSize, 'a4');
  assert.equal(layout.orientation, 'portrait');
  assert.ok(layout.segments.cut.length > 0);
  assert.ok(layout.segments.fold.length > 0);
});

test('computeTuckBoxLayout: thicker decks switch to A4 landscape when needed', () => {
  const layout = computeTuckBoxLayout({
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 42,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
  });

  assert.equal(layout.orientation, 'landscape');
});

test('computeTuckBoxLayout: supports Letter paper size', () => {
  const layout = computeTuckBoxLayout({
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 32,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
    pageSize: 'letter',
  });

  assert.equal(layout.pageSize, 'letter');
  assert.ok(layout.pageWidthMm > 210);
  assert.ok(layout.pageHeightMm < 297);
});

test('computeTuckBoxLayout: throws when net cannot fit on A4', () => {
  assert.throws(
    () =>
      computeTuckBoxLayout({
        innerWidthMm: 68,
        innerHeightMm: 93,
        innerDepthMm: 70,
        glueFlapMm: 8,
        tuckExtraMm: 15,
        marginMm: 0,
        orientation: 'auto',
      }),
    /does not fit on a single A4 sheet/i
  );
});
