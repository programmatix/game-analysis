const { A4_WIDTH_MM, A4_HEIGHT_MM } = require('../../shared/pdf-layout');

function computeTuckBoxLayout(options) {
  const sleeveWidthMm = requirePositiveNumber('--sleeve-width-mm', options.sleeveWidthMm);
  const sleeveHeightMm = requirePositiveNumber('--sleeve-height-mm', options.sleeveHeightMm);
  const thicknessMm = requirePositiveNumber('--thickness-mm', options.thicknessMm);

  const clearanceMm = requireNonNegativeNumber('--clearance-mm', options.clearanceMm ?? 2);
  const glueFlapMm = requirePositiveNumber('--glue-flap-mm', options.glueFlapMm ?? 8);
  const tuckExtraMm = requireNonNegativeNumber('--tuck-extra-mm', options.tuckExtraMm ?? 15);
  const marginMm = requireNonNegativeNumber('--margin-mm', options.marginMm ?? 0);

  const innerWidthMm = sleeveWidthMm + clearanceMm;
  const innerHeightMm = sleeveHeightMm + clearanceMm;
  const innerDepthMm = thicknessMm + clearanceMm;

  const W = innerWidthMm;
  const H = innerHeightMm;
  const D = innerDepthMm;

  const topTuckFlapHeight = D + tuckExtraMm;
  const bottomTuckFlapHeight = D + tuckExtraMm;
  const topMax = topTuckFlapHeight;
  const bottomMax = bottomTuckFlapHeight;

  const netWidthMm = glueFlapMm + W + D + W + D;
  const netHeightMm = bottomMax + H + topMax;

  const requestedOrientation = normalizeOrientation(options.orientation ?? 'auto');
  const fit = pickA4Orientation({
    netWidthMm,
    netHeightMm,
    marginMm,
    requestedOrientation,
  });

  if (!fit.fits) {
    const portraitAvailable = describeFit({
      pageWidthMm: A4_WIDTH_MM,
      pageHeightMm: A4_HEIGHT_MM,
      netWidthMm,
      netHeightMm,
      marginMm,
    });
    const landscapeAvailable = describeFit({
      pageWidthMm: A4_HEIGHT_MM,
      pageHeightMm: A4_WIDTH_MM,
      netWidthMm,
      netHeightMm,
      marginMm,
    });

    const lines = [
      `Tuckbox net does not fit on a single A4 sheet with a ${marginMm}mm margin.`,
      `- Required net size: ${formatMm(netWidthMm)}mm × ${formatMm(netHeightMm)}mm`,
      `- A4 portrait usable area: ${portraitAvailable.usable}`,
      `- A4 landscape usable area: ${landscapeAvailable.usable}`,
      `Try reducing --thickness-mm, --clearance-mm, --tuck-extra-mm, or --glue-flap-mm.`,
    ];
    throw new Error(lines.join('\n'));
  }

  const pageWidthMm = fit.pageWidthMm;
  const pageHeightMm = fit.pageHeightMm;
  const offsetX = (pageWidthMm - netWidthMm) / 2;
  const offsetY = (pageHeightMm - netHeightMm) / 2;

  const bodyY = offsetY + bottomMax;
  const bodyTopY = bodyY + H;

  const xGlue = offsetX;
  const xBack = xGlue + glueFlapMm;
  const xSide1 = xBack + W;
  const xFront = xSide1 + D;
  const xSide2 = xFront + W;

  const rects = [];

  rects.push(rect('glue', xGlue, bodyY, glueFlapMm, H));
  rects.push(rect('back', xBack, bodyY, W, H));
  rects.push(rect('side-left', xSide1, bodyY, D, H));
  rects.push(rect('front', xFront, bodyY, W, H));
  rects.push(rect('side-right', xSide2, bodyY, D, H));

  rects.push(rect('top-back', xBack, bodyTopY, W, D));
  rects.push(rect('top-side-left', xSide1, bodyTopY, D, D));
  rects.push(rect('top-front-tuck', xFront, bodyTopY, W, topTuckFlapHeight));
  rects.push(rect('top-side-right', xSide2, bodyTopY, D, D));

  rects.push(rect('bottom-back-tuck', xBack, bodyY - bottomTuckFlapHeight, W, bottomTuckFlapHeight));
  rects.push(rect('bottom-side-left', xSide1, bodyY - D, D, D));
  rects.push(rect('bottom-front', xFront, bodyY - D, W, D));
  rects.push(rect('bottom-side-right', xSide2, bodyY - D, D, D));

  const { cutSegments, foldSegments } = computeSegments(rects);

  const extraFoldSegments = [
    // Crease for the tuck tab: first D mm is top/bottom face, the rest tucks inside.
    hSegment(xFront, xFront + W, bodyTopY + D),
    hSegment(xBack, xBack + W, bodyY - D),
  ];

  return {
    orientation: fit.orientation,
    pageWidthMm,
    pageHeightMm,
    marginMm,
    netWidthMm,
    netHeightMm,
    dimensionsMm: {
      sleeveWidthMm,
      sleeveHeightMm,
      thicknessMm,
      clearanceMm,
      glueFlapMm,
      tuckExtraMm,
      innerWidthMm,
      innerHeightMm,
      innerDepthMm,
    },
    originMm: { x: offsetX, y: offsetY },
    body: {
      back: findRect(rects, 'back'),
      front: findRect(rects, 'front'),
      sideLeft: findRect(rects, 'side-left'),
      sideRight: findRect(rects, 'side-right'),
      glue: findRect(rects, 'glue'),
    },
    flaps: {
      topFrontTuck: findRect(rects, 'top-front-tuck'),
      bottomBackTuck: findRect(rects, 'bottom-back-tuck'),
      topBack: findRect(rects, 'top-back'),
    },
    topFace: rect('top-face', xFront, bodyTopY, W, D),
    rects,
    segments: {
      cut: cutSegments,
      fold: [...foldSegments, ...extraFoldSegments],
    },
  };
}

