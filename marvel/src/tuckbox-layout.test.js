const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTuckBoxLayout } = require('./tuckbox-layout');

test('computeTuckBoxLayout: defaults fit A4 portrait', () => {
  const layout = computeTuckBoxLayout({
    sleeveWidthMm: 66,
    sleeveHeightMm: 91,
    thicknessMm: 30,
    clearanceMm: 2,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
  });

  assert.equal(layout.orientation, 'portrait');
  assert.ok(layout.segments.cut.length > 0);
  assert.ok(layout.segments.fold.length > 0);
});

test('computeTuckBoxLayout: thicker decks switch to A4 landscape when needed', () => {
  const layout = computeTuckBoxLayout({
    sleeveWidthMm: 66,
    sleeveHeightMm: 91,
    thicknessMm: 40,
    clearanceMm: 2,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
  });

  assert.equal(layout.orientation, 'landscape');
});

test('computeTuckBoxLayout: throws when net cannot fit on A4', () => {
  assert.throws(
    () =>
      computeTuckBoxLayout({
        sleeveWidthMm: 66,
        sleeveHeightMm: 91,
        thicknessMm: 60,
        clearanceMm: 2,
        glueFlapMm: 8,
        tuckExtraMm: 15,
        marginMm: 0,
        orientation: 'auto',
      }),
    /does not fit on a single A4 sheet/i
  );
});

