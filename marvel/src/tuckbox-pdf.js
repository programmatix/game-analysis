const fs = require('fs');
const path = require('path');
const {
  PDFDocument,
  rgb,
  degrees,
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

  if (pageBack) {
    drawGuides(pageBack, layout, palette);
    drawLineLabels(pageBack, fonts, layout, palette);
    drawZoneLabels(pageBack, fonts, layout, palette);
    drawLegend(pageBack, fonts, layout, palette, { duplex: true });
  } else {
    drawGlueLabel(pageFront, fonts, layout.body.glue, palette);
    drawGuides(pageFront, layout, palette);
    drawLineLabels(pageFront, fonts, layout, palette);
    drawZoneLabels(pageFront, fonts, layout, palette);
    drawLegend(pageFront, fonts, layout, palette, { duplex: false });
  }

  const pdfBytes = await pdfDoc.save();
  return { pdfBytes, layout, fontWarnings };
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
  const maxWidthMm = Math.min(26, frontMm.width * 0.38);
  const maxHeightMm = 12;
  const x = frontMm.x + 3;
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
  const inset = insetRectMm(topFaceMm, 2);

  const title = heroName || 'Hero';
  const titleSizeMm = fitTextSizeMm(fonts.title, title, inset.width, 8, 3.5);
  const titleHeightMm = titleSizeMm * 1.12;
  const titleBox = { x: inset.x, y: inset.y + inset.height - titleHeightMm, width: inset.width, height: titleHeightMm };
  drawCenteredTextShadowMm(page, fonts.title, title, titleBox, {
    sizePt: mmToPt(titleSizeMm),
    color: palette.white,
    shadowColor: rgb(0, 0, 0),
    shadowOffsetMm: { x: 0.3, y: -0.3 },
  });

  drawCenteredTextMm(page, fonts.title, title, titleBox, {
    sizePt: mmToPt(titleSizeMm),
    color: palette.white,
    yOffsetMm: -0.2,
  });

  if (!miscText.lines.length) return;
  const miscSizeMm = Math.min(3.6, titleSizeMm * 0.55);
  const miscBox = { x: inset.x, y: inset.y, width: inset.width, height: inset.height - titleHeightMm + 0.5 };
  drawWrappedTextMm(page, fonts.body, miscText.lines.join('\n'), miscBox, {
    sizePt: mmToPt(miscSizeMm),
    color: rgb(0.92, 0.92, 0.92),
    align: 'center',
    maxLines: 2,
    valign: 'top',
  });
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

function drawLineLabels(page, fonts, layout, palette) {
  const segments = labelSegments(layout);
  for (const item of segments) {
    drawLineLabel(page, fonts, item, palette);
  }
}

function labelSegments(layout) {
  const all = [];
  for (const seg of layout.segments.cut) all.push({ type: 'cut', seg });
  for (const seg of layout.segments.fold) all.push({ type: 'fold', seg });

  all.sort((a, b) => {
    const aIsH = a.seg.y1 === a.seg.y2;
    const bIsH = b.seg.y1 === b.seg.y2;
    if (aIsH !== bIsH) return aIsH ? -1 : 1;
    const aFixed = aIsH ? a.seg.y1 : a.seg.x1;
    const bFixed = bIsH ? b.seg.y1 : b.seg.x1;
    if (aFixed !== bFixed) return aFixed - bFixed;
    const aA = aIsH ? a.seg.x1 : a.seg.y1;
    const bA = bIsH ? b.seg.x1 : b.seg.y1;
    if (aA !== bA) return aA - bA;
    const aB = aIsH ? a.seg.x2 : a.seg.y2;
    const bB = bIsH ? b.seg.x2 : b.seg.y2;
    if (aB !== bB) return aB - bB;
    if (a.type !== b.type) return a.type === 'cut' ? -1 : 1;
    return 0;
  });

  return all.map((item, index) => ({ ...item, label: `L${index + 1}` }));
}

function drawLineLabel(page, fonts, { label, type, seg }, palette) {
  const isH = seg.y1 === seg.y2;
  const midX = (seg.x1 + seg.x2) / 2;
  const midY = (seg.y1 + seg.y2) / 2;
  const color = type === 'cut' ? palette.cut : palette.fold;
  const sub = type === 'cut' ? 'CUT' : 'FOLD';

  const sizeMm = 2.8;
  const subSizeMm = 2.2;
  const padMm = 0.8;

  const sizePt = mmToPt(sizeMm);
  const subSizePt = mmToPt(subSizeMm);
  const textWPt = fonts.mouseprint.widthOfTextAtSize(label, sizePt);
  const subWPt = fonts.mouseprint.widthOfTextAtSize(sub, subSizePt);
  const boxWPt = Math.max(textWPt, subWPt) + mmToPt(padMm * 2);
  const boxHPt = sizePt + subSizePt + mmToPt(padMm * 2) + mmToPt(0.5);

  const offsetMm = 1.2;
  const anchorMm = isH ? { x: midX, y: midY + offsetMm } : { x: midX + offsetMm, y: midY };
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
  page.drawText(label, { x: textXPt, y: topYPt, size: sizePt, font: fonts.mouseprint, color });

  const subXPt = mmToPt(boxMm.x + boxMm.width / 2) - subWPt / 2;
  const subYPt = topYPt - subSizePt - mmToPt(0.4);
  page.drawText(sub, { x: subXPt, y: subYPt, size: subSizePt, font: fonts.mouseprint, color });
}

function drawZoneLabels(page, fonts, layout, palette) {
  const zones = buildZoneLabels(layout);
  for (const zone of zones) {
    drawZoneLabel(page, fonts, zone, palette);
  }
}

function buildZoneLabels(layout) {
  const rects = [];
  for (const r of layout.rects) {
    if (r.id === 'top-front-tuck') continue;
    rects.push(r);
  }

  rects.push(layout.topFace);

  const topFrontTuck = layout.flaps?.topFrontTuck;
  if (topFrontTuck && topFrontTuck.height > layout.topFace.height) {
    rects.push({
      id: 'top-tuck-tab',
      x: layout.topFace.x,
      y: layout.topFace.y + layout.topFace.height,
      width: layout.topFace.width,
      height: topFrontTuck.height - layout.topFace.height,
    });
  }

  return rects.map((rectMm, index) => ({
    rectMm,
    label: `Z${alphaIndex(index)}`,
    isGlue: rectMm.id === 'glue',
  }));
}

function alphaIndex(index) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < letters.length) return letters[index];
  const first = Math.floor(index / letters.length) - 1;
  const second = index % letters.length;
  return `${letters[first]}${letters[second]}`;
}

