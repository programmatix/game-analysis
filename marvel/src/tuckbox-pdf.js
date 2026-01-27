const fs = require('fs');
const path = require('path');
const {
  PDFDocument,
  rgb,
  degrees,
  StandardFonts,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
  setDashPattern,
  setLineWidth,
  setStrokingColor,
  stroke,
} = require('pdf-lib');
const { MM_TO_PT, mmToPt } = require('../../shared/pdf-layout');
const { applyRoundedRectClip, restoreGraphicsState } = require('../../shared/pdf-drawing');
const { embedImage } = require('./image-utils');
const { computeTuckBoxLayout } = require('./tuckbox-layout');
const { loadMarvelChampionsFonts } = require('./mc-fonts');

const PDF_OPS = {
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
};

async function buildTuckBoxPdf(options) {
  const layout = computeTuckBoxLayout(options);
  const duplex = options.duplex !== false;

  const pdfDoc = await PDFDocument.create();
  const { fonts, warnings: fontWarnings } = await loadMarvelChampionsFonts(pdfDoc, {
    fontsDir: options.fontsDir,
    overrides: options.fontOverrides,
    neededKeys: ['title', 'body', 'heroAlterEgo', 'mouseprint'],
  });
  const guideFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageFront = pdfDoc.addPage([mmToPt(layout.pageWidthMm), mmToPt(layout.pageHeightMm)]);
  const pageBack = duplex ? pdfDoc.addPage([mmToPt(layout.pageWidthMm), mmToPt(layout.pageHeightMm)]) : null;

  const palette = {
    background: rgb(0.05, 0.06, 0.08),
    panel: rgb(0.09, 0.1, 0.13),
    marvelBlue: rgb(28 / 255, 74 / 255, 112 / 255),
    fold: rgb(0.55, 0.55, 0.55),
    cut: rgb(0, 0, 0),
    accent: parseHexColor(options.accent || '#f7d117', rgb(0.97, 0.82, 0.09)),
    white: rgb(1, 1, 1),
  };

  pageFront.drawRectangle({
    x: 0,
    y: 0,
    width: pageFront.getWidth(),
    height: pageFront.getHeight(),
    color: rgb(1, 1, 1),
  });

  if (pageBack) {
    pageBack.drawRectangle({
      x: 0,
      y: 0,
      width: pageBack.getWidth(),
      height: pageBack.getHeight(),
      color: rgb(1, 1, 1),
    });
  }

  drawBasePanels(pageFront, layout, palette);
  if (pageBack) drawBackSideBase(pageBack, layout, palette);

  const imageCache = new Map();
  const artPath = resolveOptionalPath(options.artPath || options.art, defaultCyclopsArtPath());
  if (artPath) {
    const embeddedArt = await embedImage(pdfDoc, artPath, imageCache);
    drawFrontArt(pageFront, embeddedArt, layout.body.front, palette, {
      offsetsMm: { x: Number(options.frontArtOffsetXMm) || 0, y: Number(options.frontArtOffsetYMm) || 0 },
    });
    drawTopArt(pageFront, embeddedArt, layout.topFace, palette, {
      offsetsMm: { x: Number(options.topArtOffsetXMm) || 0, y: Number(options.topArtOffsetYMm) || 0 },
    });
  }

  const backPath = resolveOptionalPath(options.backPath || options.backArt || options.back, defaultCardBackPath());
  if (backPath) {
    const embeddedBack = await embedImage(pdfDoc, backPath, imageCache);
    drawBackArt(pageFront, embeddedBack, layout.body.back, palette, { duplex });
  }

  const heroName = String(options.heroName || options.hero || '').trim();
  const miscText = normalizeMiscText(options.miscText ?? options.text ?? '');

  if (!options.noLogo) {
    const logoPath = resolveOptionalPath(options.logoPath || options.logo, defaultLogoPath());
    if (logoPath) {
      const embeddedLogo = await embedImage(pdfDoc, logoPath, imageCache);
      drawFrontLogoImage(pageFront, embeddedLogo, layout.body.front);
    }
  }

  drawFrontText(pageFront, fonts, layout.body.front, { heroName, miscText }, palette);
  drawTopText(pageFront, fonts, layout.topFace, { heroName, miscText }, palette);
  drawFrontGlueMarks(pageFront, { guideFont }, layout, palette, { duplex });

  if (pageBack) {
    drawGuides(pageBack, layout, palette);
    drawLineLabels(pageBack, { guideFont }, layout, palette);
    drawZoneLabels(pageBack, { guideFont }, layout, palette);
    drawLegend(pageBack, { guideFont }, layout, palette, { duplex: true });
  } else {
    drawGlueLabel(pageFront, fonts, layout.body.glue, palette);
    drawGuides(pageFront, layout, palette);
    drawLineLabels(pageFront, { guideFont }, layout, palette);
    drawZoneLabels(pageFront, { guideFont }, layout, palette);
    drawLegend(pageFront, { guideFont }, layout, palette, { duplex: false });
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return { pdfBytes, layout, fontWarnings };
}

const TOP_SAMPLE_VARIANTS = [
  { id: 'baseline', label: 'Baseline' },
  { id: 'double-frame', label: 'Double frame' },
  { id: 'brackets', label: 'Brackets + bar' },
  { id: 'stripes', label: 'Edge stripes' },
  { id: 'scanlines', label: 'Scanlines' },
  { id: 'burst', label: 'Burst' },
  { id: 'dots', label: 'Halftone corners' },
  { id: 'sash', label: 'Angled sash' },
  { id: 'tech', label: 'Tech lines' },
  { id: 'rivets', label: 'Rivets' },
  { id: 'dashed', label: 'Dashed frame' },
  { id: 'grid', label: 'Grid' },
  { id: 'split', label: 'Split + accent' },
  { id: 'tape', label: 'Tape' },
  { id: 'chevrons', label: 'Chevrons' },
  { id: 'neon', label: 'Neon' },
];

async function buildTuckBoxTopSampleSheetPdf(options) {
  const baseLayout = computeTuckBoxLayout(options);

  const pdfDoc = await PDFDocument.create();
  const { fonts, warnings: fontWarnings } = await loadMarvelChampionsFonts(pdfDoc, {
    fontsDir: options.fontsDir,
    overrides: options.fontOverrides,
    neededKeys: ['title', 'body', 'mouseprint'],
  });
  const guideFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const palette = {
    background: rgb(0.05, 0.06, 0.08),
    panel: rgb(0.09, 0.1, 0.13),
    marvelBlue: rgb(28 / 255, 74 / 255, 112 / 255),
    fold: rgb(0.55, 0.55, 0.55),
    cut: rgb(0, 0, 0),
    accent: parseHexColor(options.accent || '#f7d117', rgb(0.97, 0.82, 0.09)),
    white: rgb(1, 1, 1),
  };

  const sheet = resolveSampleSheetLayout(options);
  const page = pdfDoc.addPage([mmToPt(sheet.pageWidthMm), mmToPt(sheet.pageHeightMm)]);
  page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: rgb(1, 1, 1) });

  const imageCache = new Map();
  const artPath = resolveOptionalPath(options.artPath || options.art, defaultCyclopsArtPath());
  const embeddedArt = artPath ? await embedImage(pdfDoc, artPath, imageCache) : null;

  let embeddedLogo = null;
  if (!options.noLogo) {
    const logoPath = resolveOptionalPath(options.logoPath || options.logo, defaultLogoPath());
    if (logoPath) embeddedLogo = await embedImage(pdfDoc, logoPath, imageCache);
  }

  const heroName = String(options.heroName || options.hero || '').trim();
  const miscText = normalizeMiscText(options.miscText ?? options.text ?? '');

  const header = `Tuckbox top samples — ${heroName || 'Hero'}`;
  drawTextMm(page, guideFont, header, { x: sheet.marginMm, y: sheet.pageHeightMm - sheet.marginMm - 4.5 }, { sizeMm: 3.6, color: palette.cut });
  const sub = `Grid: ${sheet.rows}×${sheet.columns}  •  Variants: ${Math.min(sheet.count, sheet.rows * sheet.columns)}`;
  drawTextMm(page, guideFont, sub, { x: sheet.marginMm, y: sheet.pageHeightMm - sheet.marginMm - 8.5 }, { sizeMm: 2.6, color: rgb(0.25, 0.25, 0.25) });

  const baseTopFaceMm = { width: baseLayout.topFace.width, height: baseLayout.topFace.height };

  for (let index = 0; index < sheet.count; index++) {
    const cell = sampleCellRectMm(sheet, index);
    if (!cell) break;

    const variant = TOP_SAMPLE_VARIANTS[index % TOP_SAMPLE_VARIANTS.length];
    const label = `#${String(index + 1).padStart(2, '0')} — ${variant.label}`;
    drawTextMm(page, guideFont, label, { x: cell.x, y: cell.y + 1.2 }, { sizeMm: 2.5, color: rgb(0.15, 0.15, 0.15) });

    const designArea = insetRectMm({ x: cell.x, y: cell.y + sheet.cellLabelHeightMm, width: cell.width, height: cell.height - sheet.cellLabelHeightMm }, 1);
    const designRect = fitRectAspectMm(designArea, baseTopFaceMm.width / baseTopFaceMm.height);

    drawTopSampleVariant(page, { fonts, guideFont }, designRect, { heroName, miscText }, palette, {
      embeddedArt,
      embeddedLogo,
      baseTopFaceMm,
      topArtOffsetXMm: Number(options.topArtOffsetXMm) || 0,
      topArtOffsetYMm: Number(options.topArtOffsetYMm) || 0,
      variantIndex: index,
    });
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return {
    pdfBytes,
    sheet: {
      pageWidthMm: sheet.pageWidthMm,
      pageHeightMm: sheet.pageHeightMm,
      orientation: sheet.orientation,
      columns: sheet.columns,
      rows: sheet.rows,
      count: sheet.count,
    },
    fontWarnings,
  };
}

