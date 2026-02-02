const fs = require('node:fs');
const fontkit = require('@pdf-lib/fontkit');
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

async function buildStickerSheetPdf(config, { debug } = {}) {
  const sheet = config?.sheet;
  if (!sheet) throw new Error('Missing config.sheet');

  const pageWidthMm = Number(sheet.pageWidthMm);
  const pageHeightMm = Number(sheet.pageHeightMm);
  if (!Number.isFinite(pageWidthMm) || !Number.isFinite(pageHeightMm)) {
    throw new Error('config.sheet.pageWidthMm/pageHeightMm must be numbers (did you normalize config first?)');
  }

  const stickerWidthMm = Number(sheet.stickerWidthMm) || 70;
  const topStickerHeightMm = Number(sheet.topStickerHeightMm ?? sheet.stickerHeightMm) || 25;
  const frontStickerHeightMm = Number(sheet.frontStickerHeightMm) || 40;
  const cornerRadiusMm = Number(sheet.cornerRadiusMm) || 0;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const imageCache = new Map();
  const fontCache = new Map();

  const pages = computePackedStickerPagesMm(config, {
    pageWidthMm,
    pageHeightMm,
    stickerWidthMm,
    topStickerHeightMm,
    frontStickerHeightMm,
  });

  for (const packed of pages) {
    const page = pdfDoc.addPage([mmToPt(pageWidthMm), mmToPt(pageHeightMm)]);
    page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: rgb(1, 1, 1) });

    for (const slot of packed.stickers) {
      await drawSticker(page, pdfDoc, imageCache, fontCache, slot.rectMm, slot.sticker, { cornerRadiusMm });
      if (debug) drawDebugGuidesForStickerMm(page, slot.rectMm, config);
    }

    drawPageEdgeCutMarksMm(page, { pageWidthMm, pageHeightMm });
  }

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  return {
    pdfBytes,
    sheet: {
      pageWidthMm,
      pageHeightMm,
      orientation: sheet.orientation,
      columns: Number(sheet.columns) || 1,
      pages: pages.length,
      stickers: Array.isArray(config.stickers) ? config.stickers.length : 0,
    },
  };
}

function computePackedStickerPagesMm(config, { pageWidthMm, pageHeightMm, stickerWidthMm, topStickerHeightMm, frontStickerHeightMm }) {
  const sheet = config.sheet;
  const columns = clampInt(sheet.columns ?? 2, { min: 1, max: 20 });
  const marginMm = Number(sheet.marginMm) || 0;
  const gutterMm = Number(sheet.gutterMm) || 0;

  const usableW = pageWidthMm - marginMm * 2;
  const usableH = pageHeightMm - marginMm * 2;

  const gridW = stickerWidthMm * columns + gutterMm * (columns - 1);
  const originX = marginMm + (usableW - gridW) / 2;
  const xByCol = Array.from({ length: columns }, (_, c) => originX + c * (stickerWidthMm + gutterMm));

  function heightForSticker(sticker) {
    const kind = String(sticker?.kind || 'top').trim().toLowerCase();
    return kind === 'front' ? frontStickerHeightMm : topStickerHeightMm;
  }

  function shouldRenderSticker(sticker) {
    if (!sticker || typeof sticker !== 'object') return false;
    if (sticker.logo || sticker.art) return true;
    if (Array.isArray(sticker.textOverlays) && sticker.textOverlays.some(o => o && typeof o === 'object' && String(o.text || '').trim())) return true;
    return false;
  }

  const stickers = Array.isArray(config.stickers) ? config.stickers : [];
  const pages = [];

  let current = [];
  let yCursorTop = Array(columns).fill(pageHeightMm - marginMm);

  function startNewPage() {
    if (current.length) pages.push({ stickers: current });
    current = [];
    yCursorTop = Array(columns).fill(pageHeightMm - marginMm);
  }

  for (const sticker of stickers) {
    if (!shouldRenderSticker(sticker)) continue;

    const h = heightForSticker(sticker);
    if (h > usableH + 1e-6) {
      throw new Error(`Sticker height ${h}mm is too tall for the page's usable height (${usableH}mm).`);
    }

    let bestCol = -1;
    let bestRemaining = Infinity;
    for (let col = 0; col < columns; col++) {
      const yTop = yCursorTop[col];
      const y = yTop - h;
      const remaining = y - marginMm;
      if (remaining < -1e-6) continue;
      if (remaining < bestRemaining) {
        bestRemaining = remaining;
        bestCol = col;
      }
    }

    if (bestCol === -1) {
      startNewPage();

      // Always fits after new page (we already checked h <= usableH).
      const yTop = yCursorTop[0];
      const y = yTop - h;
      current.push({
        rectMm: { x: xByCol[0], y, width: stickerWidthMm, height: h },
        sticker,
      });
      yCursorTop[0] = y - gutterMm;
      continue;
    }

    const yTop = yCursorTop[bestCol];
    const y = yTop - h;
    current.push({
      rectMm: { x: xByCol[bestCol], y, width: stickerWidthMm, height: h },
      sticker,
    });
    yCursorTop[bestCol] = y - gutterMm;
  }

  if (current.length) pages.push({ stickers: current });
  if (pages.length === 0) pages.push({ stickers: [] });

  return pages;
}