function rect(id, x, y, width, height) {
  return { id, x, y, width, height };
}

function findRect(rects, id) {
  const found = rects.find(item => item.id === id);
  if (!found) {
    throw new Error(`Internal error: missing rect "${id}"`);
  }
  return found;
}

function hSegment(x1, x2, y) {
  return { x1, y1: y, x2, y2: y };
}

function computeSegments(rects) {
  const vertical = [];
  const horizontal = [];

  for (const r of rects) {
    const x0 = r.x;
    const x1 = r.x + r.width;
    const y0 = r.y;
    const y1 = r.y + r.height;
    vertical.push(vEdge(x0, y0, y1));
    vertical.push(vEdge(x1, y0, y1));
    horizontal.push(hEdge(y0, x0, x1));
    horizontal.push(hEdge(y1, x0, x1));
  }

  const vCounts = splitAndCount(vertical, 'v');
  const hCounts = splitAndCount(horizontal, 'h');

  const cutSegments = [];
  const foldSegments = [];

  for (const [key, count] of [...vCounts.entries(), ...hCounts.entries()]) {
    const seg = decodeSegmentKey(key);
    if (count === 1) cutSegments.push(seg);
    else if (count === 2) foldSegments.push(seg);
  }

  return {
    cutSegments: cutSegments.sort(compareSegments),
    foldSegments: foldSegments.sort(compareSegments),
  };
}

function vEdge(x, y0, y1) {
  return { orientation: 'v', fixed: x, a: Math.min(y0, y1), b: Math.max(y0, y1) };
}

function hEdge(y, x0, x1) {
  return { orientation: 'h', fixed: y, a: Math.min(x0, x1), b: Math.max(x0, x1) };
}

function splitAndCount(segments, orientation) {
  const groups = new Map(); // fixedKey -> { fixed, segments: [{a,b}] }

  for (const seg of segments) {
    const fixedKey = keyNumber(seg.fixed);
    if (!groups.has(fixedKey)) groups.set(fixedKey, { fixed: seg.fixed, segments: [] });
    groups.get(fixedKey).segments.push({ a: seg.a, b: seg.b });
  }

  const counts = new Map();

  for (const [fixedKey, group] of groups.entries()) {
    const endpoints = [];
    for (const seg of group.segments) {
      endpoints.push(seg.a, seg.b);
    }
    const sorted = uniqueSorted(endpoints);

    for (const seg of group.segments) {
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (a < seg.a || b > seg.b) continue;
        if (a === b) continue;
        const subKey =
          orientation === 'v'
            ? `v|${fixedKey}|${keyNumber(a)}|${keyNumber(b)}`
            : `h|${fixedKey}|${keyNumber(a)}|${keyNumber(b)}`;
        counts.set(subKey, (counts.get(subKey) || 0) + 1);
      }
    }
  }

  return counts;
}