function drawFrontGlueMarks(page, { guideFont }, layout, palette, { duplex }) {
  if (!duplex) return;
  const zones = buildZoneLabels(layout);
  for (const zone of zones) {
    const wantFrontGlue = (zone.isGlue && zone.glueFace === 'front') || zone.label === 'ZA';
    if (!wantFrontGlue) continue;
    drawFrontGlueMark(page, guideFont, zone.rectMm, palette);
  }
}

function drawFrontGlueMark(page, guideFont, rectMm, palette) {
  const safe = insetRectMm(rectMm, 1.5);
  if (safe.width <= 0 || safe.height <= 0) return;
  const label = 'GLUE';
  const sizeMm = fitTextSizeMm(guideFont, label, safe.width, Math.min(8, safe.height), 3);
  drawCenteredTextOutlineMm(page, guideFont, label, safe, {
    sizePt: mmToPt(sizeMm),
    color: rgb(1, 1, 1),
    outlineColor: rgb(0, 0, 0),
    outlineOffsetMm: 0.35,
  });
}

function drawBasePanels(page, layout, palette) {
  for (const r of layout.rects) {
    const isGlue = r.id === 'glue';
    const isSide = r.id === 'side-left' || r.id === 'side-right';
    const isBottom = r.id.startsWith('bottom-');
    const fill = isGlue ? rgb(0.96, 0.96, 0.96) : isSide || isBottom ? palette.marvelBlue : palette.panel;
    const opacity = isGlue ? 1 : 1;
    drawRectMm(page, r, { color: fill, opacity });
  }

  const accentBandMm = 6;
  for (const side of [layout.body.sideLeft, layout.body.sideRight]) {
    const band = {
      x: side.x,
      y: side.y + side.height - accentBandMm,
      width: side.width,
      height: accentBandMm,
    };
    drawRectMm(page, band, { color: palette.accent, opacity: 1 });
  }

  for (const base of [layout.body.back, layout.body.sideLeft, layout.body.sideRight]) {
    drawDiagonalStripes(page, base, palette, { densityMm: 10, alpha: 0.06 });
  }
}

function drawBackSideBase(page, layout, palette) {
  for (const r of layout.rects) {
    const isGlue = r.id === 'glue';
    const fill = isGlue ? rgb(0.95, 0.95, 0.95) : rgb(1, 1, 1);
    drawRectMm(page, r, { color: fill, opacity: 1 });
  }
}

function drawFrontArt(page, embeddedImage, rectMm, palette, { offsetsMm } = {}) {
  const paddingMm = 0;
  const target = insetRectMm(rectMm, paddingMm);
  drawImageCoverMm(page, embeddedImage, target, { clipRadiusMm: 0, offsetsMm });

  // Subtle vignette for text legibility.
  const overlayMm = insetRectMm(rectMm, 0);
  drawRectMm(page, overlayMm, { color: palette.background, opacity: 0.12 });
}

function drawTopArt(page, embeddedImage, rectMm, palette, { offsetsMm } = {}) {
  drawImageCoverMm(page, embeddedImage, rectMm, { clipRadiusMm: 0, opacity: 1, offsetsMm });
  drawRectMm(page, rectMm, { borderColor: palette.accent, borderWidthPt: 1.2 });
}

function drawBackArt(page, embeddedImage, rectMm, palette, { duplex } = {}) {
  drawImageCoverMm(page, embeddedImage, rectMm, { clipRadiusMm: 0, opacity: 1 });
  if (!duplex) drawRectMm(page, rectMm, { borderColor: palette.cut, borderWidthPt: 0.8 });
}

function drawFrontLogoImage(page, embeddedImage, frontMm) {
  const scale = 1.5;
  const maxWidthMm = Math.min(26 * scale, frontMm.width * 0.38 * scale);
  const maxHeightMm = 12 * scale;
  const x = frontMm.x + (frontMm.width - maxWidthMm) / 2;
  const y = frontMm.y + frontMm.height - maxHeightMm - 3;
  drawImageContainMm(page, embeddedImage, { x, y, width: maxWidthMm, height: maxHeightMm }, { opacity: 0.98 });
}

function drawFrontText(page, fonts, frontMm, { heroName, miscText }, palette) {
  const bottomBandMm = Math.max(22, frontMm.height * 0.28);
  const liftMm = 6;
  const band = { x: frontMm.x, y: frontMm.y + liftMm, width: frontMm.width, height: bottomBandMm };

  const safe = insetRectMm(band, 3);
  const title = heroName || 'Hero';
  const titleSizeMm = fitTextSizeMm(fonts.title, title, safe.width, 14, 6);
  const titleHeightMm = titleSizeMm * 1.15;

  const titleBox = { x: safe.x, y: safe.y + safe.height - titleHeightMm - 1, width: safe.width, height: titleHeightMm + 1 };
  drawCenteredTextShadowMm(page, fonts.title, title, titleBox, {
    sizePt: mmToPt(titleSizeMm),
    color: palette.white,
    shadowColor: rgb(0, 0, 0),
    shadowOffsetMm: { x: 0.5, y: -0.5 },
  });
  drawCenteredTextMm(page, fonts.title, title, titleBox, {
    sizePt: mmToPt(titleSizeMm),
    color: palette.white,
  });

  if (!miscText.lines.length) return;
  const miscFontMm = Math.min(5.2, titleSizeMm * 0.45);
  const miscBox = { x: safe.x, y: safe.y + 1, width: safe.width, height: safe.height - titleHeightMm - 2 };
  drawWrappedTextShadowMm(page, fonts.body, miscText.lines.join('\n'), miscBox, {
    sizePt: mmToPt(miscFontMm),
    color: rgb(0.95, 0.95, 0.95),
    shadowColor: rgb(0, 0, 0),
    shadowOffsetMm: { x: 0.35, y: -0.35 },
    align: 'center',
    maxLines: 3,
  });
  drawWrappedTextMm(page, fonts.body, miscText.lines.join('\n'), miscBox, {
    sizePt: mmToPt(miscFontMm),
    color: rgb(0.95, 0.95, 0.95),
    align: 'center',
    maxLines: 3,
  });
}

function drawTopText(page, fonts, topFaceMm, { heroName, miscText }, palette) {
  const layout = computeTopTextLayout(fonts, topFaceMm, { heroName, miscText });
  drawCenteredTextOutlineMm(page, fonts.title, layout.title, layout.titleBox, {
    sizePt: mmToPt(layout.titleSizeMm),
    color: palette.white,
    outlineColor: rgb(0, 0, 0),
    outlineOffsetMm: 0.35,
    yOffsetMm: -0.2,
  });

  if (!layout.miscText) return;
  drawWrappedTextOutlineMm(page, fonts.body, layout.miscText, layout.miscBox, {
    sizePt: mmToPt(layout.miscSizeMm),
    color: rgb(0.92, 0.92, 0.92),
    outlineColor: rgb(0, 0, 0),
    outlineOffsetMm: 0.3,
    align: 'center',
    maxLines: 2,
    valign: 'top',
  });
}

function computeTopTextLayout(fonts, topFaceMm, { heroName, miscText }) {
  const inset = insetRectMm(topFaceMm, 2);
  const yShiftDownMm = 1.2;

  const title = heroName || 'Hero';
  const titleSizeMm = fitTextSizeMm(fonts.title, title, inset.width, 8, 3.5);
  const titleHeightMm = titleSizeMm * 1.12;
  const titleBox = { x: inset.x, y: inset.y + inset.height - titleHeightMm - yShiftDownMm, width: inset.width, height: titleHeightMm };

  const miscTextNormalized = miscText?.lines?.length ? miscText.lines.join('\n') : '';
  const miscSizeMm = miscTextNormalized ? Math.min(3.6, titleSizeMm * 0.55) : 0;
  const miscBox = miscTextNormalized
    ? { x: inset.x, y: inset.y - yShiftDownMm, width: inset.width, height: inset.height - titleHeightMm + 0.5 }
    : null;

  return {
    inset,
    yShiftDownMm,
    title,
    titleSizeMm,
    titleBox,
    miscText: miscTextNormalized || null,
    miscSizeMm,
    miscBox,
  };
}

function drawSpineText(page, fonts, spineMm, { heroName }, palette, { flip }) {
  const label = String(heroName || '').trim();
  if (!label) return;

  const box = insetRectMm(spineMm, 2);
  const maxLenMm = box.height;
  const sizeMm = fitTextSizeMm(fonts.heroAlterEgo, label, maxLenMm, 9, 3);
  const sizePt = mmToPt(sizeMm);
  const centerPt = { x: mmToPt(box.x + box.width / 2), y: mmToPt(box.y + box.height / 2) };
  const textWidthPt = fonts.heroAlterEgo.widthOfTextAtSize(label, sizePt);
  const textHeightPt = sizePt;

  // pdf-lib rotates around (x,y). Compute an origin such that the rotated bounding box is centered.
  // With 90° CCW: bbox spans x ∈ [-h, 0], y ∈ [0, w], so center is (-h/2, w/2).
  // With -90° CW: bbox spans x ∈ [0, h], y ∈ [-w, 0], so center is (h/2, -w/2).
  const rotate = flip ? degrees(90) : degrees(-90);
  const originPt = flip
    ? { x: centerPt.x + textHeightPt / 2, y: centerPt.y - textWidthPt / 2 }
    : { x: centerPt.x - textHeightPt / 2, y: centerPt.y + textWidthPt / 2 };

  page.drawText(label, {
    x: originPt.x,
    y: originPt.y,
    size: sizePt,
    font: fonts.heroAlterEgo,
    color: palette.white,
    rotate,
    opacity: 0.9,
  });
}

function drawGlueLabel(page, fonts, glueMm, palette) {
  const label = 'GLUE';
  const box = insetRectMm(glueMm, 1.5);
  const sizeMm = fitTextSizeMm(fonts.mouseprint, label, box.width, 6, 3);
  const xPt = mmToPt(box.x + box.width / 2);
  const yPt = mmToPt(box.y + box.height / 2);
  page.drawText(label, {
    x: xPt,
    y: yPt,
    size: mmToPt(sizeMm),
    font: fonts.mouseprint,
    color: palette.cut,
    rotate: degrees(90),
    opacity: 0.55,
  });
}

