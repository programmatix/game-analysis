function applyRoundedRectClip(page, ops, { x, y, width, height, radius }) {
  const safeRadius = Number.isFinite(radius) ? radius : 0;
  const effectiveRadius = Math.max(0, Math.min(safeRadius, width / 2, height / 2));

  page.pushOperators(
    ops.pushGraphicsState(),
    ...roundedRectPathOperators(ops, x, y, width, height, effectiveRadius),
    ops.closePath(),
    ops.clip(),
    ops.endPath(),
  );
}

function restoreGraphicsState(page, ops) {
  page.pushOperators(ops.popGraphicsState());
}

function roundedRectPathOperators(ops, x, y, width, height, radius) {
  if (!radius) {
    return [
      ops.moveTo(x, y),
      ops.lineTo(x + width, y),
      ops.lineTo(x + width, y + height),
      ops.lineTo(x, y + height),
    ];
  }

  const kappa = 0.5522847498307936;
  const k = radius * kappa;

  const x0 = x;
  const y0 = y;
  const x1 = x + width;
  const y1 = y + height;

  return [
    ops.moveTo(x0 + radius, y0),
    ops.lineTo(x1 - radius, y0),
    ops.appendBezierCurve(x1 - radius + k, y0, x1, y0 + radius - k, x1, y0 + radius),
    ops.lineTo(x1, y1 - radius),
    ops.appendBezierCurve(x1, y1 - radius + k, x1 - radius + k, y1, x1 - radius, y1),
    ops.lineTo(x0 + radius, y1),
    ops.appendBezierCurve(x0 + radius - k, y1, x0, y1 - radius + k, x0, y1 - radius),
    ops.lineTo(x0, y0 + radius),
    ops.appendBezierCurve(x0, y0 + radius - k, x0 + radius - k, y0, x0 + radius, y0),
  ];
}

module.exports = {
  applyRoundedRectClip,
  restoreGraphicsState,
  roundedRectPathOperators,
};
