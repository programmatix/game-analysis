const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve, closePath, clip, endPath } = require('pdf-lib');
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

async function buildStickerSheetPdf(config, { debug } = {}) {
  const sheet = config?.sheet;
  if (!sheet) throw new Error('Missing config.sheet');

  const pageWidthMm = Number(sheet.pageWidthMm);
  const pageHeightMm = Number(sheet.pageHeightMm);
  if (!Number.isFinite(pageWidthMm) || !Number.isFinite(pageHeightMm)) {
    throw new Error('config.sheet.pageWidthMm/pageHeightMm must be numbers (did you normalize config first?)');
  }

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([mmToPt(pageWidthMm), mmToPt(pageHeightMm)]);
  page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: rgb(1, 1, 1) });

  const layout = computeStickerGridLayoutMm(config);

  const imageCache = new Map();
  for (let index = 0; index < layout.slots; index++) {
    const sticker = config.stickers[index];
    if (!sticker || typeof sticker !== 'object') continue;
    if (!sticker.logo && !sticker.art) continue;

    const rectMm = stickerRectAtIndexMm(layout, index);
    await drawSticker(page, pdfDoc, imageCache, rectMm, sticker, {
      cornerRadiusMm: Number(sheet.cornerRadiusMm) || 0,
    });
  }

  if (debug) {
    for (let index = 0; index < layout.slots; index++) {
      const rectMm = stickerRectAtIndexMm(layout, index);
      drawDebugGuidesForStickerMm(page, rectMm, config);
    }
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return {
    pdfBytes,
    sheet: {
      pageWidthMm,
      pageHeightMm,
      orientation: sheet.orientation,
      columns: layout.columns,
      rows: layout.rows,
      stickers: Array.isArray(config.stickers) ? config.stickers.length : 0,
    },
  };
}

function computeStickerGridLayoutMm(config) {
  const sheet = config.sheet;
  const columns = Number(sheet.columns) || 1;
  const rows = Number(sheet.rows) || 1;
  const slots = columns * rows;

  const marginMm = Number(sheet.marginMm) || 0;
  const gutterMm = Number(sheet.gutterMm) || 0;

  const stickerWidthMm = Number(sheet.stickerWidthMm) || 70;
  const stickerHeightMm = Number(sheet.stickerHeightMm) || 25;

  const usableW = sheet.pageWidthMm - marginMm * 2;
  const usableH = sheet.pageHeightMm - marginMm * 2;
  const gridW = stickerWidthMm * columns + gutterMm * (columns - 1);
  const gridH = stickerHeightMm * rows + gutterMm * (rows - 1);

  const originX = marginMm + (usableW - gridW) / 2;
  const originY = marginMm + (usableH - gridH) / 2;

  return {
    columns,
    rows,
    slots,
    originX,
    originY,
    stickerWidthMm,
    stickerHeightMm,
    gutterMm,
  };
}

function stickerRectAtIndexMm(layout, index) {
  const col = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  const x = layout.originX + col * (layout.stickerWidthMm + layout.gutterMm);
  const yTop = layout.originY + (layout.rows - 1) * (layout.stickerHeightMm + layout.gutterMm);
  const y = yTop - row * (layout.stickerHeightMm + layout.gutterMm);
  return {
    x,
    y,
    width: layout.stickerWidthMm,
    height: layout.stickerHeightMm,
  };
}

async function drawSticker(page, pdfDoc, imageCache, rectMm, sticker, { cornerRadiusMm }) {
  const design = String(sticker.design || 'sample1').trim().toLowerCase();
  if (design !== 'sample1') return;

  const gradient = parseHexColor(sticker.gradient ?? sticker.yellow, rgb(0.97, 0.82, 0.09));

  const embeddedLogo = sticker.logo ? await embedImage(pdfDoc, sticker.logo, imageCache) : null;
  const embeddedArt = sticker.art ? await embedImage(pdfDoc, sticker.art, imageCache) : null;

  drawStickerSample1(page, rectMm, { embeddedLogo, embeddedArt }, {
    cornerRadiusMm: Number(cornerRadiusMm) || 0,
    logoOffsetXMm: Number(sticker.logoOffsetXMm) || 0,
    logoOffsetYMm: Number(sticker.logoOffsetYMm) || 0,
    artOffsetXMm: Number(sticker.artOffsetXMm) || 0,
    artOffsetYMm: Number(sticker.artOffsetYMm) || 0,
    artScale: Number(sticker.artScale) || 1,
    logoMaxWidthMm: Number(sticker.logoMaxWidthMm) || 28,
    logoMaxHeightMm: Number(sticker.logoMaxHeightMm) || 18,
    gradient,
    gradientWidthMm: Number(sticker.gradientWidthMm) || 34,
  });
}

