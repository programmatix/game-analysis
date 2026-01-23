const {
  PDFDocument,
  rgb,
  StandardFonts,
  degrees,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
} = require('pdf-lib');
const {
  GAP_BETWEEN_CARDS_MM,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  mmToPt,
  computeGridLayout,
  drawCutMarks,
  drawRulers,
  drawPageLabel,
} = require('../../shared/pdf-layout');
const { applyRoundedRectClip, restoreGraphicsState } = require('../../shared/pdf-drawing');
const { ensureCardImage, embedImage, MissingCardImageSourceError } = require('./image-utils');

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

async function buildPdf({
  cards,
  cacheDir,
  cardWidthPt,
  cardHeightPt,
  cornerRadiusMm = 3.2,
  cutMarkLengthPt,
  gridSize,
  scaleFactor,
  deckName,
  cdnBaseUrl,
}) {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const backgroundColor = rgb(0, 0, 0);
  const strokeColor = rgb(0, 0, 0);

  const cardsPerPage = gridSize * gridSize;
  const gapPt = mmToPt(GAP_BETWEEN_CARDS_MM);
  const imageCache = new Map();
  const paddedCards = applyProxyPageBreaks(cards, cardsPerPage);
  const cardEntries = paddedCards.map(card => (card ? normalizeDeckCard(card) : null));
  const pagePlan = buildPagePlan(cardEntries, cardsPerPage);
  const totalPages = pagePlan.length || 1;

  const layout = computeGridLayout({
    cardWidthPt,
    cardHeightPt,
    gapPt,
    gridSize,
    scaleFactor,
    pageWidth: A4_WIDTH_PT,
    pageHeight: A4_HEIGHT_PT,
  });

  await preflightCardImages(pagePlan, cacheDir, { cdnBaseUrl });

  for (let pageIndex = 0; pageIndex < pagePlan.length; pageIndex += 1) {
    const pageConfig = pagePlan[pageIndex];
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);

    const { scaledWidth, scaledHeight, scaledGap, originX, originY } = layout;
    const bleedPt = mmToPt(2);

    for (let slotIndex = 0; slotIndex < cardsPerPage; slotIndex += 1) {
      const slot = pageConfig.slots[slotIndex];
      if (!slot || !slot.card) continue;

      const row = Math.floor(slotIndex / gridSize);
      const col = slotIndex % gridSize;
      const x = originX + col * (scaledWidth + scaledGap);
      const y = originY + (gridSize - row - 1) * (scaledHeight + scaledGap);

      drawCardBackground(page, {
        x: x - bleedPt,
        y: y - bleedPt,
        width: scaledWidth + bleedPt * 2,
        height: scaledHeight + bleedPt * 2,
        color: backgroundColor,
      });
    }

    for (let slotIndex = 0; slotIndex < cardsPerPage; slotIndex += 1) {
      const row = Math.floor(slotIndex / gridSize);
      const col = slotIndex % gridSize;
      const x = originX + col * (scaledWidth + scaledGap);
      const y = originY + (gridSize - row - 1) * (scaledHeight + scaledGap);

      const slot = pageConfig.slots[slotIndex];
      if (!slot || !slot.card) continue;

      const cardRef = slot.card;
      try {
        const imagePath = await ensureCardImage(cardRef, cacheDir, { cdnBaseUrl });
        const embedded = await embedImage(pdfDoc, imagePath, imageCache);
        const cornerRadiusPt = mmToPt(cornerRadiusMm) * layout.scale;
        drawCardImage(page, embedded, { x, y, width: scaledWidth, height: scaledHeight, cornerRadiusPt });
      } catch (err) {
        if (err instanceof MissingCardImageSourceError) {
          drawMissingImagePlaceholder(page, fonts, {
            x,
            y,
            width: scaledWidth,
            height: scaledHeight,
            card: cardRef?.card,
          });
          continue;
        }
        throw err;
      }
    }

    drawCutMarks(page, {
      gridSize,
      originX,
      originY,
      cardWidth: scaledWidth,
      cardHeight: scaledHeight,
      cutMarkLength: cutMarkLengthPt,
      gap: scaledGap,
      color: strokeColor,
    });
    drawRulers(page, fonts.regular, strokeColor);

    const pageNumber = pageIndex + 1;
    const pageLabel = deckName || 'deck';
    drawPageLabel(page, fonts.bold, { label: pageLabel, pageNumber, totalPages, color: strokeColor });
  }

  return pdfDoc.save();
}