async function drawSticker(page, pdfDoc, imageCache, fontCache, rectMm, sticker, { cornerRadiusMm }) {
  const kind = String(sticker?.kind || 'top').trim().toLowerCase();

  const embeddedLogo = sticker.logo ? await embedImage(pdfDoc, sticker.logo, imageCache) : null;
  const embeddedArt = sticker.art ? await embedImage(pdfDoc, sticker.art, imageCache) : null;

  if (kind === 'front') {
    await drawFrontSticker(page, rectMm, { embeddedLogo, embeddedArt }, { ...sticker, cornerRadiusMm });
    return;
  }

  // default: top sticker
  const gradient = parseHexColor(sticker.gradient ?? sticker.yellow, rgb(0.97, 0.82, 0.09));
  await drawTopSticker(page, rectMm, { embeddedLogo, embeddedArt }, { ...sticker, cornerRadiusMm, gradient });
  await drawTopTextOverlaysMm(page, pdfDoc, fontCache, rectMm, sticker, { cornerRadiusMm });
}

async function drawTopSticker(page, rectMm, { embeddedLogo, embeddedArt }, cfg) {
  const paddingMm = 1.2;
  const safeRectMm = insetRectMm(rectMm, paddingMm);
  const cornerRadiusMm = Math.max(0, Number(cfg.cornerRadiusMm) || 0);

  await withClipRoundedRectMm(page, rectMm, cornerRadiusMm, () => {
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
      solidWidthMm: 20,
      steps: 42,
    });
  });

  drawLogoMm(page, safeRectMm, embeddedLogo, cfg);
}

async function drawFrontSticker(page, rectMm, { embeddedLogo, embeddedArt }, cfg) {
  const paddingMm = 1.2;
  const safeRectMm = insetRectMm(rectMm, paddingMm);
  const cornerRadiusMm = Math.max(0, Number(cfg.cornerRadiusMm) || 0);

  await withClipRoundedRectMm(page, rectMm, cornerRadiusMm, () => {
    drawRectMm(page, rectMm, { color: rgb(1, 1, 1), opacity: 1 });
    if (embeddedArt) {
      drawImageCoverMm(page, embeddedArt, rectMm, {
        opacity: 1,
        offsetsMm: { x: cfg.artOffsetXMm, y: cfg.artOffsetYMm },
        scale: Number(cfg.artScale) || 1,
      });
    }
  });

  drawLogoMm(page, safeRectMm, embeddedLogo, cfg);
}

function drawLogoMm(page, safeRectMm, embeddedLogo, cfg) {
  if (!embeddedLogo) return;

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
    width: Math.min((Number(cfg.logoMaxWidthMm) || 28) * (Number(cfg.logoScale) || 1), logoArea.width),
    height: Math.min((Number(cfg.logoMaxHeightMm) || 18) * (Number(cfg.logoScale) || 1), logoArea.height),
  };

  drawImageContainMm(page, embeddedLogo, target, { opacity: 0.98 });
}