function drawGuides(page, layout, palette) {
  for (const seg of layout.segments.fold) {
    drawDashedLineMm(page, seg, { color: palette.fold, thicknessPt: 0.6, dashMm: [2, 1.5] });
  }
  for (const seg of layout.segments.cut) {
    drawSolidLineMm(page, seg, { color: palette.cut, thicknessPt: 0.8 });
  }
}

function drawLineLabels(page, { guideFont }, layout, palette) {
  const candidates = collectSegmentsForLabels(layout);
  const labeled = pickNonOverlappingLabelSegments(page, guideFont, candidates);
  for (const item of labeled) {
    drawLineLabel(page, guideFont, item, palette);
  }
}

function collectSegmentsForLabels(layout) {
  const all = [];
  const cut = mergeAxisAlignedSegments(layout.segments.cut);
  const fold = mergeAxisAlignedSegments(layout.segments.fold);
  for (const seg of cut) all.push({ type: 'cut', seg });
  for (const seg of fold) all.push({ type: 'fold', seg });
  return all;
}

function pickNonOverlappingLabelSegments(page, guideFont, segments) {
  const pageWidthMm = ptToMm(page.getWidth());
  const pageHeightMm = ptToMm(page.getHeight());
  const minLenMm = { cut: 8, fold: 10 };

  const candidates = (Array.isArray(segments) ? segments : [])
    .map(item => ({
      ...item,
      kind: item.seg.y1 === item.seg.y2 ? 'h' : item.seg.x1 === item.seg.x2 ? 'v' : 'd',
      lengthMm: segmentLengthMm(item.seg),
    }))
    .filter(item => item.lengthMm >= (minLenMm[item.type] ?? 8));

  // Prefer diagonal labels (tapers), then longer segments.
  const priorityOrder = { d: 0, v: 1, h: 2 };
  candidates.sort((a, b) => {
    if (priorityOrder[a.kind] !== priorityOrder[b.kind]) return priorityOrder[a.kind] - priorityOrder[b.kind];
    if (b.lengthMm !== a.lengthMm) return b.lengthMm - a.lengthMm;
    return compareForStableLineOrder(a, b);
  });

  const placed = [];
  const reserved = [];
  const templateLabel = 'L999';

  for (const item of candidates) {
    const boxMm = computeLineLabelBoxMm(pageWidthMm, pageHeightMm, guideFont, templateLabel, item.type, item.seg);
    if (boxMm.width <= 0 || boxMm.height <= 0) continue;
    if (reserved.some(r => rectsOverlapMm(r, boxMm, 0.8))) continue;
    reserved.push(boxMm);
    placed.push(item);
  }

  // Number remaining segments in a stable, spatial order.
  placed.sort(compareForStableLineOrder);
  return placed.map((item, idx) => ({ ...item, label: `L${idx + 1}` }));
}

function segmentLengthMm(seg) {
  const dx = Number(seg.x2) - Number(seg.x1);
  const dy = Number(seg.y2) - Number(seg.y1);
  return Math.sqrt(dx * dx + dy * dy);
}

function compareForStableLineOrder(a, b) {
  const aKind = a.kind ?? (a.seg.y1 === a.seg.y2 ? 'h' : a.seg.x1 === a.seg.x2 ? 'v' : 'd');
  const bKind = b.kind ?? (b.seg.y1 === b.seg.y2 ? 'h' : b.seg.x1 === b.seg.x2 ? 'v' : 'd');
  const order = { h: 0, v: 1, d: 2 };
  if (aKind !== bKind) return order[aKind] - order[bKind];

  if (aKind === 'h') {
    if (a.seg.y1 !== b.seg.y1) return a.seg.y1 - b.seg.y1;
    if (a.seg.x1 !== b.seg.x1) return a.seg.x1 - b.seg.x1;
    if (a.seg.x2 !== b.seg.x2) return a.seg.x2 - b.seg.x2;
  } else if (aKind === 'v') {
    if (a.seg.x1 !== b.seg.x1) return a.seg.x1 - b.seg.x1;
    if (a.seg.y1 !== b.seg.y1) return a.seg.y1 - b.seg.y1;
    if (a.seg.y2 !== b.seg.y2) return a.seg.y2 - b.seg.y2;
  } else {
    const aMinY = Math.min(a.seg.y1, a.seg.y2);
    const bMinY = Math.min(b.seg.y1, b.seg.y2);
    if (aMinY !== bMinY) return aMinY - bMinY;
    const aMinX = Math.min(a.seg.x1, a.seg.x2);
    const bMinX = Math.min(b.seg.x1, b.seg.x2);
    if (aMinX !== bMinX) return aMinX - bMinX;
    const aMaxY = Math.max(a.seg.y1, a.seg.y2);
    const bMaxY = Math.max(b.seg.y1, b.seg.y2);
    if (aMaxY !== bMaxY) return aMaxY - bMaxY;
    const aMaxX = Math.max(a.seg.x1, a.seg.x2);
    const bMaxX = Math.max(b.seg.x1, b.seg.x2);
    if (aMaxX !== bMaxX) return aMaxX - bMaxX;
  }

  if (a.type !== b.type) return a.type === 'cut' ? -1 : 1;
  return 0;
}

function computeLineLabelBoxMm(pageWidthMm, pageHeightMm, guideFont, label, type, seg) {
  const isH = seg.y1 === seg.y2;
  const isV = seg.x1 === seg.x2;
  const midX = (seg.x1 + seg.x2) / 2;
  const midY = (seg.y1 + seg.y2) / 2;
  const sub = type === 'cut' ? 'CUT' : 'FOLD';

  const sizeMm = 2.8;
  const subSizeMm = 2.2;
  const padMm = 0.8;

  const sizePt = mmToPt(sizeMm);
  const subSizePt = mmToPt(subSizeMm);
  const textWPt = guideFont.widthOfTextAtSize(label, sizePt);
  const subWPt = guideFont.widthOfTextAtSize(sub, subSizePt);
  const boxWPt = Math.max(textWPt, subWPt) + mmToPt(padMm * 2);
  const boxHPt = sizePt + subSizePt + mmToPt(padMm * 2) + mmToPt(0.5);

  const offsetMm = 1.2;
  const anchorMm = isH ? { x: midX, y: midY + offsetMm } : isV ? { x: midX + offsetMm, y: midY } : { x: midX + offsetMm, y: midY + offsetMm };
  let boxMm = {
    x: anchorMm.x - ptToMm(boxWPt) / 2,
    y: anchorMm.y - ptToMm(boxHPt) / 2,
    width: ptToMm(boxWPt),
    height: ptToMm(boxHPt),
  };

  boxMm = {
    ...boxMm,
    x: Math.max(0, Math.min(boxMm.x, pageWidthMm - boxMm.width)),
    y: Math.max(0, Math.min(boxMm.y, pageHeightMm - boxMm.height)),
  };

  return boxMm;
}

function rectsOverlapMm(a, b, paddingMm = 0) {
  const pad = Number(paddingMm) || 0;
  return !(
    a.x + a.width + pad <= b.x ||
    b.x + b.width + pad <= a.x ||
    a.y + a.height + pad <= b.y ||
    b.y + b.height + pad <= a.y
  );
}

function mergeAxisAlignedSegments(segments, epsilon = 1e-6) {
  const horizontals = new Map(); // y -> [{x1,x2}]
  const verticals = new Map(); // x -> [{y1,y2}]
  const others = [];

  for (const seg of Array.isArray(segments) ? segments : []) {
    const isH = seg.y1 === seg.y2;
    const isV = seg.x1 === seg.x2;
    if (isH) {
      const y = seg.y1;
      const x1 = Math.min(seg.x1, seg.x2);
      const x2 = Math.max(seg.x1, seg.x2);
      const key = y.toFixed(6);
      if (!horizontals.has(key)) horizontals.set(key, { y, spans: [] });
      horizontals.get(key).spans.push({ x1, x2 });
    } else if (isV) {
      const x = seg.x1;
      const y1 = Math.min(seg.y1, seg.y2);
      const y2 = Math.max(seg.y1, seg.y2);
      const key = x.toFixed(6);
      if (!verticals.has(key)) verticals.set(key, { x, spans: [] });
      verticals.get(key).spans.push({ y1, y2 });
    } else {
      others.push(seg);
    }
  }

  const merged = [];

  for (const { y, spans } of horizontals.values()) {
    spans.sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2);
    let current = null;
    for (const span of spans) {
      if (!current) {
        current = { ...span };
        continue;
      }
      if (span.x1 <= current.x2 + epsilon) {
        current.x2 = Math.max(current.x2, span.x2);
      } else {
        merged.push({ x1: current.x1, y1: y, x2: current.x2, y2: y });
        current = { ...span };
      }
    }
    if (current) merged.push({ x1: current.x1, y1: y, x2: current.x2, y2: y });
  }

  for (const { x, spans } of verticals.values()) {
    spans.sort((a, b) => a.y1 - b.y1 || a.y2 - b.y2);
    let current = null;
    for (const span of spans) {
      if (!current) {
        current = { ...span };
        continue;
      }
      if (span.y1 <= current.y2 + epsilon) {
        current.y2 = Math.max(current.y2, span.y2);
      } else {
        merged.push({ x1: x, y1: current.y1, x2: x, y2: current.y2 });
        current = { ...span };
      }
    }
    if (current) merged.push({ x1: x, y1: current.y1, x2: x, y2: current.y2 });
  }

  merged.push(...others);
  return merged;
}