async function preflightCardImages(pagePlan, cacheDir, options = {}) {
  const cdnBaseUrl = options.cdnBaseUrl;
  const attempted = new Set();
  const failures = [];

  for (const page of pagePlan) {
    for (const slot of page?.slots || []) {
      if (!slot?.card) continue;

      const cardRef = slot.card;
      const card = cardRef.card;
      const src = (cardRef.imageSrc || '').trim();
      const identity = card?.stub != null ? String(card.stub).trim() : String(card?.name || '').trim();
      const attemptKey = `${identity}::${src}`;
      if (attempted.has(attemptKey)) continue;
      attempted.add(attemptKey);

      try {
        await ensureCardImage(cardRef, cacheDir, { cdnBaseUrl });
      } catch (err) {
        if (err instanceof MissingCardImageSourceError) continue;
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (!failures.length) return;
  throw new Error(formatPreflightErrors(failures));
}

function formatPreflightErrors(failures) {
  const counts = new Map();
  for (const failure of failures) {
    const key = String(failure || 'Unknown error');
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const entries = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const total = failures.length;
  const lines = [`Proxy generation failed with ${total} image issue${total === 1 ? '' : 's'}:`];

  const maxLines = 50;
  for (const [message, count] of entries.slice(0, maxLines)) {
    lines.push(`- ${message}${count > 1 ? ` (x${count})` : ''}`);
  }
  if (entries.length > maxLines) {
    lines.push(`- ...and ${entries.length - maxLines} more`);
  }

  return lines.join('\n');
}

function normalizeDeckCard(cardOrEntry) {
  if (cardOrEntry && typeof cardOrEntry === 'object' && 'card' in cardOrEntry) {
    return { card: cardOrEntry.card };
  }
  return { card: cardOrEntry };
}

function buildPagePlan(cardEntries, cardsPerPage) {
  const pages = [];
  for (let i = 0; i < cardEntries.length; i += cardsPerPage) {
    const slice = cardEntries.slice(i, i + cardsPerPage);
    pages.push({
      slots: fillSlots(slice, cardsPerPage, entry => ({ card: entry?.card ? { card: entry.card } : null })),
    });
  }

  return pages.length ? pages : [{ slots: fillSlots([], cardsPerPage, () => null) }];
}

function fillSlots(entries, cardsPerPage, mapper) {
  const slots = [];
  for (let i = 0; i < cardsPerPage; i += 1) {
    const entry = entries[i] || null;
    slots.push(entry ? mapper(entry) : null);
  }
  return slots;
}

function applyProxyPageBreaks(cards, cardsPerPage) {
  if (!Array.isArray(cards) || !Number.isFinite(cardsPerPage) || cardsPerPage <= 0) {
    return Array.isArray(cards) ? cards : [];
  }

  const output = [];
  let slotsFilled = 0;

  for (const card of cards) {
    if (card && card.proxyPageBreak) {
      const remainder = slotsFilled % cardsPerPage;
      if (remainder !== 0) {
        const padding = cardsPerPage - remainder;
        for (let i = 0; i < padding; i += 1) {
          output.push(null);
          slotsFilled += 1;
        }
      }
      continue;
    }

    output.push(card);
    slotsFilled += 1;
  }

  return output;
}

function drawCardBackground(page, { x, y, width, height, color }) {
  page.drawRectangle({ x, y, width, height, color });
}

function drawCardImage(page, embedded, { x, y, width, height, cornerRadiusPt }) {
  if (!embedded) return;

  const cornerRadius = Number.isFinite(cornerRadiusPt) ? cornerRadiusPt : 0;
  applyRoundedRectClip(page, PDF_OPS, { x, y, width, height, radius: cornerRadius });

  const isLandscape = embedded.width > embedded.height;
  const cover = computeCoverPlacement(embedded, { x, y, width, height, rotate: isLandscape });

  if (!cover.rotate) {
    const { rotate, ...drawOptions } = cover;
    page.drawImage(embedded, drawOptions);
    restoreGraphicsState(page, PDF_OPS);
    return;
  }

  page.drawImage(embedded, {
    x: cover.x + cover.finalWidth,
    y: cover.y,
    width: cover.finalHeight,
    height: cover.finalWidth,
    rotate: degrees(90),
  });

  restoreGraphicsState(page, PDF_OPS);
}

function drawMissingImagePlaceholder(page, fonts, { x, y, width, height, card }) {
  const padding = Math.max(4, Math.min(10, width * 0.06));
  const bgColor = rgb(0.12, 0.12, 0.12);
  const borderColor = rgb(0.9, 0.9, 0.9);
  const textColor = rgb(0.95, 0.95, 0.95);

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: bgColor,
    borderColor,
    borderWidth: 1,
  });

  const name = typeof card?.name === 'string' ? card.name.trim() : '';
  const stub = card?.stub != null ? String(card.stub).trim() : '';
  const title = name || stub || 'Unknown card';
  const subtitle = stub ? `${stub} — Missing image` : 'Missing image';

  const maxWidth = width - padding * 2;
  const titleSize = 14;
  const subtitleSize = 10;
  const titleLines = wrapText(fonts.bold, title, titleSize, maxWidth, { maxLines: 3 });

  let cursorY = y + height - padding - titleSize;
  for (const line of titleLines) {
    const lineWidth = fonts.bold.widthOfTextAtSize(line, titleSize);
    page.drawText(line, {
      x: x + (width - lineWidth) / 2,
      y: cursorY,
      size: titleSize,
      font: fonts.bold,
      color: textColor,
    });
    cursorY -= titleSize + 2;
  }

  const subtitleWidth = fonts.regular.widthOfTextAtSize(subtitle, subtitleSize);
  page.drawText(subtitle, {
    x: x + (width - subtitleWidth) / 2,
    y: y + padding,
    size: subtitleSize,
    font: fonts.regular,
    color: textColor,
  });

  page.drawRectangle({
    x: x + padding,
    y: y + padding,
    width: width - padding * 2,
    height: height - padding * 2,
    borderColor,
    borderWidth: 1,
  });
}

function wrapText(font, text, size, maxWidth, options = {}) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const words = raw.split(/\s+/);
  const lines = [];
  const maxLines = Number.isFinite(options.maxLines) ? options.maxLines : Infinity;
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, size);
    if (width <= maxWidth || !current) {
      current = candidate;
      continue;
    }

    lines.push(current);
    if (lines.length >= maxLines) return lines;
    current = word;
  }

  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function computeCoverPlacement(embedded, { x, y, width, height, rotate }) {
  const targetWidth = Number(width) || 0;
  const targetHeight = Number(height) || 0;
  const srcWidth = Number(embedded?.width) || 0;
  const srcHeight = Number(embedded?.height) || 0;

  if (!targetWidth || !targetHeight || !srcWidth || !srcHeight) {
    return rotate
      ? { x, y, width: targetHeight, height: targetWidth, finalWidth: targetWidth, finalHeight: targetHeight, rotate: true }
      : { x, y, width: targetWidth, height: targetHeight, finalWidth: targetWidth, finalHeight: targetHeight, rotate: false };
  }

  const effectiveSrcWidth = rotate ? srcHeight : srcWidth;
  const effectiveSrcHeight = rotate ? srcWidth : srcHeight;

  const scale = Math.max(targetWidth / effectiveSrcWidth, targetHeight / effectiveSrcHeight);
  const finalWidth = effectiveSrcWidth * scale;
  const finalHeight = effectiveSrcHeight * scale;
  const offsetX = (targetWidth - finalWidth) / 2;
  const offsetY = (targetHeight - finalHeight) / 2;

  return {
    x: x + offsetX,
    y: y + offsetY,
    width: finalWidth,
    height: finalHeight,
    finalWidth,
    finalHeight,
    rotate: Boolean(rotate),
  };
}

module.exports = {
  buildPdf,
};