function drawZoneLabel(page, fonts, { rectMm, label, isGlue }, palette) {
  const safe = insetRectMm(rectMm, 1.4);
  if (safe.width <= 0 || safe.height <= 0) return;

  if (isGlue) {
    const hatchStepMm = 4;
    for (let x = rectMm.x - rectMm.height; x <= rectMm.x + rectMm.width; x += hatchStepMm) {
      drawSolidLineMm(
        page,
        { x1: x, y1: rectMm.y, x2: x + rectMm.height, y2: rectMm.y + rectMm.height },
        { color: rgb(0.7, 0.7, 0.7), thicknessPt: 0.4, opacity: 0.5 }
      );
    }
  }

  const zoneSizeMm = fitTextSizeMm(fonts.mouseprint, label, safe.width, Math.min(10, safe.height), 2.8);
  const zoneBox = { x: safe.x, y: safe.y + safe.height / 2 - zoneSizeMm * 0.8, width: safe.width, height: zoneSizeMm * 1.6 };
  drawCenteredTextMm(page, fonts.mouseprint, label, zoneBox, {
    sizePt: mmToPt(zoneSizeMm),
    color: isGlue ? rgb(0.2, 0.2, 0.2) : rgb(0.1, 0.1, 0.1),
  });

  if (!isGlue) return;
  const subSizeMm = Math.min(3.2, zoneSizeMm * 0.7);
  const subBox = { x: safe.x, y: safe.y + 1, width: safe.width, height: subSizeMm * 1.4 };
  drawCenteredTextMm(page, fonts.mouseprint, 'GLUE', subBox, {
    sizePt: mmToPt(subSizeMm),
    color: rgb(0.25, 0.25, 0.25),
  });
}

function drawLegend(page, fonts, layout, palette, { duplex } = {}) {
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
  drawTextMm(page, fonts.mouseprint, title, { x: legend.x + 3, y: legend.y + legend.height - 7 }, { sizeMm: 3.2, color: palette.cut });

  const dims = layout.dimensionsMm;
  const line1 = `Sleeve: ${format1(dims.sleeveHeightMm)}×${format1(dims.sleeveWidthMm)}mm • Thickness: ${format1(
    dims.thicknessMm
  )}mm`;
  drawTextMm(page, fonts.mouseprint, line1, { x: legend.x + 3, y: legend.y + legend.height - 12 }, { sizeMm: 2.7, color: palette.cut });

  const cutY = legend.y + 6.5;
  drawSolidLineMm(page, { x1: legend.x + 3, y1: cutY, x2: legend.x + 18, y2: cutY }, { color: palette.cut, thicknessPt: 0.8 });
  drawTextMm(page, fonts.mouseprint, 'Cut', { x: legend.x + 20, y: cutY - 1 }, { sizeMm: 2.8, color: palette.cut });

  const foldY = legend.y + 3;
  drawDashedLineMm(page, { x1: legend.x + 3, y1: foldY, x2: legend.x + 18, y2: foldY }, { color: palette.fold, thicknessPt: 0.6, dashMm: [2, 1.5] });
  drawTextMm(page, fonts.mouseprint, 'Fold', { x: legend.x + 20, y: foldY - 1 }, { sizeMm: 2.8, color: palette.cut });

  if (duplex) {
    drawTextMm(page, fonts.mouseprint, 'Back side: cut/fold + ZA/L# labels', { x: legend.x + 3, y: legend.y + 1.2 }, { sizeMm: 2.6, color: palette.cut });
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
    x: mmToPt(x),
    y: mmToPt(y),
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
    x: mmToPt(x),
    y: mmToPt(y),
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
};