function drawLineLabel(page, guideFont, { label, type, seg }, palette) {
  const isH = seg.y1 === seg.y2;
  const isV = seg.x1 === seg.x2;
  const midX = (seg.x1 + seg.x2) / 2;
  const midY = (seg.y1 + seg.y2) / 2;
  const color = type === 'cut' ? palette.cut : palette.fold;
  const sub = type === 'cut' ? 'CUT' : 'FOLD';

  const sizeMm = 2.8;
  const subSizeMm = 2.2;
  const padMm = 0.8;

  const sizePt = mmToPt(sizeMm);
  const subSizePt = mmToPt(subSizeMm);
  const textWPt = guideFont.widthOfTextAtSize(label, sizePt);
  const subWPt = guideFont.widthOfTextAtSize(sub, subSizePt);
  const boxWPt = Math.max(textWPt, subWPt) + mmToPt(padMm * 2);
  const boxHPt = sizePt + subSizePt + mmToPt(padMm * 2) + mmToPt(0.5);

  const offsetMm = 1.2;
  const anchorMm = isH ? { x: midX, y: midY + offsetMm } : isV ? { x: midX + offsetMm, y: midY } : { x: midX + offsetMm, y: midY + offsetMm };
  let boxMm = {
    x: anchorMm.x - ptToMm(boxWPt) / 2,
    y: anchorMm.y - ptToMm(boxHPt) / 2,
    width: ptToMm(boxWPt),
    height: ptToMm(boxHPt),
  };

  const pageWidthMm = ptToMm(page.getWidth());
  const pageHeightMm = ptToMm(page.getHeight());
  boxMm = {
    ...boxMm,
    x: Math.max(0, Math.min(boxMm.x, pageWidthMm - boxMm.width)),
    y: Math.max(0, Math.min(boxMm.y, pageHeightMm - boxMm.height)),
  };

  drawRectMm(page, boxMm, { color: rgb(1, 1, 1), opacity: 0.85 });
  drawRectMm(page, boxMm, { borderColor: color, borderWidthPt: 0.4 });

  const textXPt = mmToPt(boxMm.x + boxMm.width / 2) - textWPt / 2;
  const topYPt = mmToPt(boxMm.y + boxMm.height) - mmToPt(padMm) - sizePt;
  page.drawText(label, { x: textXPt, y: topYPt, size: sizePt, font: guideFont, color });

  const subXPt = mmToPt(boxMm.x + boxMm.width / 2) - subWPt / 2;
  const subYPt = topYPt - subSizePt - mmToPt(0.4);
  page.drawText(sub, { x: subXPt, y: subYPt, size: subSizePt, font: guideFont, color });
}

function drawZoneLabels(page, { guideFont }, layout, palette) {
  const zones = buildZoneLabels(layout);
  for (const zone of zones) {
    drawZoneLabel(page, guideFont, zone, palette);
  }
}

function buildZoneLabels(layout) {
  const zones = [];
  const zoneIds = new Map([
    ['glue', 'ZA'],
    ['back', 'ZB'],
    ['side-left', 'ZC'],
    ['front', 'ZD'],
    ['side-right', 'ZE'],
    ['bottom-back-tuck', 'ZI'],
    ['bottom-side-left', 'ZJ'],
    ['top-face', 'ZM'],
    ['top-tuck-tab', 'ZN'],
    ['bottom-tuck-tab', 'ZO'],
    ['top-face-tab-left', 'ZP'],
    ['top-face-tab-right', 'ZQ'],
  ]);

  const pushRect = rectMm => {
    const label = zoneIds.get(rectMm.id);
    if (!label) return;
    const isGlue = rectMm.id === 'glue';
    zones.push({ rectMm, label, isGlue, glueFace: null });
  };

  for (const r of layout.rects) {
    // Hide the big combined tuck flap; we label the face + tuck tab separately.
    if (r.id === 'top-front-tuck') continue;
    pushRect(r);
  }

  pushRect(layout.topFace);

  const topFrontTuck = layout.flaps?.topFrontTuck;
  if (topFrontTuck && topFrontTuck.height > layout.topFace.height) {
    pushRect({
      id: 'top-tuck-tab',
      x: layout.topFace.x,
      y: layout.topFace.y + layout.topFace.height,
      width: layout.topFace.width,
      height: topFrontTuck.height - layout.topFace.height,
    });
  }

  const bottomBackTuck = layout.flaps?.bottomBackTuck;
  const tuckExtraMm = Number(layout.dimensionsMm?.tuckExtraMm) || 0;
  if (bottomBackTuck && tuckExtraMm > 0 && bottomBackTuck.height > tuckExtraMm) {
    pushRect({
      id: 'bottom-tuck-tab',
      x: bottomBackTuck.x,
      y: bottomBackTuck.y,
      width: bottomBackTuck.width,
      height: tuckExtraMm,
    });
  }

  for (const zone of zones) {
    if (zone.label === 'ZJ' || zone.label === 'ZO') {
      zone.isGlue = true;
      zone.glueFace = 'front';
    }
  }

  return zones;
}

function drawZoneLabel(page, guideFont, { rectMm, label, isGlue, glueFace }, palette) {
  const safe = insetRectMm(rectMm, 1.4);
  if (safe.width <= 0 || safe.height <= 0) return;

  const zoneSizeMm = fitTextSizeMm(guideFont, label, safe.width, Math.min(10, safe.height), 2.8);
  const zoneBox = { x: safe.x, y: safe.y + safe.height / 2 - zoneSizeMm * 0.8, width: safe.width, height: zoneSizeMm * 1.6 };
  drawCenteredTextMm(page, guideFont, label, zoneBox, {
    sizePt: mmToPt(zoneSizeMm),
    color: isGlue ? rgb(0.2, 0.2, 0.2) : rgb(0.1, 0.1, 0.1),
  });

  if (!isGlue || glueFace === 'front') return;
  const glueText = 'GLUE';
  const subSizeMm = Math.min(3.1, zoneSizeMm * 0.68);
  const subBox = { x: safe.x, y: safe.y + 1, width: safe.width, height: subSizeMm * 1.6 };
  drawWrappedTextMm(page, guideFont, glueText, subBox, {
    sizePt: mmToPt(subSizeMm),
    color: rgb(0.25, 0.25, 0.25),
    align: 'center',
    maxLines: 2,
    valign: 'bottom',
  });
}

function drawLegend(page, { guideFont }, layout, palette, { duplex } = {}) {
  const paddingMm = 6;
  const legend = {
    x: paddingMm,
    y: paddingMm,
    width: 70,
    height: duplex ? 30 : 22,
  };

  drawRectMm(page, legend, { color: rgb(1, 1, 1), opacity: 0.9 });
  drawRectMm(page, legend, { borderColor: palette.cut, borderWidthPt: 0.6 });

  const title = `Marvel Champions tuckbox (${layout.orientation} A4)${duplex ? ' duplex' : ''}`;
  drawTextMm(page, guideFont, title, { x: legend.x + 3, y: legend.y + legend.height - 7 }, { sizeMm: 3.2, color: palette.cut });

  const dims = layout.dimensionsMm;
  const line1 = `Inner: ${format1(dims.innerHeightMm)}×${format1(dims.innerWidthMm)}×${format1(dims.innerDepthMm)}mm`;
  drawTextMm(page, guideFont, line1, { x: legend.x + 3, y: legend.y + legend.height - 12 }, { sizeMm: 2.7, color: palette.cut });

  const cutY = legend.y + 6.5;
  drawSolidLineMm(page, { x1: legend.x + 3, y1: cutY, x2: legend.x + 18, y2: cutY }, { color: palette.cut, thicknessPt: 0.8 });
  drawTextMm(page, guideFont, 'Cut', { x: legend.x + 20, y: cutY - 1 }, { sizeMm: 2.8, color: palette.cut });

  const foldY = legend.y + 3;
  drawDashedLineMm(page, { x1: legend.x + 3, y1: foldY, x2: legend.x + 18, y2: foldY }, { color: palette.fold, thicknessPt: 0.6, dashMm: [2, 1.5] });
  drawTextMm(page, guideFont, 'Fold', { x: legend.x + 20, y: foldY - 1 }, { sizeMm: 2.8, color: palette.cut });

  if (duplex) {
    drawTextMm(page, guideFont, 'Back side: cut/fold + ZA/L# labels', { x: legend.x + 3, y: legend.y + 1.2 }, { sizeMm: 2.6, color: palette.cut });
  }
}

function drawDiagonalStripes(page, rectMm, palette, { densityMm, alpha }) {
  const stepMm = Math.max(4, Number(densityMm) || 10);
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0.06));
  const r = insetRectMm(rectMm, 0);
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.width;
  const y1 = r.y + r.height;

  for (let x = x0 - r.height; x <= x1; x += stepMm) {
    const start = { x: x, y: y0 };
    const end = { x: x + r.height, y: y1 };
    drawSolidLineMm(page, { x1: start.x, y1: start.y, x2: end.x, y2: end.y }, { color: palette.white, thicknessPt: 0.6, opacity });
  }
}

function drawImageCoverMm(page, embeddedImage, rectMm, { clipRadiusMm = 0, opacity = 1, offsetsMm } = {}) {
  const { width, height } = embeddedImage.scale(1);
  const targetW = rectMm.width;
  const targetH = rectMm.height;
  const scale = Math.max(targetW / ptToMm(width), targetH / ptToMm(height));
  const drawW = ptToMm(width) * scale;
  const drawH = ptToMm(height) * scale;
  const offsetX = Number(offsetsMm?.x) || 0;
  const offsetY = Number(offsetsMm?.y) || 0;
  const x = rectMm.x + (targetW - drawW) / 2 + offsetX;
  const y = rectMm.y + (targetH - drawH) / 2 + offsetY;

  const clipRadiusPt = mmToPt(clipRadiusMm);
  applyRoundedRectClip(page, PDF_OPS, {
    x: mmToPt(rectMm.x),
    y: mmToPt(rectMm.y),
    width: mmToPt(rectMm.width),
    height: mmToPt(rectMm.height),
    radius: clipRadiusPt,
  });

  page.drawImage(embeddedImage, {
    x: mmToPtCoord(x),
    y: mmToPtCoord(y),
    width: mmToPt(drawW),
    height: mmToPt(drawH),
    opacity,
  });

  restoreGraphicsState(page, PDF_OPS);
}