function drawStickerSample1(page, rectMm, { embeddedLogo, embeddedArt }, cfg) {
  const paddingMm = 1.2;
  const safeRectMm = insetRectMm(rectMm, paddingMm);
  const cornerRadiusMm = Math.max(0, Number(cfg.cornerRadiusMm) || 0);

  withClipRoundedRectMm(page, rectMm, cornerRadiusMm, () => {
    drawRectMm(page, rectMm, { color: cfg.gradient, opacity: 1 });

    if (embeddedArt) {
      drawImageCoverMm(page, embeddedArt, rectMm, {
        opacity: 1,
        offsetsMm: { x: cfg.artOffsetXMm, y: cfg.artOffsetYMm },
        scale: Number(cfg.artScale) || 1,
      });
    }

    drawGradientLeftMm(page, rectMm, {
      color: cfg.gradient,
      widthMm: Math.max(0, Number(cfg.gradientWidthMm) || 0),
      steps: 42,
    });
  });

  if (embeddedLogo) {
    const logoAreaWidthMm = Math.min(safeRectMm.width * 0.45, Number(cfg.logoMaxWidthMm) + 6);
    const logoArea = {
      x: safeRectMm.x,
      y: safeRectMm.y,
      width: logoAreaWidthMm,
      height: safeRectMm.height,
    };

    const target = {
      x: logoArea.x + (Number(cfg.logoOffsetXMm) || 0),
      y: logoArea.y + (Number(cfg.logoOffsetYMm) || 0),
      width: Math.min(Number(cfg.logoMaxWidthMm) || 28, logoArea.width),
      height: Math.min(Number(cfg.logoMaxHeightMm) || 18, logoArea.height),
    };

    drawImageContainMm(page, embeddedLogo, target, { opacity: 0.98 });
  }
}

function drawGradientLeftMm(page, rectMm, { color, widthMm, steps, solidWidthMm = 20 }) {
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

function drawDebugGuidesForStickerMm(page, rectMm, config) {
  const sheet = config.sheet;
  const debug = config.debug || {};
  const leftMm = Number(debug.leftMm);
  const rightFromRightMm = Number(debug.rightFromRightMm);
  const centerHorizontal = debug.centerHorizontal !== false;

  const x1 = rectMm.x + (Number.isFinite(leftMm) ? leftMm : 10);
  const x2 = rectMm.x + rectMm.width - (Number.isFinite(rightFromRightMm) ? rightFromRightMm : 40);

  const red = rgb(1, 0, 0);
  const thicknessPt = 0.9;
  page.drawLine({
    start: { x: mmToPtCoord(x1), y: mmToPtCoord(rectMm.y) },
    end: { x: mmToPtCoord(x1), y: mmToPtCoord(rectMm.y + rectMm.height) },
    color: red,
    thickness: thicknessPt,
  });
  page.drawLine({
    start: { x: mmToPtCoord(x2), y: mmToPtCoord(rectMm.y) },
    end: { x: mmToPtCoord(x2), y: mmToPtCoord(rectMm.y + rectMm.height) },
    color: red,
    thickness: thicknessPt,
  });
  if (centerHorizontal) {
    const y = rectMm.y + rectMm.height / 2;
    page.drawLine({
      start: { x: mmToPtCoord(rectMm.x), y: mmToPtCoord(y) },
      end: { x: mmToPtCoord(rectMm.x + rectMm.width), y: mmToPtCoord(y) },
      color: red,
      thickness: thicknessPt,
    });
  }
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

function drawImageCoverMm(page, embeddedImage, rectMm, { opacity = 1, offsetsMm, scale: scaleFactor } = {}) {
  const { width, height } = embeddedImage.scale(1);
  const targetW = rectMm.width;
  const targetH = rectMm.height;
  const scale = Math.max(targetW / ptToMm(width), targetH / ptToMm(height)) * (Number(scaleFactor) || 1);
  const drawW = ptToMm(width) * scale;
  const drawH = ptToMm(height) * scale;
  const offsetX = Number(offsetsMm?.x) || 0;
  const offsetY = Number(offsetsMm?.y) || 0;
  const x = rectMm.x + (targetW - drawW) / 2 + offsetX;
  const y = rectMm.y + (targetH - drawH) / 2 + offsetY;

  page.drawImage(embeddedImage, {
    x: mmToPtCoord(x),
    y: mmToPtCoord(y),
    width: mmToPt(drawW),
    height: mmToPt(drawH),
    opacity,
  });
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

function drawRectMm(page, rectMm, { color, opacity } = {}) {
  const props = {
    x: mmToPtCoord(rectMm.x),
    y: mmToPtCoord(rectMm.y),
    width: mmToPt(rectMm.width),
    height: mmToPt(rectMm.height),
  };
  if (color) props.color = color;
  if (Number.isFinite(opacity)) props.opacity = opacity;
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

module.exports = {
  buildStickerSheetPdf,
};
