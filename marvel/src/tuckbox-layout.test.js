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

test('computeTuckBoxLayout: tapers the bottom tuck tab (ZO)', () => {
  const options = {
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 32,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
  };

  const layout = computeTuckBoxLayout(options);

  const xFront = layout.body.front.x;
  const baseY = layout.body.back.y - options.innerDepthMm;
  const bottomY = baseY - options.tuckExtraMm;
  const taper = 3;

  const expected = { x1: xFront, y1: baseY, x2: xFront + taper, y2: bottomY };
  const eps = 1e-6;
  const has = layout.segments.cut.some(seg => sameSegment(seg, expected, eps) || sameSegment(seg, flipSegment(expected), eps));
  assert.ok(has, 'Expected a diagonal cut segment for the ZO taper');
});

test('computeTuckBoxLayout: adds fold line between ZI and ZO', () => {
  const options = {
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 32,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
  };

  const layout = computeTuckBoxLayout(options);

  const xFront = layout.body.front.x;
  const bodyY = layout.body.back.y;
  const y = bodyY - options.innerDepthMm;
  const expected = { x1: xFront, y1: y, x2: xFront + options.innerWidthMm, y2: y };
  assert.ok(layout.segments.fold.some(seg => sameSegment(seg, expected, 1e-6)), 'Expected a ZI/ZO fold segment');
});

test('computeTuckBoxLayout: detaches ZJ flap from ZI with a cut seam', () => {
  const options = {
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 32,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
  };

  const layout = computeTuckBoxLayout(options);

  const xFront = layout.body.front.x;
  const xSide2 = xFront + options.innerWidthMm;
  const bodyY = layout.body.back.y;
  const expected = { x1: xSide2, y1: bodyY - options.innerDepthMm, x2: xSide2, y2: bodyY };
  assert.ok(layout.segments.cut.some(seg => sameSegment(seg, expected, 1e-6)), 'Expected a ZI/ZJ cut seam segment');
  assert.ok(!layout.segments.fold.some(seg => sameSegment(seg, expected, 1e-6)), 'Expected ZI/ZJ seam not to be a fold');
});

test('computeTuckBoxLayout: ZJ bottom taper slopes up toward the outer edge', () => {
  const options = {
    innerWidthMm: 68,
    innerHeightMm: 93,
    innerDepthMm: 32,
    glueFlapMm: 8,
    tuckExtraMm: 15,
    marginMm: 0,
    orientation: 'auto',
  };

  const layout = computeTuckBoxLayout(options);

  const xFront = layout.body.front.x;
  const xSide2 = xFront + options.innerWidthMm;
  const bodyY = layout.body.back.y;
  const x0 = xSide2;
  const x1 = xSide2 + options.innerDepthMm;
  const y0 = bodyY - options.innerDepthMm;
  const taper = 3;

  const expected = { x1: x0, y1: y0, x2: x1, y2: y0 + taper };
  const eps = 1e-6;
  const has = layout.segments.cut.some(seg => sameSegment(seg, expected, eps) || sameSegment(seg, flipSegment(expected), eps));
  assert.ok(has, 'Expected the ZJ bottom diagonal taper to slope up toward the outer edge');
});

function sameSegment(a, b, epsilon) {
  return (
    Math.abs(a.x1 - b.x1) <= epsilon &&
    Math.abs(a.y1 - b.y1) <= epsilon &&
    Math.abs(a.x2 - b.x2) <= epsilon &&
    Math.abs(a.y2 - b.y2) <= epsilon
  );
}

function flipSegment(seg) {
  return { x1: seg.x2, y1: seg.y2, x2: seg.x1, y2: seg.y1 };
}