function drawImageContainMm(page, embeddedImage, rectMm, { opacity = 1 } = {}) {
  const { width, height } = embeddedImage.scale(1);
  const imgW = ptToMm(width);
  const imgH = ptToMm(height);
  const scale = Math.min(rectMm.width / imgW, rectMm.height / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const x = rectMm.x + (rectMm.width - drawW) / 2;
  const y = rectMm.y + (rectMm.height - drawH) / 2;

  page.drawImage(embeddedImage, {
    x: mmToPtCoord(x),
    y: mmToPtCoord(y),
    width: mmToPt(drawW),
    height: mmToPt(drawH),
    opacity,
  });
}

function drawRectMm(page, rectMm, { color, opacity, borderColor, borderWidthPt } = {}) {
  const props = {
    x: mmToPt(rectMm.x),
    y: mmToPt(rectMm.y),
    width: mmToPt(rectMm.width),
    height: mmToPt(rectMm.height),
  };
  if (color) props.color = color;
  if (Number.isFinite(opacity)) props.opacity = opacity;
  if (borderColor) props.borderColor = borderColor;
  if (Number.isFinite(borderWidthPt)) props.borderWidth = borderWidthPt;
  page.drawRectangle(props);
}

function insetRectMm(rectMm, insetMm) {
  const inset = Number(insetMm) || 0;
  return {
    x: rectMm.x + inset,
    y: rectMm.y + inset,
    width: Math.max(0, rectMm.width - inset * 2),
    height: Math.max(0, rectMm.height - inset * 2),
  };
}

function expandRectMm(rectMm, expandMm) {
  const expand = Number(expandMm) || 0;
  return {
    x: rectMm.x - expand,
    y: rectMm.y - expand,
    width: rectMm.width + expand * 2,
    height: rectMm.height + expand * 2,
  };
}

function fitRectAspectMm(containerMm, aspectWidthOverHeight) {
  const aspect = Number(aspectWidthOverHeight) || 1;
  const safe = insetRectMm(containerMm, 0);
  let width = safe.width;
  let height = width / aspect;
  if (height > safe.height) {
    height = safe.height;
    width = height * aspect;
  }
  return {
    x: safe.x + (safe.width - width) / 2,
    y: safe.y + (safe.height - height) / 2,
    width,
    height,
  };
}

function clampInt(value, { min = 1, max = 999 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function resolveSampleSheetLayout(options) {
  const pageSize = String(options.pageSize || options.sheetPageSize || 'a4')
    .trim()
    .toLowerCase();
  const base = pageSize === 'letter' ? { widthMm: 215.9, heightMm: 279.4 } : { widthMm: 210, heightMm: 297 };

  const columns = clampInt(options.columns ?? options.cols ?? 4, { min: 1, max: 10 });
  const rows = clampInt(options.rows ?? 4, { min: 1, max: 10 });
  const count = clampInt(options.count ?? columns * rows, { min: 1, max: columns * rows });

  const marginMm = Number(options.sheetMarginMm ?? options.marginMm ?? 8);
  const gutterMm = Number(options.gutterMm ?? options.sheetGutterMm ?? 3);
  const headerHeightMm = Number(options.sheetHeaderHeightMm ?? 12);
  const cellLabelHeightMm = Number(options.cellLabelHeightMm ?? 6);

  const requested = String(options.sheetOrientation || options.orientation || 'auto')
    .trim()
    .toLowerCase();

  function layoutFor(orientation) {
    const pageWidthMm = orientation === 'landscape' ? base.heightMm : base.widthMm;
    const pageHeightMm = orientation === 'landscape' ? base.widthMm : base.heightMm;
    const grid = {
      x: marginMm,
      y: marginMm,
      width: Math.max(1, pageWidthMm - marginMm * 2),
      height: Math.max(1, pageHeightMm - marginMm * 2 - headerHeightMm),
    };
    const cellWidthMm = (grid.width - gutterMm * (columns - 1)) / columns;
    const cellHeightMm = (grid.height - gutterMm * (rows - 1)) / rows;
    return { orientation, pageWidthMm, pageHeightMm, grid, cellWidthMm, cellHeightMm };
  }

  const portrait = layoutFor('portrait');
  const landscape = layoutFor('landscape');
  const chosen =
    requested === 'portrait'
      ? portrait
      : requested === 'landscape'
        ? landscape
        : landscape.cellWidthMm >= portrait.cellWidthMm
          ? landscape
          : portrait;

  return {
    ...chosen,
    pageSize,
    columns,
    rows,
    count,
    marginMm,
    gutterMm,
    headerHeightMm,
    cellLabelHeightMm,
  };
}

function sampleCellRectMm(sheet, index) {
  const col = index % sheet.columns;
  const row = Math.floor(index / sheet.columns);
  if (row >= sheet.rows) return null;

  const x = sheet.grid.x + col * (sheet.cellWidthMm + sheet.gutterMm);
  const y = sheet.grid.y + (sheet.rows - 1 - row) * (sheet.cellHeightMm + sheet.gutterMm);
  return { x, y, width: sheet.cellWidthMm, height: sheet.cellHeightMm };
}

function withClipRectMm(page, rectMm, fn) {
  applyRoundedRectClip(page, PDF_OPS, {
    x: mmToPt(rectMm.x),
    y: mmToPt(rectMm.y),
    width: mmToPt(rectMm.width),
    height: mmToPt(rectMm.height),
    radius: 0,
  });
  try {
    fn();
  } finally {
    restoreGraphicsState(page, PDF_OPS);
  }
}

function drawTopSampleVariant(page, { fonts, guideFont }, rectMm, { heroName, miscText }, palette, assets) {
  const variantIndex = Number(assets.variantIndex) || 0;
  const embeddedArt = assets.embeddedArt;
  const embeddedLogo = assets.embeddedLogo;

  const baseTopWidthMm = Number(assets.baseTopFaceMm?.width) || rectMm.width;
  const scale = rectMm.width / baseTopWidthMm;
  const offsetsMm = {
    x: (Number(assets.topArtOffsetXMm) || 0) * scale,
    y: (Number(assets.topArtOffsetYMm) || 0) * scale,
  };

  if (embeddedArt) {
    drawImageCoverMm(page, embeddedArt, rectMm, { clipRadiusMm: 0, opacity: 1, offsetsMm });
  } else {
    drawRectMm(page, rectMm, { color: palette.panel, opacity: 1 });
  }

  const idx = variantIndex % TOP_SAMPLE_VARIANTS.length;
  const textLayout = computeTopTextLayout(fonts, rectMm, { heroName, miscText });

  const dark = rgb(0, 0, 0);
  const light = rgb(1, 1, 1);

  if (idx !== 0) {
    // Slight legibility lift for most variants.
    drawRectMm(page, rectMm, { color: dark, opacity: 0.06 });
  }

  switch (idx) {
    case 0: {
      drawRectMm(page, rectMm, { borderColor: palette.accent, borderWidthPt: 1.2 });
      drawTextPlateMm(page, textLayout, { style: 'soft', accent: palette.accent });
      break;
    }
    case 1: {
      drawRectMm(page, rectMm, { borderColor: palette.accent, borderWidthPt: 2.2 });
      drawRectMm(page, insetRectMm(rectMm, 0.9), { borderColor: light, borderWidthPt: 0.7 });
      drawCornerBracketsMm(page, rectMm, { color: light, thicknessPt: 1.0, lengthMm: 4.5, insetMm: 1.6, opacity: 0.9 });
      drawTextPlateMm(page, textLayout, { style: 'hard', accent: palette.accent });
      break;
    }
    case 2: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 2.4 });
      drawCornerBracketsMm(page, rectMm, { color: palette.accent, thicknessPt: 1.4, lengthMm: 6, insetMm: 1.5, opacity: 0.95 });
      drawAccentBarMm(page, expandRectMm(textLayout.titleBox, 0.6), { color: palette.accent, opacity: 0.75 });
      if (textLayout.miscBox) drawAccentBarMm(page, expandRectMm(textLayout.miscBox, 0.6), { color: dark, opacity: 0.35 });
      break;
    }
    case 3: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 1.6 });
      drawEdgeStripesMm(page, rectMm, { color: palette.accent, stripeMm: 1.9, opacity: 0.85 });
      withClipRectMm(page, insetRectMm(rectMm, 0.6), () => {
        drawDiagonalStripes(page, rectMm, { white: light }, { densityMm: 4.8, alpha: 0.06 });
      });
      drawTextPlateMm(page, textLayout, { style: 'soft', accent: palette.accent });
      break;
    }
    case 4: {
      drawRectMm(page, rectMm, { borderColor: palette.accent, borderWidthPt: 1.2 });
      withClipRectMm(page, insetRectMm(rectMm, 0.4), () => {
        drawScanlinesMm(page, rectMm, { color: light, alpha: 0.08, spacingMm: 0.85, thicknessPt: 0.35 });
      });
      drawTextPlateMm(page, textLayout, { style: 'hard', accent: palette.accent });
      break;
    }
    case 5: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 2.0 });
      withClipRectMm(page, rectMm, () => {
        drawRadialBurstMm(page, rectMm, { color: palette.accent, alpha: 0.18, rays: 22, thicknessPt: 0.6 });
      });
      drawTextPlateMm(page, textLayout, { style: 'badge', accent: palette.accent });
      break;
    }
    case 6: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 2.8 });
      drawRectMm(page, insetRectMm(rectMm, 1.0), { borderColor: light, borderWidthPt: 0.6 });
      withClipRectMm(page, rectMm, () => {
        drawCornerHalftoneMm(page, rectMm, { color: light, alpha: 0.12, dotMm: 0.6, pitchMm: 1.6, extentMm: 9 });
      });
      drawTextPlateMm(page, textLayout, { style: 'hard', accent: palette.accent });
      break;
    }
    case 7: {
      drawRectMm(page, rectMm, { borderColor: palette.accent, borderWidthPt: 1.4 });
      withClipRectMm(page, rectMm, () => {
        drawAngledSashMm(page, rectMm, { color: palette.accent, alpha: 0.7, angleDeg: -12 });
        drawAngledSashMm(page, rectMm, { color: dark, alpha: 0.28, angleDeg: -12, offsetMm: { x: 0.6, y: -0.6 } });
      });
      drawTextPlateMm(page, textLayout, { style: 'soft', accent: palette.accent });
      break;
    }
    case 8: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 2.0 });
      withClipRectMm(page, insetRectMm(rectMm, 0.8), () => {
        drawTechLinesMm(page, rectMm, { color: light, alpha: 0.12, accent: palette.accent });
      });
      if (embeddedLogo) drawCornerLogoMm(page, embeddedLogo, rectMm, { corner: 'top-left', opacity: 0.9 });
      drawTextPlateMm(page, textLayout, { style: 'hard', accent: palette.accent });
      break;
    }
    case 9: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 2.4 });
      drawRivetsMm(page, rectMm, { fill: rgb(0.85, 0.85, 0.85), stroke: rgb(0.1, 0.1, 0.1), radiusMm: 0.9 });
      drawTextPlateMm(page, textLayout, { style: 'metal', accent: palette.accent });
      break;
    }
    case 10: {
      drawRectMm(page, rectMm, { borderColor: palette.accent, borderWidthPt: 1.0 });
      drawDashedFrameMm(page, insetRectMm(rectMm, 1.0), { color: light, thicknessPt: 0.7, dashMm: [1.2, 0.9] });
      drawTextPlateMm(page, textLayout, { style: 'soft', accent: palette.accent });
      break;
    }
    case 11: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 1.8 });
      withClipRectMm(page, insetRectMm(rectMm, 0.5), () => {
        drawGridMm(page, rectMm, { color: light, alpha: 0.06, spacingMm: 2.6, thicknessPt: 0.4 });
      });
      drawTextPlateMm(page, textLayout, { style: 'hard', accent: palette.accent });
      break;
    }
    case 12: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 2.2 });
      withClipRectMm(page, rectMm, () => {
        drawRectMm(page, { x: rectMm.x, y: rectMm.y, width: rectMm.width * 0.4, height: rectMm.height }, { color: palette.accent, opacity: 0.24 });
        drawRectMm(page, { x: rectMm.x + rectMm.width * 0.4, y: rectMm.y, width: rectMm.width * 0.6, height: rectMm.height }, { color: dark, opacity: 0.1 });
        drawSolidLineMm(
          page,
          { x1: rectMm.x + rectMm.width * 0.4, y1: rectMm.y, x2: rectMm.x + rectMm.width * 0.4, y2: rectMm.y + rectMm.height },
          { color: light, thicknessPt: 0.7, opacity: 0.5 },
        );
      });
      if (embeddedLogo) drawCornerLogoMm(page, embeddedLogo, rectMm, { corner: 'bottom-right', opacity: 0.85 });
      drawTextPlateMm(page, textLayout, { style: 'soft', accent: palette.accent });
      break;
    }
    case 13: {
      drawRectMm(page, rectMm, { borderColor: palette.accent, borderWidthPt: 1.4 });
      withClipRectMm(page, rectMm, () => {
        drawTapeMm(page, rectMm, expandRectMm(textLayout.titleBox, 1.4), { angleDeg: -10, opacity: 0.32 });
        if (textLayout.miscBox) drawTapeMm(page, rectMm, expandRectMm(textLayout.miscBox, 1.4), { angleDeg: 8, opacity: 0.26 });
      });
      drawTextPlateMm(page, textLayout, { style: 'none', accent: palette.accent });
      break;
    }
    case 14: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 2.0 });
      withClipRectMm(page, insetRectMm(rectMm, 0.8), () => {
        drawChevronsMm(page, rectMm, { color: palette.accent, alpha: 0.16, spacingMm: 5.2, thicknessPt: 0.7 });
      });
      drawTextPlateMm(page, textLayout, { style: 'hard', accent: palette.accent });
      break;
    }
    case 15: {
      drawRectMm(page, rectMm, { borderColor: dark, borderWidthPt: 2.6 });
      drawRectMm(page, insetRectMm(rectMm, 0.8), { borderColor: palette.accent, borderWidthPt: 1.3 });
      withClipRectMm(page, rectMm, () => {
        drawGlowCornersMm(page, rectMm, { color: palette.accent, alpha: 0.2 });
      });
      drawTextPlateMm(page, textLayout, { style: 'hard', accent: palette.accent });
      break;
    }
    default:
      break;
  }

  drawTopText(page, fonts, rectMm, { heroName, miscText }, palette);
  if (idx !== 8 && embeddedLogo && idx % 4 === 1) drawCornerLogoMm(page, embeddedLogo, rectMm, { corner: 'top-right', opacity: 0.75 });

  if (idx !== 0) {
    const sample = TOP_SAMPLE_VARIANTS[idx]?.id || String(idx);
    const tag = { x: rectMm.x + 0.8, y: rectMm.y + 0.6, width: rectMm.width - 1.6, height: 2.8 };
    drawTextMm(page, guideFont, sample, { x: tag.x, y: tag.y }, { sizeMm: 2.0, color: rgb(0.2, 0.2, 0.2) });
  }
}

