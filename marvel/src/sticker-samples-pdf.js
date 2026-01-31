const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve, closePath, clip, endPath } = require('pdf-lib');
const { MM_TO_PT, mmToPt } = require('../../shared/pdf-layout');
const { applyRoundedRectClip, restoreGraphicsState } = require('../../shared/pdf-drawing');
const { embedImage } = require('./image-utils');

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

async function buildStickerSampleSheetPdf(options) {
  const sheet = resolveStickerSheetLayout(options);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.addPage([mmToPt(sheet.pageWidthMm), mmToPt(sheet.pageHeightMm)]);
  page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: rgb(1, 1, 1) });

  const header = `Sticker samples (${format1(sheet.stickerWidthMm)}×${format1(sheet.stickerHeightMm)}mm)`;
  drawTextMm(page, font, header, { x: sheet.marginMm, y: sheet.pageHeightMm - sheet.marginMm - 4.5 }, { sizeMm: 3.6, color: rgb(0.1, 0.1, 0.1) });
  const sub = `Grid: ${sheet.rows}×${sheet.columns} • Slots: ${sheet.count} • Scale: ${(sheet.scale * 100).toFixed(1)}%`;
  drawTextMm(page, font, sub, { x: sheet.marginMm, y: sheet.pageHeightMm - sheet.marginMm - 8.5 }, { sizeMm: 2.6, color: rgb(0.3, 0.3, 0.3) });

  const imageCache = new Map();
  const sample1 = resolveSample1Assets(options);
  const embeddedLogo = sample1.logoPath ? await embedImage(pdfDoc, sample1.logoPath, imageCache) : null;
  const embeddedArt = sample1.artPath ? await embedImage(pdfDoc, sample1.artPath, imageCache) : null;

  for (let index = 0; index < sheet.count; index++) {
    const cell = stickerCellRectMm(sheet, index);
    if (!cell) break;

    const rectMm = {
      x: cell.x,
      y: cell.y,
      width: sheet.stickerWidthMm * sheet.scale,
      height: sheet.stickerHeightMm * sheet.scale,
    };

    if (index === 0) {
      drawStickerSample1(page, rectMm, { embeddedLogo, embeddedArt }, { ...sample1, scale: sheet.scale, cornerRadiusMm: sheet.cornerRadiusMm });
    }

    drawStickerCutOutlineMm(page, rectMm, {
      borderWidthPt: 0.7,
      borderColor: rgb(0, 0, 0),
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
      stickerWidthMm: sheet.stickerWidthMm,
      stickerHeightMm: sheet.stickerHeightMm,
      scale: sheet.scale,
    },
  };
}

function resolveSample1Assets(options) {
  const resolved = {
    logoPath: resolveOptionalPath(options.sample1LogoPath ?? options.sample1Logo),
    artPath: resolveOptionalPath(options.sample1ArtPath ?? options.sample1Art),
    logoOffsetXMm: Number(options.sample1LogoOffsetXMm) || 0,
    logoOffsetYMm: Number(options.sample1LogoOffsetYMm) || 0,
    artOffsetXMm: Number(options.sample1ArtOffsetXMm) || 0,
    artOffsetYMm: Number(options.sample1ArtOffsetYMm) || 0,
    logoMaxWidthMm: Number(options.sample1LogoMaxWidthMm) || 28,
    logoMaxHeightMm: Number(options.sample1LogoMaxHeightMm) || 18,
    gradient: parseHexColor(options.sample1Gradient ?? options.sample1Yellow, rgb(0.97, 0.82, 0.09)),
    gradientWidthMm: Number(options.sample1GradientWidthMm) || 34,
  };

  if (resolved.logoPath && !fs.existsSync(resolved.logoPath)) {
    throw new Error(`Logo path does not exist: ${resolved.logoPath}`);
  }
  if (resolved.artPath && !fs.existsSync(resolved.artPath)) {
    throw new Error(`Art path does not exist: ${resolved.artPath}`);
  }

  return resolved;
}