async function drawTopTextOverlaysMm(page, pdfDoc, fontCache, rectMm, sticker, { cornerRadiusMm }) {
  const overlays = Array.isArray(sticker?.textOverlays) ? sticker.textOverlays : [];
  const active = overlays.filter(o => o && typeof o === 'object' && String(o.text || '').trim());
  if (!active.length) return;

  await withClipRoundedRectMm(page, rectMm, Math.max(0, Number(cornerRadiusMm) || 0), async () => {
    for (const overlay of active) {
      const font = await resolveOverlayFont(pdfDoc, fontCache, overlay);
      const fontSizeMm = Math.max(0.1, Number(overlay.fontSizeMm) || 3.6);
      const fontSizePt = mmToPt(fontSizeMm);
      const paddingMm = Math.max(0, Number(overlay.paddingMm) || 1);
      const paddingPt = mmToPt(paddingMm);

      const text = String(overlay.text || '');
      const lines = text.replaceAll('\r\n', '\n').split('\n');
      const lineHeightPt = fontSizePt * 1.2;
      const widths = lines.map(line => font.widthOfTextAtSize(line, fontSizePt));
      const maxLineWidthPt = widths.length ? Math.max(...widths) : 0;

      const boxWidthPt = maxLineWidthPt + paddingPt * 2;
      const boxHeightPt = lines.length * lineHeightPt + paddingPt * 2;

      const xPt = mmToPtCoord(rectMm.x + (Number(overlay.xMm) || 0));
      const yTopPt = mmToPtCoord(rectMm.y + rectMm.height - (Number(overlay.yMm) || 0));
      const yPt = yTopPt - boxHeightPt;

      const bgRaw = typeof overlay.background === 'string' ? overlay.background : (typeof overlay.backgroundColor === 'string' ? overlay.backgroundColor : '');
      if (bgRaw) {
        const bg = parseHexColor(bgRaw, rgb(1, 1, 1));
        page.drawRectangle({ x: xPt, y: yPt, width: boxWidthPt, height: boxHeightPt, color: bg, opacity: 1 });
      }

      const fg = parseHexColor(overlay.color, rgb(0, 0, 0));
      const align = String(overlay.align || 'left').trim().toLowerCase();
      const innerWidthPt = Math.max(0, boxWidthPt - paddingPt * 2);

      let cursorY = yPt + boxHeightPt - paddingPt - fontSizePt;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineWidthPt = widths[i] || 0;
        let lineX = xPt + paddingPt;
        if (align === 'center') lineX = xPt + paddingPt + (innerWidthPt - lineWidthPt) / 2;
        if (align === 'right') lineX = xPt + paddingPt + (innerWidthPt - lineWidthPt);

        page.drawText(line, {
          x: lineX,
          y: cursorY,
          size: fontSizePt,
          font,
          color: fg,
          lineHeight: lineHeightPt,
        });
        cursorY -= lineHeightPt;
      }
    }
  });
}

async function resolveOverlayFont(pdfDoc, fontCache, overlay) {
  const fontPath = typeof overlay.fontPath === 'string' ? overlay.fontPath.trim() : '';
  if (fontPath) {
    const key = `file:${fontPath}`;
    if (fontCache.has(key)) return fontCache.get(key);
    const data = await fs.promises.readFile(fontPath);
    const embedded = await pdfDoc.embedFont(data, { subset: true });
    fontCache.set(key, embedded);
    return embedded;
  }

  const requested = String(overlay.font || '').trim();
  const std = toStandardFont(requested);
  const key = `std:${std}`;
  if (fontCache.has(key)) return fontCache.get(key);
  const embedded = await pdfDoc.embedFont(std);
  fontCache.set(key, embedded);
  return embedded;
}