function drawTextPlateMm(page, textLayout, { style, accent }) {
  const dark = rgb(0, 0, 0);
  const light = rgb(1, 1, 1);
  const titlePlate = expandRectMm(textLayout.titleBox, 0.9);
  const miscPlate = textLayout.miscBox ? expandRectMm(textLayout.miscBox, 0.8) : null;

  if (style === 'none') return;

  if (style === 'soft') {
    drawRectMm(page, titlePlate, { color: dark, opacity: 0.24 });
    if (miscPlate) drawRectMm(page, miscPlate, { color: dark, opacity: 0.2 });
    return;
  }

  if (style === 'hard') {
    drawRectMm(page, titlePlate, { color: dark, opacity: 0.33 });
    drawRectMm(page, titlePlate, { borderColor: accent, borderWidthPt: 0.7 });
    if (miscPlate) drawRectMm(page, miscPlate, { color: dark, opacity: 0.26 });
    return;
  }

  if (style === 'metal') {
    drawRectMm(page, titlePlate, { color: rgb(0.85, 0.85, 0.88), opacity: 0.22 });
    drawRectMm(page, titlePlate, { borderColor: light, borderWidthPt: 0.6 });
    drawRectMm(page, titlePlate, { borderColor: accent, borderWidthPt: 0.35 });
    if (miscPlate) drawRectMm(page, miscPlate, { color: dark, opacity: 0.18 });
    return;
  }

  if (style === 'badge') {
    const badge = expandRectMm(textLayout.titleBox, 2.2);
    drawRectMm(page, badge, { color: dark, opacity: 0.28 });
    drawRectMm(page, badge, { borderColor: accent, borderWidthPt: 1.0 });
    return;
  }
}

function drawAccentBarMm(page, rectMm, { color, opacity }) {
  drawRectMm(page, rectMm, { color, opacity: Number.isFinite(opacity) ? opacity : 0.7 });
  drawRectMm(page, rectMm, { borderColor: rgb(0, 0, 0), borderWidthPt: 0.45 });
}

function drawCornerBracketsMm(page, rectMm, { color, thicknessPt, lengthMm, insetMm, opacity }) {
  const inset = Number(insetMm) || 1.5;
  const len = Number(lengthMm) || 5;
  const x0 = rectMm.x + inset;
  const y0 = rectMm.y + inset;
  const x1 = rectMm.x + rectMm.width - inset;
  const y1 = rectMm.y + rectMm.height - inset;

  const segs = [
    // Top-left
    { x1: x0, y1, x2: x0 + len, y2: y1 },
    { x1: x0, y1, x2: x0, y2: y1 - len },
    // Top-right
    { x1: x1, y1, x2: x1 - len, y2: y1 },
    { x1: x1, y1, x2: x1, y2: y1 - len },
    // Bottom-left
    { x1: x0, y1: y0, x2: x0 + len, y2: y0 },
    { x1: x0, y1: y0, x2: x0, y2: y0 + len },
    // Bottom-right
    { x1: x1, y1: y0, x2: x1 - len, y2: y0 },
    { x1: x1, y1: y0, x2: x1, y2: y0 + len },
  ];

  for (const seg of segs) {
    drawSolidLineMm(page, seg, { color, thicknessPt: thicknessPt ?? 1.0, opacity });
  }
}

function drawEdgeStripesMm(page, rectMm, { color, stripeMm, opacity }) {
  const stripe = Math.max(0.6, Number(stripeMm) || 1.8);
  const o = Number.isFinite(opacity) ? opacity : 0.85;
  drawRectMm(page, { x: rectMm.x, y: rectMm.y, width: rectMm.width, height: stripe }, { color, opacity: o });
  drawRectMm(page, { x: rectMm.x, y: rectMm.y + rectMm.height - stripe, width: rectMm.width, height: stripe }, { color, opacity: o });
}

function drawScanlinesMm(page, rectMm, { color, alpha, spacingMm, thicknessPt }) {
  const spacing = Math.max(0.4, Number(spacingMm) || 0.8);
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0.08));
  for (let y = rectMm.y; y <= rectMm.y + rectMm.height; y += spacing) {
    drawSolidLineMm(page, { x1: rectMm.x, y1: y, x2: rectMm.x + rectMm.width, y2: y }, { color, thicknessPt: thicknessPt ?? 0.4, opacity });
  }
}

function drawRadialBurstMm(page, rectMm, { color, alpha, rays, thicknessPt }) {
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0.18));
  const count = clampInt(rays ?? 20, { min: 8, max: 80 });
  const cx = rectMm.x + rectMm.width * 0.62;
  const cy = rectMm.y + rectMm.height * 0.46;
  const r = Math.max(rectMm.width, rectMm.height) * 1.2;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    drawSolidLineMm(
      page,
      { x1: cx, y1: cy, x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r },
      { color, thicknessPt: thicknessPt ?? 0.6, opacity },
    );
  }
}