function decodeSegmentKey(key) {
  const parts = String(key).split('|');
  if (parts.length !== 4) {
    throw new Error(`Internal error: bad segment key "${key}"`);
  }

  const [kind, fixed, a, b] = parts;
  const fixedN = Number(fixed);
  const aN = Number(a);
  const bN = Number(b);

  if (kind === 'v') {
    return { x1: fixedN, y1: aN, x2: fixedN, y2: bN };
  }
  if (kind === 'h') {
    return { x1: aN, y1: fixedN, x2: bN, y2: fixedN };
  }

  throw new Error(`Internal error: bad segment kind "${kind}"`);
}

function compareSegments(a, b) {
  if (a.y1 !== b.y1) return a.y1 - b.y1;
  if (a.x1 !== b.x1) return a.x1 - b.x1;
  if (a.y2 !== b.y2) return a.y2 - b.y2;
  return a.x2 - b.x2;
}

function uniqueSorted(values) {
  const unique = Array.from(new Set(values.map(keyNumber))).map(Number);
  unique.sort((a, b) => a - b);
  return unique;
}

function normalizeOrientation(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'portrait' || raw === 'landscape') return raw;
  return 'auto';
}

function pickA4Orientation({ netWidthMm, netHeightMm, marginMm, requestedOrientation }) {
  const candidates = [];

  const tryOrientation = (orientation, pageWidthMm, pageHeightMm) => {
    const usableW = pageWidthMm - marginMm * 2;
    const usableH = pageHeightMm - marginMm * 2;
    const fits = netWidthMm <= usableW && netHeightMm <= usableH;
    candidates.push({ orientation, pageWidthMm, pageHeightMm, fits, usableW, usableH });
  };

  if (requestedOrientation === 'portrait') {
    tryOrientation('portrait', A4_WIDTH_MM, A4_HEIGHT_MM);
  } else if (requestedOrientation === 'landscape') {
    tryOrientation('landscape', A4_HEIGHT_MM, A4_WIDTH_MM);
  } else {
    tryOrientation('portrait', A4_WIDTH_MM, A4_HEIGHT_MM);
    tryOrientation('landscape', A4_HEIGHT_MM, A4_WIDTH_MM);
  }

  const fitting = candidates.filter(item => item.fits);
  if (!fitting.length) return { fits: false };
  // Prefer portrait if it fits; otherwise pick the one with more spare margin.
  const sorted = fitting.sort((a, b) => {
    if (a.orientation === 'portrait' && b.orientation !== 'portrait') return -1;
    if (b.orientation === 'portrait' && a.orientation !== 'portrait') return 1;
    const spareA = (a.usableW - netWidthMm) + (a.usableH - netHeightMm);
    const spareB = (b.usableW - netWidthMm) + (b.usableH - netHeightMm);
    return spareB - spareA;
  });
  const best = sorted[0];
  return { fits: true, orientation: best.orientation, pageWidthMm: best.pageWidthMm, pageHeightMm: best.pageHeightMm };
}

function describeFit({ pageWidthMm, pageHeightMm, netWidthMm, netHeightMm, marginMm }) {
  const usableW = pageWidthMm - marginMm * 2;
  const usableH = pageHeightMm - marginMm * 2;
  const usable = `${formatMm(usableW)}mm × ${formatMm(usableH)}mm`;
  const fits = netWidthMm <= usableW && netHeightMm <= usableH;
  return { usable, fits };
}

function keyNumber(value) {
  // For stable segment splitting and key equality.
  return Number(value).toFixed(4);
}

function formatMm(value) {
  return Number(value).toFixed(1).replace(/\.0$/, '');
}

function requirePositiveNumber(flag, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return n;
}

function requireNonNegativeNumber(flag, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${flag} must be a non-negative number`);
  }
  return n;
}

module.exports = {
  computeTuckBoxLayout,
};
