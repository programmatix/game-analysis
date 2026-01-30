const { A4_WIDTH_MM, A4_HEIGHT_MM } = require('../../shared/pdf-layout');

const LETTER_WIDTH_MM = 215.9;
const LETTER_HEIGHT_MM = 279.4;

function computeTuckBoxLayout(options) {
  const innerWidthMm = requirePositiveNumber('--inner-width-mm', options.innerWidthMm ?? options.innerWidth);
  const innerHeightMm = requirePositiveNumber('--inner-height-mm', options.innerHeightMm ?? options.innerHeight);
  const innerDepthMm = requirePositiveNumber('--inner-depth-mm', options.innerDepthMm ?? options.innerDepth);

  const glueFlapMm = requirePositiveNumber('--glue-flap-mm', options.glueFlapMm ?? 8);
  const tuckExtraMm = requireNonNegativeNumber('--tuck-extra-mm', options.tuckExtraMm ?? 15);
  const marginMm = requireNonNegativeNumber('--margin-mm', options.marginMm ?? 0);

  const W = innerWidthMm;
  const H = innerHeightMm;
  const D = innerDepthMm;

  const topTuckFlapHeight = D + tuckExtraMm;
  const bottomTuckFlapHeight = D + tuckExtraMm;
  const topMax = topTuckFlapHeight;
  const bottomMax = bottomTuckFlapHeight;

  const netWidthMm = glueFlapMm + W + D + W + D;
  const netHeightMm = bottomMax + H + topMax;

  const pageSize = normalizePageSize(options.pageSize ?? options.paperSize ?? 'a4');
  const basePage =
    pageSize === 'letter'
      ? { pageWidthMm: LETTER_WIDTH_MM, pageHeightMm: LETTER_HEIGHT_MM }
      : { pageWidthMm: A4_WIDTH_MM, pageHeightMm: A4_HEIGHT_MM };

  const requestedOrientation = normalizeOrientation(options.orientation ?? 'auto');
  const fit = pickPageOrientation({
    netWidthMm,
    netHeightMm,
    marginMm,
    requestedOrientation,
    basePage,
  });

  if (!fit.fits) {
    const portraitAvailable = describeFit({
      pageWidthMm: basePage.pageWidthMm,
      pageHeightMm: basePage.pageHeightMm,
      netWidthMm,
      netHeightMm,
      marginMm,
    });
    const landscapeAvailable = describeFit({
      pageWidthMm: basePage.pageHeightMm,
      pageHeightMm: basePage.pageWidthMm,
      netWidthMm,
      netHeightMm,
      marginMm,
    });

    const lines = [
      `Tuckbox net does not fit on a single ${pageSize.toUpperCase()} sheet with a ${marginMm}mm margin.`,
      `- Required net size: ${formatMm(netWidthMm)}mm × ${formatMm(netHeightMm)}mm`,
      `- ${pageSize.toUpperCase()} portrait usable area: ${portraitAvailable.usable}`,
      `- ${pageSize.toUpperCase()} landscape usable area: ${landscapeAvailable.usable}`,
      `Try reducing --inner-width-mm, --inner-height-mm, --inner-depth-mm, --tuck-extra-mm, or --glue-flap-mm.`,
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

  // Optional flaps/tabs above body.
  rects.push(rect('top-front-tuck', xFront, bodyTopY, W, topTuckFlapHeight));

  // Bottom flap under the front panel (ZI) plus a side glue flap to the right (ZJ).
  const bottomBackTuck = rect('bottom-back-tuck', xFront, bodyY - bottomTuckFlapHeight, W, bottomTuckFlapHeight);
  rects.push(bottomBackTuck);
  const bottomSideLeft = rect('bottom-side-left', xSide2, bodyY - D, D, D);
  rects.push(bottomSideLeft);

  const topFace = rect('top-face', xFront, bodyTopY, W, D);
  const topSideTabMm = 10;
  rects.push(rect('top-face-tab-left', topFace.x - topSideTabMm, topFace.y, topSideTabMm, topFace.height));
  rects.push(rect('top-face-tab-right', topFace.x + topFace.width, topFace.y, topSideTabMm, topFace.height));

  const { cutSegments, foldSegments } = computeSegments(rects);

  const extraFoldSegments = [
    // Crease for the tuck tab: first D mm is top/bottom face, the rest tucks inside.
    hSegment(xFront, xFront + W, bodyTopY + D),
  ];

  // Fold between the bottom face depth (ZI) and the extra tuck tab (ZO).
  if (tuckExtraMm > 0) {
    extraFoldSegments.push(hSegment(xFront, xFront + W, bodyY - D));
  }

  // Override: the fold line under the left spine panel should be cut (requested as L8 with defaults).
  // This is the horizontal segment on the body seam spanning the left spine width.
  const spineBottomSeam = hSegment(xSide1, xFront, bodyY);
  moveSegmentBetweenLists(foldSegments, cutSegments, spineBottomSeam);

  // Detach the bottom-side glue flap from the body for easier gluing (line above ZJ).
  const bottomSideSeam = hSegment(xSide2, xSide2 + D, bodyY);
  moveSegmentBetweenLists(foldSegments, cutSegments, bottomSideSeam);

  // Detach the bottom-side glue flap from the bottom back tuck (cut line to the right of L3).
  const bottomSideInnerSeam = vSegment(xSide2, bodyY - D, bodyY);
  moveSegmentBetweenLists(foldSegments, cutSegments, bottomSideInnerSeam);

  // Tapers / chamfers for easier tucking/gluing.
  applyTopTuckTabTaper(cutSegments, { x: xFront, y: bodyTopY + D, width: W, height: tuckExtraMm }, 3);
  applyGlueFlapCornerChamfer(cutSegments, { x: xGlue, y: bodyY, width: glueFlapMm, height: H }, 3);
  applySideTabCornerChamfers(cutSegments, { x: topFace.x - topSideTabMm, y: topFace.y, width: topSideTabMm, height: D }, 2, 'left');
  applySideTabCornerChamfers(cutSegments, { x: topFace.x + topFace.width, y: topFace.y, width: topSideTabMm, height: D }, 2, 'right');

  // ZO: bottom tuck tab taper.
  if (tuckExtraMm > 0) {
    applyBottomTuckTabTaper(cutSegments, { x: bottomBackTuck.x, y: bottomBackTuck.y, width: bottomBackTuck.width, height: tuckExtraMm }, 3);
  }
  // ZJ: taper the top + bottom cut lines (L5 and L2) with full-length diagonals.
  applySkewedFlapTapers(cutSegments, bottomSideLeft, 3);

  return {
    pageSize,
    orientation: fit.orientation,
    pageWidthMm,
    pageHeightMm,
    marginMm,
    netWidthMm,
    netHeightMm,
    dimensionsMm: {
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
    },
    topFace,
    rects,
    segments: {
      cut: cutSegments,
      fold: [...foldSegments, ...extraFoldSegments],
    },
  };
}

function applyTopTuckTabTaper(cutSegments, rectMm, taperMm) {
  const taper = Math.max(0, Number(taperMm) || 0);
  const x = rectMm.x;
  const y = rectMm.y;
  const w = rectMm.width;
  const h = rectMm.height;
  if (!(taper > 0) || !(h > 0) || w <= taper * 2) return;

  const baseY = y;
  const topY = y + h;

  // The flap side edges are typically single segments (not pre-split at baseY),
  // so remove the whole edge and re-add the untapered portion below baseY.
  const fullEdgeLeft = cutSegments.find(seg => seg.x1 === x && seg.x2 === x && seg.y1 <= baseY && seg.y2 >= topY);
  const fullEdgeRight = cutSegments.find(seg => seg.x1 === x + w && seg.x2 === x + w && seg.y1 <= baseY && seg.y2 >= topY);
  if (fullEdgeLeft) removeCutSegment(cutSegments, fullEdgeLeft);
  if (fullEdgeRight) removeCutSegment(cutSegments, fullEdgeRight);
  removeCutSegment(cutSegments, hSegment(x, x + w, topY));

  if (fullEdgeLeft && fullEdgeLeft.y1 < baseY) cutSegments.push(vSegment(x, fullEdgeLeft.y1, baseY));
  if (fullEdgeRight && fullEdgeRight.y1 < baseY) cutSegments.push(vSegment(x + w, fullEdgeRight.y1, baseY));
  cutSegments.push(diagSegment(x, baseY, x + taper, topY));
  cutSegments.push(diagSegment(x + w, baseY, x + w - taper, topY));
  cutSegments.push(hSegment(x + taper, x + w - taper, topY));
  cutSegments.sort(compareSegments);
}

function applyBottomTuckTabTaper(cutSegments, rectMm, taperMm) {
  const taper = Math.max(0, Number(taperMm) || 0);
  const x = rectMm.x;
  const y = rectMm.y;
  const w = rectMm.width;
  const h = rectMm.height;
  if (!(taper > 0) || !(h > 0) || w <= taper * 2) return;

  const bottomY = y;
  const baseY = y + h;

  const bottomEdge = hSegment(x, x + w, bottomY);
  if (!cutSegments.some(seg => sameSegment(seg, bottomEdge, 1e-6))) return;

  const fullEdgeLeft = cutSegments.find(seg => seg.x1 === x && seg.x2 === x && seg.y1 <= bottomY && seg.y2 >= baseY);
  const fullEdgeRight = cutSegments.find(seg => seg.x1 === x + w && seg.x2 === x + w && seg.y1 <= bottomY && seg.y2 >= baseY);
  if (!fullEdgeLeft || !fullEdgeRight) return;

  if (fullEdgeLeft) removeCutSegment(cutSegments, fullEdgeLeft);
  if (fullEdgeRight) removeCutSegment(cutSegments, fullEdgeRight);
  removeCutSegment(cutSegments, bottomEdge);

  if (fullEdgeLeft && fullEdgeLeft.y2 > baseY) cutSegments.push(vSegment(x, baseY, fullEdgeLeft.y2));
  if (fullEdgeRight && fullEdgeRight.y2 > baseY) cutSegments.push(vSegment(x + w, baseY, fullEdgeRight.y2));

  cutSegments.push(diagSegment(x, baseY, x + taper, bottomY));
  cutSegments.push(diagSegment(x + w, baseY, x + w - taper, bottomY));
  cutSegments.push(hSegment(x + taper, x + w - taper, bottomY));
  cutSegments.sort(compareSegments);
}

function applyBottomRightCornerChamfer(cutSegments, rectMm, chamferMm) {
  const c = Math.max(0, Number(chamferMm) || 0);
  const x = rectMm.x;
  const y = rectMm.y;
  const w = rectMm.width;
  const h = rectMm.height;
  if (!(c > 0) || w <= c || h <= c) return;

  const xRight = x + w;
  const yBottom = y;
  const yTop = y + h;

  const bottomEdge = hSegment(x, xRight, yBottom);
  const rightEdge = vSegment(xRight, yBottom, yTop);
  if (!cutSegments.some(seg => sameSegment(seg, bottomEdge, 1e-6))) return;
  if (!cutSegments.some(seg => sameSegment(seg, rightEdge, 1e-6))) return;

  removeCutSegment(cutSegments, bottomEdge);
  removeCutSegment(cutSegments, rightEdge);

  cutSegments.push(hSegment(x, xRight - c, yBottom));
  cutSegments.push(vSegment(xRight, yBottom + c, yTop));
  cutSegments.push(diagSegment(xRight - c, yBottom, xRight, yBottom + c));
  cutSegments.sort(compareSegments);
}

function applyOuterEdgeCornerTapers({ cutSegments, foldSegments }, rectMm, taperMm, outerEdge = 'right') {
  const c = Math.max(0, Number(taperMm) || 0);
  if (!(c > 0)) return;
  const x = rectMm.x;
  const y = rectMm.y;
  const w = rectMm.width;
  const h = rectMm.height;
  if (!(w > c) || !(h > c * 2)) return;

  const xOuter = outerEdge === 'left' ? x : x + w;
  const xInner = outerEdge === 'left' ? x + w : x;
  const yBottom = y;
  const yTop = y + h;
  const xChamfer = xOuter + (outerEdge === 'left' ? c : -c);

  const topEdge = hSegment(Math.min(xInner, xOuter), Math.max(xInner, xOuter), yTop);
  const bottomEdge = hSegment(Math.min(xInner, xOuter), Math.max(xInner, xOuter), yBottom);
  const outerVert = vSegment(xOuter, yBottom, yTop);

  const topType = segmentsInclude(foldSegments, topEdge) ? 'fold' : segmentsInclude(cutSegments, topEdge) ? 'cut' : null;
  const bottomType = segmentsInclude(cutSegments, bottomEdge) ? 'cut' : segmentsInclude(foldSegments, bottomEdge) ? 'fold' : null;
  if (!topType || !bottomType) return;
  if (!segmentsInclude(cutSegments, outerVert)) return;

  removeSegment(cutSegments, outerVert);
  if (topType === 'fold') removeSegment(foldSegments, topEdge);
  else removeSegment(cutSegments, topEdge);
  if (bottomType === 'fold') removeSegment(foldSegments, bottomEdge);
  else removeSegment(cutSegments, bottomEdge);

  const topShort = hSegment(Math.min(xInner, xChamfer), Math.max(xInner, xChamfer), yTop);
  const bottomShort = hSegment(Math.min(xInner, xChamfer), Math.max(xInner, xChamfer), yBottom);
  const vertShort = vSegment(xOuter, yBottom + c, yTop - c);

  if (topType === 'fold') foldSegments.push(topShort);
  else cutSegments.push(topShort);

  if (bottomType === 'fold') foldSegments.push(bottomShort);
  else cutSegments.push(bottomShort);

  cutSegments.push(vertShort);

  // Diagonal cut corners.
  cutSegments.push(diagSegment(xChamfer, yBottom, xOuter, yBottom + c));
  cutSegments.push(diagSegment(xOuter, yTop - c, xChamfer, yTop));

  cutSegments.sort(compareSegments);
  foldSegments.sort(compareSegments);
}

function applyGlueFlapCornerChamfer(cutSegments, rectMm, chamferMm) {
  const c = Math.max(0, Number(chamferMm) || 0);
  const x = rectMm.x;
  const y = rectMm.y;
  const w = rectMm.width;
  const h = rectMm.height;
  if (!(c > 0) || w <= c || h <= c * 2) return;

  const xLeft = x;
  const xRight = x + w;
  const yBottom = y;
  const yTop = y + h;

  removeCutSegment(cutSegments, vSegment(xLeft, yBottom, yTop));
  removeCutSegment(cutSegments, hSegment(xLeft, xRight, yBottom));
  removeCutSegment(cutSegments, hSegment(xLeft, xRight, yTop));

  cutSegments.push(vSegment(xLeft, yBottom + c, yTop - c));
  cutSegments.push(hSegment(xLeft + c, xRight, yBottom));
  cutSegments.push(hSegment(xLeft + c, xRight, yTop));
  cutSegments.push(diagSegment(xLeft + c, yBottom, xLeft, yBottom + c));
  cutSegments.push(diagSegment(xLeft, yTop - c, xLeft + c, yTop));
  cutSegments.sort(compareSegments);
}

function applySideTabCornerChamfers(cutSegments, rectMm, chamferMm, outerEdge = 'left') {
  const c = Math.max(0, Number(chamferMm) || 0);
  const x = rectMm.x;
  const y = rectMm.y;
  const w = rectMm.width;
  const h = rectMm.height;
  if (!(c > 0) || w <= c || h <= c * 2) return;

  // Chamfer the outer edge (the edge furthest from the top face).
  const xOuter = outerEdge === 'right' ? x + w : x;
  const xInner = outerEdge === 'right' ? x : x + w;
  const yBottom = y;
  const yTop = y + h;

  removeCutSegment(cutSegments, vSegment(xOuter, yBottom, yTop));
  removeCutSegment(cutSegments, hSegment(Math.min(xOuter, xInner), Math.max(xOuter, xInner), yBottom));
  removeCutSegment(cutSegments, hSegment(Math.min(xOuter, xInner), Math.max(xOuter, xInner), yTop));

  cutSegments.push(vSegment(xOuter, yBottom + c, yTop - c));
  const xChamfer = xOuter + (outerEdge === 'right' ? -c : c);
  cutSegments.push(hSegment(Math.min(xChamfer, xInner), Math.max(xChamfer, xInner), yBottom));
  cutSegments.push(hSegment(Math.min(xChamfer, xInner), Math.max(xChamfer, xInner), yTop));
  cutSegments.push(diagSegment(xChamfer, yBottom, xOuter, yBottom + c));
  cutSegments.push(diagSegment(xOuter, yTop - c, xChamfer, yTop));
  cutSegments.sort(compareSegments);
}

function removeCutSegment(cutSegments, target) {
  const idx = cutSegments.findIndex(seg => sameSegment(seg, target, 1e-6));
  if (idx === -1) return false;
  cutSegments.splice(idx, 1);
  return true;
}

function removeSegment(segments, target, epsilon = 1e-6) {
  const idx = segments.findIndex(seg => sameSegment(seg, target, epsilon));
  if (idx === -1) return false;
  segments.splice(idx, 1);
  return true;
}

function segmentsInclude(segments, target, epsilon = 1e-6) {
  return segments.some(seg => sameSegment(seg, target, epsilon));
}

function applySkewedFlapTapers(cutSegments, rectMm, taperMm) {
  const t = Math.max(0, Number(taperMm) || 0);
  if (!(t > 0)) return;
  const x = rectMm.x;
  const y = rectMm.y;
  const w = rectMm.width;
  const h = rectMm.height;
  if (!(w > 0) || !(h > t * 2)) return;

  const x0 = x;
  const x1 = x + w;
  const y0 = y;
  const y1 = y + h;

  // Replace the top and bottom cut edges with full-width diagonals, and chamfer the outer corners.
  const topEdge = hSegment(x0, x1, y1);
  const bottomEdge = hSegment(x0, x1, y0);
  const outerEdge = vSegment(x1, y0, y1);

  if (!segmentsInclude(cutSegments, topEdge)) return;
  if (!segmentsInclude(cutSegments, bottomEdge)) return;
  if (!segmentsInclude(cutSegments, outerEdge)) return;

  removeSegment(cutSegments, topEdge);
  removeSegment(cutSegments, bottomEdge);
  removeSegment(cutSegments, outerEdge);

  cutSegments.push(diagSegment(x0, y1, x1, y1 - t));
  cutSegments.push(diagSegment(x0, y0, x1, y0 + t));
  cutSegments.push(vSegment(x1, y0 + t, y1 - t));

  cutSegments.sort(compareSegments);
}

function vSegment(x, y1, y2) {
  return { x1: x, y1: Math.min(y1, y2), x2: x, y2: Math.max(y1, y2) };
}

function diagSegment(x1, y1, x2, y2) {
  return { x1, y1, x2, y2 };
}

function moveSegmentBetweenLists(fromList, toList, target, epsilon = 1e-6) {
  const idx = fromList.findIndex(seg => sameSegment(seg, target, epsilon));
  if (idx === -1) return false;
  const [seg] = fromList.splice(idx, 1);
  toList.push(seg);
  toList.sort(compareSegments);
  return true;
}

function sameSegment(a, b, epsilon) {
  return (
    Math.abs(a.x1 - b.x1) <= epsilon &&
    Math.abs(a.y1 - b.y1) <= epsilon &&
    Math.abs(a.x2 - b.x2) <= epsilon &&
    Math.abs(a.y2 - b.y2) <= epsilon
  );
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

function normalizePageSize(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'letter' ? 'letter' : 'a4';
}

function pickPageOrientation({ netWidthMm, netHeightMm, marginMm, requestedOrientation, basePage }) {
  const candidates = [];

  const tryOrientation = (orientation, pageWidthMm, pageHeightMm) => {
    const usableW = pageWidthMm - marginMm * 2;
    const usableH = pageHeightMm - marginMm * 2;
    const fits = netWidthMm <= usableW && netHeightMm <= usableH;
    candidates.push({ orientation, pageWidthMm, pageHeightMm, fits, usableW, usableH });
  };

  if (requestedOrientation === 'portrait') {
    tryOrientation('portrait', basePage.pageWidthMm, basePage.pageHeightMm);
  } else if (requestedOrientation === 'landscape') {
    tryOrientation('landscape', basePage.pageHeightMm, basePage.pageWidthMm);
  } else {
    tryOrientation('portrait', basePage.pageWidthMm, basePage.pageHeightMm);
    tryOrientation('landscape', basePage.pageHeightMm, basePage.pageWidthMm);
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