function drawCornerHalftoneMm(page, rectMm, { color, alpha, dotMm, pitchMm, extentMm }) {
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0.12));
  const dot = Math.max(0.25, Number(dotMm) || 0.6);
  const pitch = Math.max(dot * 1.2, Number(pitchMm) || 1.6);
  const extent = Math.max(3, Number(extentMm) || 9);

  const corners = [
    { x: rectMm.x, y: rectMm.y },
    { x: rectMm.x + rectMm.width - extent, y: rectMm.y },
    { x: rectMm.x, y: rectMm.y + rectMm.height - extent },
    { x: rectMm.x + rectMm.width - extent, y: rectMm.y + rectMm.height - extent },
  ];

  for (const c of corners) {
    for (let ix = 0; ix <= extent; ix += pitch) {
      for (let iy = 0; iy <= extent; iy += pitch) {
        const dx = ix / extent;
        const dy = iy / extent;
        const falloff = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy));
        if (falloff <= 0) continue;
        page.drawCircle({
          x: mmToPtCoord(c.x + ix + dot),
          y: mmToPtCoord(c.y + iy + dot),
          size: mmToPt(dot * 0.5),
          color,
          opacity: opacity * falloff,
        });
      }
    }
  }
}

function drawAngledSashMm(page, rectMm, { color, alpha, angleDeg, offsetMm } = {}) {
  const angle = degrees(Number(angleDeg) || -12);
  const o = Number.isFinite(alpha) ? alpha : 0.7;
  const offsetX = Number(offsetMm?.x) || 0;
  const offsetY = Number(offsetMm?.y) || 0;

  const sashH = rectMm.height * 0.48;
  const sashW = rectMm.width * 1.3;
  const cx = rectMm.x + rectMm.width / 2 + offsetX;
  const cy = rectMm.y + rectMm.height / 2 + offsetY;

  page.drawRectangle({
    x: mmToPt(cx - sashW / 2),
    y: mmToPt(cy - sashH / 2),
    width: mmToPt(sashW),
    height: mmToPt(sashH),
    color,
    opacity: o,
    rotate: angle,
  });
}

function drawTechLinesMm(page, rectMm, { color, alpha, accent }) {
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0.12));
  const inset = insetRectMm(rectMm, 0.8);

  drawCornerBracketsMm(page, inset, { color, thicknessPt: 0.7, lengthMm: 3.8, insetMm: 1.0, opacity });

  const lines = [
    { x1: inset.x + inset.width * 0.15, y1: inset.y + inset.height * 0.25, x2: inset.x + inset.width * 0.5, y2: inset.y + inset.height * 0.25 },
    { x1: inset.x + inset.width * 0.5, y1: inset.y + inset.height * 0.25, x2: inset.x + inset.width * 0.5, y2: inset.y + inset.height * 0.65 },
    { x1: inset.x + inset.width * 0.65, y1: inset.y + inset.height * 0.65, x2: inset.x + inset.width * 0.9, y2: inset.y + inset.height * 0.65 },
    { x1: inset.x + inset.width * 0.78, y1: inset.y + inset.height * 0.12, x2: inset.x + inset.width * 0.78, y2: inset.y + inset.height * 0.4 },
  ];

  for (const seg of lines) drawSolidLineMm(page, seg, { color, thicknessPt: 0.55, opacity });

  page.drawCircle({
    x: mmToPtCoord(inset.x + inset.width * 0.5),
    y: mmToPtCoord(inset.y + inset.height * 0.25),
    size: mmToPt(0.7),
    color: accent,
    opacity: 0.9,
  });
  page.drawCircle({
    x: mmToPtCoord(inset.x + inset.width * 0.78),
    y: mmToPtCoord(inset.y + inset.height * 0.12),
    size: mmToPt(0.6),
    color: accent,
    opacity: 0.9,
  });
}

function drawRivetsMm(page, rectMm, { fill, stroke, radiusMm }) {
  const r = Math.max(0.5, Number(radiusMm) || 0.9);
  const inset = 1.6;
  const pts = [
    { x: rectMm.x + inset, y: rectMm.y + inset },
    { x: rectMm.x + rectMm.width - inset, y: rectMm.y + inset },
    { x: rectMm.x + inset, y: rectMm.y + rectMm.height - inset },
    { x: rectMm.x + rectMm.width - inset, y: rectMm.y + rectMm.height - inset },
  ];
  for (const p of pts) {
    page.drawCircle({
      x: mmToPtCoord(p.x),
      y: mmToPtCoord(p.y),
      size: mmToPt(r),
      color: fill,
      borderColor: stroke,
      borderWidth: 0.6,
      opacity: 0.9,
      borderOpacity: 0.85,
    });
    page.drawCircle({
      x: mmToPtCoord(p.x + 0.22),
      y: mmToPtCoord(p.y + 0.22),
      size: mmToPt(r * 0.25),
      color: stroke,
      opacity: 0.5,
    });
  }
}

function drawDashedFrameMm(page, rectMm, { color, thicknessPt, dashMm }) {
  const x0 = rectMm.x;
  const y0 = rectMm.y;
  const x1 = rectMm.x + rectMm.width;
  const y1 = rectMm.y + rectMm.height;
  drawDashedLineMm(page, { x1: x0, y1: y0, x2: x1, y2: y0 }, { color, thicknessPt, dashMm });
  drawDashedLineMm(page, { x1: x0, y1: y1, x2: x1, y2: y1 }, { color, thicknessPt, dashMm });
  drawDashedLineMm(page, { x1: x0, y1: y0, x2: x0, y2: y1 }, { color, thicknessPt, dashMm });
  drawDashedLineMm(page, { x1: x1, y1: y0, x2: x1, y2: y1 }, { color, thicknessPt, dashMm });
}

function drawGridMm(page, rectMm, { color, alpha, spacingMm, thicknessPt }) {
  const spacing = Math.max(1.2, Number(spacingMm) || 2.6);
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0.06));
  for (let x = rectMm.x; x <= rectMm.x + rectMm.width; x += spacing) {
    drawSolidLineMm(page, { x1: x, y1: rectMm.y, x2: x, y2: rectMm.y + rectMm.height }, { color, thicknessPt: thicknessPt ?? 0.4, opacity });
  }
  for (let y = rectMm.y; y <= rectMm.y + rectMm.height; y += spacing) {
    drawSolidLineMm(page, { x1: rectMm.x, y1: y, x2: rectMm.x + rectMm.width, y2: y }, { color, thicknessPt: thicknessPt ?? 0.4, opacity });
  }
}

function drawTapeMm(page, rectMm, plateMm, { angleDeg, opacity }) {
  const angle = degrees(Number(angleDeg) || -8);
  const o = Number.isFinite(opacity) ? opacity : 0.28;
  const pad = 1.0;
  const tape = expandRectMm(plateMm, pad);
  page.drawRectangle({
    x: mmToPt(tape.x + rectMm.width * 0.02),
    y: mmToPt(tape.y),
    width: mmToPt(tape.width),
    height: mmToPt(tape.height),
    color: rgb(1, 1, 1),
    opacity: o,
    rotate: angle,
  });
  page.drawRectangle({
    x: mmToPt(tape.x + rectMm.width * 0.02),
    y: mmToPt(tape.y),
    width: mmToPt(tape.width),
    height: mmToPt(tape.height),
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.35,
    borderOpacity: Math.min(1, o + 0.15),
    opacity: Math.min(1, o + 0.15),
    rotate: angle,
  });
}

function drawChevronsMm(page, rectMm, { color, alpha, spacingMm, thicknessPt }) {
  const spacing = Math.max(3, Number(spacingMm) || 5.2);
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0.16));
  const inset = insetRectMm(rectMm, 0.6);
  const midY = inset.y + inset.height / 2;
  const h = inset.height * 0.38;
  for (let x = inset.x - spacing; x <= inset.x + inset.width + spacing; x += spacing) {
    drawSolidLineMm(page, { x1: x, y1: midY, x2: x + spacing / 2, y2: midY + h }, { color, thicknessPt: thicknessPt ?? 0.7, opacity });
    drawSolidLineMm(page, { x1: x + spacing / 2, y1: midY + h, x2: x + spacing, y2: midY }, { color, thicknessPt: thicknessPt ?? 0.7, opacity });
  }
}

function drawGlowCornersMm(page, rectMm, { color, alpha }) {
  const opacity = Math.max(0, Math.min(1, Number(alpha) || 0.2));
  const inset = 1.6;
  const pts = [
    { x: rectMm.x + inset, y: rectMm.y + inset },
    { x: rectMm.x + rectMm.width - inset, y: rectMm.y + inset },
    { x: rectMm.x + inset, y: rectMm.y + rectMm.height - inset },
    { x: rectMm.x + rectMm.width - inset, y: rectMm.y + rectMm.height - inset },
  ];
  for (const p of pts) {
    page.drawCircle({ x: mmToPtCoord(p.x), y: mmToPtCoord(p.y), size: mmToPt(1.8), color, opacity: opacity * 0.35 });
    page.drawCircle({ x: mmToPtCoord(p.x), y: mmToPtCoord(p.y), size: mmToPt(1.0), color, opacity: opacity * 0.6 });
  }
}

function drawCornerLogoMm(page, embeddedLogo, rectMm, { corner, opacity }) {
  const maxH = Math.min(5.8, rectMm.height * 0.34);
  const maxW = Math.min(18, rectMm.width * 0.35);
  const pad = 1.2;
  const box = { x: rectMm.x + pad, y: rectMm.y + rectMm.height - maxH - pad, width: maxW, height: maxH };
  const cornerKey = String(corner || '').toLowerCase();
  if (cornerKey === 'top-right') {
    box.x = rectMm.x + rectMm.width - maxW - pad;
    box.y = rectMm.y + rectMm.height - maxH - pad;
  } else if (cornerKey === 'bottom-right') {
    box.x = rectMm.x + rectMm.width - maxW - pad;
    box.y = rectMm.y + pad;
  } else if (cornerKey === 'bottom-left') {
    box.x = rectMm.x + pad;
    box.y = rectMm.y + pad;
  }
  drawImageContainMm(page, embeddedLogo, box, { opacity: Number.isFinite(opacity) ? opacity : 0.8 });
}