function toStandardFont(requested) {
  const raw = String(requested || '').trim().toLowerCase();
  switch (raw) {
    case 'helvetica':
      return StandardFonts.Helvetica;
    case 'helvetica-bold':
    case 'helvetica bold':
      return StandardFonts.HelveticaBold;
    case 'helvetica-oblique':
    case 'helvetica oblique':
      return StandardFonts.HelveticaOblique;
    case 'helvetica-boldoblique':
    case 'helvetica-bold-oblique':
    case 'helvetica boldoblique':
    case 'helvetica bold oblique':
      return StandardFonts.HelveticaBoldOblique;
    case 'times-roman':
    case 'times roman':
    case 'times':
      return StandardFonts.TimesRoman;
    case 'times-bold':
    case 'times bold':
      return StandardFonts.TimesBold;
    case 'times-italic':
    case 'times italic':
      return StandardFonts.TimesItalic;
    case 'times-bolditalic':
    case 'times-bold-italic':
    case 'times bolditalic':
    case 'times bold italic':
      return StandardFonts.TimesBoldItalic;
    case 'courier':
      return StandardFonts.Courier;
    case 'courier-bold':
    case 'courier bold':
      return StandardFonts.CourierBold;
    case 'courier-oblique':
    case 'courier oblique':
      return StandardFonts.CourierOblique;
    case 'courier-boldoblique':
    case 'courier-bold-oblique':
    case 'courier boldoblique':
    case 'courier bold oblique':
      return StandardFonts.CourierBoldOblique;
    default:
      return StandardFonts.Helvetica;
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

function drawPageEdgeCutMarksMm(page, { pageWidthMm, pageHeightMm } = {}) {
  const insetMm = 0.7;
  const lenMm = 7;
  const tPt = 0.7;
  const black = rgb(0, 0, 0);

  const left = insetMm;
  const right = pageWidthMm - insetMm;
  const bottom = insetMm;
  const top = pageHeightMm - insetMm;

  // Top-left
  page.drawLine({ start: { x: mmToPtCoord(left), y: mmToPtCoord(top) }, end: { x: mmToPtCoord(left + lenMm), y: mmToPtCoord(top) }, color: black, thickness: tPt });
  page.drawLine({ start: { x: mmToPtCoord(left), y: mmToPtCoord(top) }, end: { x: mmToPtCoord(left), y: mmToPtCoord(top - lenMm) }, color: black, thickness: tPt });
  // Top-right
  page.drawLine({ start: { x: mmToPtCoord(right), y: mmToPtCoord(top) }, end: { x: mmToPtCoord(right - lenMm), y: mmToPtCoord(top) }, color: black, thickness: tPt });
  page.drawLine({ start: { x: mmToPtCoord(right), y: mmToPtCoord(top) }, end: { x: mmToPtCoord(right), y: mmToPtCoord(top - lenMm) }, color: black, thickness: tPt });
  // Bottom-left
  page.drawLine({ start: { x: mmToPtCoord(left), y: mmToPtCoord(bottom) }, end: { x: mmToPtCoord(left + lenMm), y: mmToPtCoord(bottom) }, color: black, thickness: tPt });
  page.drawLine({ start: { x: mmToPtCoord(left), y: mmToPtCoord(bottom) }, end: { x: mmToPtCoord(left), y: mmToPtCoord(bottom + lenMm) }, color: black, thickness: tPt });
  // Bottom-right
  page.drawLine({ start: { x: mmToPtCoord(right), y: mmToPtCoord(bottom) }, end: { x: mmToPtCoord(right - lenMm), y: mmToPtCoord(bottom) }, color: black, thickness: tPt });
  page.drawLine({ start: { x: mmToPtCoord(right), y: mmToPtCoord(bottom) }, end: { x: mmToPtCoord(right), y: mmToPtCoord(bottom + lenMm) }, color: black, thickness: tPt });
}

async function withClipRoundedRectMm(page, rectMm, radiusMm, fn) {
  applyRoundedRectClip(page, PDF_OPS, {
    x: mmToPtCoord(rectMm.x),
    y: mmToPtCoord(rectMm.y),
    width: mmToPt(rectMm.width),
    height: mmToPt(rectMm.height),
    radius: mmToPt(Math.max(0, Number(radiusMm) || 0)),
  });
  try {
    await fn();
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