function drawStickerSample1(page, rectMm, { embeddedLogo, embeddedArt }, sample1) {
  const scale = Number(sample1.scale) || 1;
  const paddingMm = 1.2 * scale;
  const safeRectMm = insetRectMm(rectMm, paddingMm);

  const cornerRadiusMm = (Number(sample1.cornerRadiusMm) || 2) * scale;
  withClipRoundedRectMm(page, rectMm, cornerRadiusMm, () => {
    drawRectMm(page, rectMm, { color: sample1.gradient, opacity: 1 });

    if (embeddedArt) {
      drawImageCoverMm(page, embeddedArt, rectMm, {
        clipRadiusMm: 0,
        opacity: 1,
        offsetsMm: { x: sample1.artOffsetXMm * scale, y: sample1.artOffsetYMm * scale },
      });
    }

    drawYellowGradientLeftMm(page, rectMm, {
      color: sample1.gradient,
      widthMm: Math.max(0, sample1.gradientWidthMm * scale),
      solidWidthMm: 20 * scale,
      steps: 42,
    });
  });

  if (embeddedLogo) {
    const logoAreaWidthMm = Math.min(safeRectMm.width * 0.45, (sample1.logoMaxWidthMm + 6) * scale);
    const logoArea = {
      x: safeRectMm.x,
      y: safeRectMm.y,
      width: logoAreaWidthMm,
      height: safeRectMm.height,
    };

    const target = {
      x: logoArea.x + sample1.logoOffsetXMm * scale,
      y: logoArea.y + sample1.logoOffsetYMm * scale,
      width: Math.min(sample1.logoMaxWidthMm * scale, logoArea.width),
      height: Math.min(sample1.logoMaxHeightMm * scale, logoArea.height),
    };

    drawImageContainMm(page, embeddedLogo, target, { opacity: 0.98 });
  }
}

function drawYellowGradientLeftMm(page, rectMm, { color, widthMm, steps, solidWidthMm = 20 }) {
  const maxWidth = Math.max(0, Math.min(Number(widthMm) || 0, rectMm.width));
  if (maxWidth <= 0) return;
  const solid = Math.max(0, Math.min(Number(solidWidthMm) || 0, maxWidth));
  if (solid > 0) {
    drawRectMm(page, { x: rectMm.x, y: rectMm.y, width: solid + 0.001, height: rectMm.height }, { color, opacity: 1 });
  }
  const fadeWidth = maxWidth - solid;
  if (fadeWidth <= 0) return;
  const n = clampInt(steps ?? 40, { min: 2, max: 200 });
  const stripe = fadeWidth / n;

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const opacity = 1 - t;
    const x = rectMm.x + solid + i * stripe;
    drawRectMm(page, { x, y: rectMm.y, width: stripe + 0.001, height: rectMm.height }, { color, opacity });
  }
}

function drawStickerCutOutlineMm(page, rectMm, { borderColor, borderWidthPt }) {
  drawRectMm(page, rectMm, { borderColor, borderWidthPt });
}