function drawSolidLineMm(page, segMm, { color, thicknessPt, opacity } = {}) {
  page.drawLine({
    start: { x: mmToPtCoord(segMm.x1), y: mmToPtCoord(segMm.y1) },
    end: { x: mmToPtCoord(segMm.x2), y: mmToPtCoord(segMm.y2) },
    thickness: thicknessPt ?? 0.8,
    color: color || rgb(0, 0, 0),
    opacity,
  });
}

function drawDashedLineMm(page, segMm, { color, thicknessPt, dashMm } = {}) {
  const dash = Array.isArray(dashMm) && dashMm.length === 2 ? dashMm : [2, 1.5];
  page.pushOperators(
    pushGraphicsState(),
    setStrokingColor(color || rgb(0, 0, 0)),
    setLineWidth(thicknessPt ?? 0.6),
    setDashPattern(dash.map(mmToPt), 0),
    moveTo(mmToPtCoord(segMm.x1), mmToPtCoord(segMm.y1)),
    lineTo(mmToPtCoord(segMm.x2), mmToPtCoord(segMm.y2)),
    stroke(),
    popGraphicsState(),
  );
}

function drawCenteredTextMm(page, font, text, rectMm, { sizePt, color, yOffsetMm = 0 } = {}) {
  const size = Number(sizePt) || mmToPt(4);
  const label = String(text || '');
  const widthPt = font.widthOfTextAtSize(label, size);
  const x = mmToPt(rectMm.x + rectMm.width / 2) - widthPt / 2;
  const y = mmToPt(rectMm.y + rectMm.height / 2 + (Number(yOffsetMm) || 0)) - size / 2;
  page.drawText(label, { x, y, size, font, color: color || rgb(0, 0, 0) });
}

function drawCenteredTextShadowMm(page, font, text, rectMm, { sizePt, color, shadowColor, shadowOffsetMm } = {}) {
  const offsetX = Number(shadowOffsetMm?.x) || 0;
  const offsetY = Number(shadowOffsetMm?.y) || 0;
  drawCenteredTextMm(page, font, text, rectMm, {
    sizePt,
    color: shadowColor || rgb(0, 0, 0),
    yOffsetMm: offsetY,
  });
  if (!offsetX) return;
  const shifted = { ...rectMm, x: rectMm.x + offsetX, y: rectMm.y };
  drawCenteredTextMm(page, font, text, shifted, {
    sizePt,
    color: shadowColor || rgb(0, 0, 0),
    yOffsetMm: offsetY,
  });
}

function drawCenteredTextOutlineMm(page, font, text, rectMm, { sizePt, color, outlineColor, outlineOffsetMm, yOffsetMm = 0 } = {}) {
  const offset = Number(outlineOffsetMm) || 0;
  const outline = outlineColor || rgb(0, 0, 0);
  const offsets = [
    { x: -offset, y: 0 },
    { x: offset, y: 0 },
    { x: 0, y: -offset },
    { x: 0, y: offset },
    { x: -offset, y: -offset },
    { x: -offset, y: offset },
    { x: offset, y: -offset },
    { x: offset, y: offset },
  ];

  for (const o of offsets) {
    drawCenteredTextMm(page, font, text, { ...rectMm, x: rectMm.x + o.x, y: rectMm.y + o.y }, { sizePt, color: outline, yOffsetMm });
  }
  drawCenteredTextMm(page, font, text, rectMm, { sizePt, color: color || rgb(1, 1, 1), yOffsetMm });
}

function drawWrappedTextMm(page, font, text, rectMm, { sizePt, color, align = 'left', maxLines = null, valign = 'center' } = {}) {
  const size = Number(sizePt) || mmToPt(3);
  const maxWidthPt = mmToPt(rectMm.width);
  const lines = wrapText(font, String(text || ''), size, maxWidthPt);
  const finalLines = typeof maxLines === 'number' ? lines.slice(0, maxLines) : lines;

  const lineHeight = size * 1.18;
  const blockHeight = finalLines.length * lineHeight;
  let cursorY;
  if (valign === 'top') {
    cursorY = mmToPt(rectMm.y + rectMm.height) - lineHeight;
  } else if (valign === 'bottom') {
    cursorY = mmToPt(rectMm.y) + blockHeight - lineHeight;
  } else {
    cursorY = mmToPt(rectMm.y + rectMm.height / 2) + blockHeight / 2 - lineHeight;
  }

  for (const line of finalLines) {
    const w = font.widthOfTextAtSize(line, size);
    let x;
    if (align === 'center') {
      x = mmToPt(rectMm.x + rectMm.width / 2) - w / 2;
    } else if (align === 'right') {
      x = mmToPt(rectMm.x + rectMm.width) - w;
    } else {
      x = mmToPt(rectMm.x);
    }
    page.drawText(line, { x, y: cursorY, size, font, color: color || rgb(0, 0, 0) });
    cursorY -= lineHeight;
  }
}

function drawWrappedTextShadowMm(page, font, text, rectMm, { sizePt, color, shadowColor, shadowOffsetMm, align = 'left', maxLines = null, valign = 'center' } = {}) {
  const offsetX = Number(shadowOffsetMm?.x) || 0;
  const offsetY = Number(shadowOffsetMm?.y) || 0;
  const shadow = { ...rectMm, x: rectMm.x + offsetX, y: rectMm.y + offsetY };
  drawWrappedTextMm(page, font, text, shadow, {
    sizePt,
    color: shadowColor || rgb(0, 0, 0),
    align,
    maxLines,
    valign,
  });
  drawWrappedTextMm(page, font, text, rectMm, {
    sizePt,
    color: color || rgb(1, 1, 1),
    align,
    maxLines,
    valign,
  });
}

function drawWrappedTextOutlineMm(page, font, text, rectMm, { sizePt, color, outlineColor, outlineOffsetMm, align = 'left', maxLines = null, valign = 'center' } = {}) {
  const offset = Number(outlineOffsetMm) || 0;
  const outline = outlineColor || rgb(0, 0, 0);
  const offsets = [
    { x: -offset, y: 0 },
    { x: offset, y: 0 },
    { x: 0, y: -offset },
    { x: 0, y: offset },
    { x: -offset, y: -offset },
    { x: -offset, y: offset },
    { x: offset, y: -offset },
    { x: offset, y: offset },
  ];
  for (const o of offsets) {
    drawWrappedTextMm(page, font, text, { ...rectMm, x: rectMm.x + o.x, y: rectMm.y + o.y }, { sizePt, color: outline, align, maxLines, valign });
  }
  drawWrappedTextMm(page, font, text, rectMm, { sizePt, color: color || rgb(1, 1, 1), align, maxLines, valign });
}

function drawTextMm(page, font, text, atMm, { sizeMm, color } = {}) {
  page.drawText(String(text || ''), {
    x: mmToPt(atMm.x),
    y: mmToPt(atMm.y),
    size: mmToPt(Number(sizeMm) || 3),
    font,
    color: color || rgb(0, 0, 0),
  });
}

function wrapText(font, rawText, fontSizePt, maxWidthPt) {
  const source = String(rawText || '').replace(/\r\n/g, '\n');
  const paragraphs = source.split('\n');
  const lines = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      continue;
    }

    const words = trimmed.split(/\s+/g);
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const candidateWidth = font.widthOfTextAtSize(candidate, fontSizePt);
      if (candidateWidth <= maxWidthPt) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = word;
        continue;
      }

      // Single long word: hard break.
      lines.push(...breakLongWord(font, word, fontSizePt, maxWidthPt));
      current = '';
    }

    if (current) lines.push(current);
  }

  return lines;
}

function breakLongWord(font, word, fontSizePt, maxWidthPt) {
  const out = [];
  let current = '';
  for (const ch of word) {
    const candidate = current + ch;
    if (font.widthOfTextAtSize(candidate, fontSizePt) <= maxWidthPt) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    current = ch;
  }
  if (current) out.push(current);
  return out.length ? out : [word];
}

function fitTextSizeMm(font, text, maxWidthMm, maxMm, minMm) {
  const label = String(text || '').trim();
  if (!label) return minMm;
  const maxPt = mmToPt(maxMm);
  const minPt = mmToPt(minMm);
  const targetWidthPt = mmToPt(maxWidthMm);

  let size = maxPt;
  while (size >= minPt) {
    const width = font.widthOfTextAtSize(label, size);
    if (width <= targetWidthPt) break;
    size -= mmToPt(0.2);
  }

  return ptToMm(Math.max(size, minPt));
}

function parseHexColor(value, fallback) {
  const raw = String(value || '').trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!match) return fallback;
  const hex = match[1];
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function normalizeMiscText(text) {
  const raw = String(text || '');
  const normalized = raw.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  return { raw: normalized, lines };
}

function resolveOptionalPath(value, fallback) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return fallback;
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Image path does not exist: ${resolved}`);
  }
  return resolved;
}

function defaultCyclopsArtPath() {
  return path.join(__dirname, '..', 'assets', 'cyclops', 'image.png');
}

function defaultLogoPath() {
  return path.join(__dirname, '..', 'assets', 'logo.png');
}

function defaultCardBackPath() {
  return path.join(__dirname, '..', 'assets', 'cardback.png');
}

function ptToMm(pt) {
  return pt / (72 / 25.4);
}

function mmToPtCoord(mm) {
  return Number(mm) * MM_TO_PT;
}

function format1(n) {
  return Number(n).toFixed(1).replace(/\.0$/, '');
}

module.exports = {
  buildTuckBoxPdf,
  buildTuckBoxTopSampleSheetPdf,
};