function withClipRoundedRectMm(page, rectMm, radiusMm, fn) {
  applyRoundedRectClip(page, PDF_OPS, {
    x: mmToPtCoord(rectMm.x),
    y: mmToPtCoord(rectMm.y),
    width: mmToPt(rectMm.width),
    height: mmToPt(rectMm.height),
    radius: mmToPt(Math.max(0, Number(radiusMm) || 0)),
  });
  try {
    fn();
  } finally {
    restoreGraphicsState(page, PDF_OPS);
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

  const clipRadiusPt = mmToPt(Math.max(0, Number(clipRadiusMm) || 0));
  applyRoundedRectClip(page, PDF_OPS, {
    x: mmToPtCoord(rectMm.x),
    y: mmToPtCoord(rectMm.y),
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
    x: mmToPtCoord(rectMm.x),
    y: mmToPtCoord(rectMm.y),
    width: mmToPt(rectMm.width),
    height: mmToPt(rectMm.height),
  };
  if (color) props.color = color;
  if (Number.isFinite(opacity)) props.opacity = opacity;
  if (borderColor) props.borderColor = borderColor;
  if (Number.isFinite(borderWidthPt)) props.borderWidth = borderWidthPt;
  page.drawRectangle(props);
}

function drawTextMm(page, font, text, atMm, { sizeMm, color } = {}) {
  const sizePt = mmToPt(Math.max(0, Number(sizeMm) || 3));
  page.drawText(String(text ?? ''), {
    x: mmToPtCoord(atMm.x),
    y: mmToPtCoord(atMm.y),
    size: sizePt,
    font,
    color: color || rgb(0, 0, 0),
  });
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

function resolveStickerSheetLayout(options) {
  const pageSize = String(options.pageSize || 'a4').trim().toLowerCase();
  const base = pageSize === 'letter' ? { widthMm: 215.9, heightMm: 279.4 } : { widthMm: 210, heightMm: 297 };

  const columns = clampInt(options.columns ?? 2, { min: 1, max: 10 });
  const rows = clampInt(options.rows ?? 5, { min: 1, max: 20 });
  const count = clampInt(options.count ?? 10, { min: 1, max: columns * rows });

  const marginMm = Number(options.sheetMarginMm ?? 8);
  const gutterMm = Number(options.gutterMm ?? 3);
  const headerHeightMm = Number(options.sheetHeaderHeightMm ?? 12);

  const stickerWidthMm = Number(options.stickerWidthMm ?? 70);
  const stickerHeightMm = Number(options.stickerHeightMm ?? 25);
  const cornerRadiusMm = Number(options.cornerRadiusMm ?? 2);

  const requested = String(options.orientation || 'auto').trim().toLowerCase();

  function layoutFor(orientation) {
    const pageWidthMm = orientation === 'landscape' ? base.heightMm : base.widthMm;
    const pageHeightMm = orientation === 'landscape' ? base.widthMm : base.heightMm;

    const usableW = Math.max(1, pageWidthMm - marginMm * 2);
    const usableH = Math.max(1, pageHeightMm - marginMm * 2 - headerHeightMm);

    const gridW = stickerWidthMm * columns + gutterMm * (columns - 1);
    const gridH = stickerHeightMm * rows + gutterMm * (rows - 1);
    const scale = Math.min(1, usableW / gridW, usableH / gridH);

    const originX = marginMm + (usableW - gridW * scale) / 2;
    const originY = marginMm + (usableH - gridH * scale) / 2;

    return { orientation, pageWidthMm, pageHeightMm, originX, originY, scale };
  }

  const portrait = layoutFor('portrait');
  const landscape = layoutFor('landscape');
  const chosen =
    requested === 'portrait'
      ? portrait
      : requested === 'landscape'
        ? landscape
        : landscape.scale >= portrait.scale
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
    stickerWidthMm,
    stickerHeightMm,
    cornerRadiusMm,
  };
}

function stickerCellRectMm(sheet, index) {
  const col = index % sheet.columns;
  const row = Math.floor(index / sheet.columns);
  if (row >= sheet.rows) return null;

  const stepX = (sheet.stickerWidthMm + sheet.gutterMm) * sheet.scale;
  const stepY = (sheet.stickerHeightMm + sheet.gutterMm) * sheet.scale;

  const x = sheet.originX + col * stepX;
  const yTop = sheet.originY + (sheet.rows - 1) * stepY;
  const y = yTop - row * stepY;
  return { x, y };
}

function resolveOptionalPath(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return path.resolve(raw);
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

function clampInt(value, { min = 1, max = 999 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
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
  buildStickerSampleSheetPdf,
};
