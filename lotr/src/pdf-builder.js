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
const { ensureCardImage, embedImage, MissingCardImageSourceError } = require('./image-utils');

async function buildPdf({
  cards,
  cacheDir,
  cardWidthPt,
  cardHeightPt,
  cutMarkLengthPt,
  gridSize,
  scaleFactor,
  deckName,
  baseUrl,
  fallbackImageBaseUrl,
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
  const normalizedCards = paddedCards.map(card => (card ? normalizeDeckCard(card) : null));
  const cardEntries = normalizedCards.map(deckCard => (deckCard ? resolveCardFaces(deckCard) : null));
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

  await preflightCardImages(pagePlan, cacheDir, { baseUrl, fallbackImageBaseUrl });

  for (let pageIndex = 0; pageIndex < pagePlan.length; pageIndex += 1) {
    const pageConfig = pagePlan[pageIndex];
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);

    const { scaledWidth, scaledHeight, scaledGap, originX, originY } = layout;
    const bleedPt = Math.min(mmToPt(1), scaledGap / 2);

    for (let slotIndex = 0; slotIndex < cardsPerPage; slotIndex += 1) {
      const row = Math.floor(slotIndex / gridSize);
      const col = slotIndex % gridSize;
      const x = originX + col * (scaledWidth + scaledGap);
      const y = originY + (gridSize - row - 1) * (scaledHeight + scaledGap);

      const slot = pageConfig.slots[slotIndex];
      if (!slot || !slot.card) continue;

      drawCardBackground(page, {
        x: x - bleedPt,
        y: y - bleedPt,
        width: scaledWidth + bleedPt * 2,
        height: scaledHeight + bleedPt * 2,
        color: backgroundColor,
      });

      const cardRef = slot.card;
      try {
        const imagePath = await ensureCardImage(cardRef, cacheDir, { baseUrl, fallbackImageBaseUrl });
        const embedded = await embedImage(pdfDoc, imagePath, imageCache);
        drawCardImage(page, embedded, { x, y, width: scaledWidth, height: scaledHeight });
      } catch (err) {
        if (err instanceof MissingCardImageSourceError) {
          drawMissingImagePlaceholder(page, fonts, {
            x,
            y,
            width: scaledWidth,
            height: scaledHeight,
            card: cardRef?.card,
            face: cardRef?.face,
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
    drawPageLabel(page, fonts.bold, { label: deckName || 'deck', pageNumber, totalPages, color: strokeColor });
  }

  return pdfDoc.save();
}

async function preflightCardImages(pagePlan, cacheDir, options = {}) {
  const attempted = new Set();
  const failures = [];

  for (const page of pagePlan) {
    for (const slot of page?.slots || []) {
      if (!slot?.card) continue;

      const cardRef = slot.card;
      const card = cardRef.card;
      const face = cardRef.face || '';
      const src = (cardRef.imageSrc || '').trim();
      const identity = card?.code != null ? String(card.code).trim() : String(card?.fullName || card?.name || '').trim();
      const attemptKey = `${identity}::${face}::${src}`;
      if (attempted.has(attemptKey)) continue;
      attempted.add(attemptKey);

      try {
        await ensureCardImage(cardRef, cacheDir, options);
      } catch (err) {
        if (err instanceof MissingCardImageSourceError) {
          continue;
        }
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
    return {
      card: cardOrEntry.card,
      skipBack: Boolean(cardOrEntry.skipBack),
    };
  }
  return { card: cardOrEntry, skipBack: false };
}

function resolveCardFaces(deckCard) {
  const card = deckCard?.card || deckCard;
  return { front: { card, imageSrc: card?.images?.front, face: 'front' } };
}

function buildPagePlan(cardEntries, cardsPerPage) {
  const pages = [];
  for (let i = 0; i < cardEntries.length; i += cardsPerPage) {
    const slice = cardEntries.slice(i, i + cardsPerPage);
    pages.push({
      slots: fillSlots(slice, cardsPerPage, entry => (entry ? { card: entry.front } : null)),
    });
  }

  return pages.length ? pages : [{ slots: fillSlots([], cardsPerPage, entry => entry) }];
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

function fillSlots(entries, size, mapFn) {
  const slots = new Array(size).fill(null);
  for (let i = 0; i < entries.length && i < size; i += 1) {
    if (entries[i]) {
      slots[i] = mapFn(entries[i]);
    }
  }
  return slots;
}

function drawCardImage(page, embedded, { x, y, width, height }) {
  const cornerRadius = Math.min(width, height) * 0.05;
  applyRoundedRectClip(page, { x, y, width, height, radius: cornerRadius });

  const isLandscape = embedded.width > embedded.height;
  if (!isLandscape) {
    page.drawImage(embedded, { x, y, width, height });
    restoreGraphicsState(page);
    return;
  }

  page.drawImage(embedded, {
    x: x + width,
    y,
    width: height,
    height: width,
    rotate: degrees(90),
  });

  restoreGraphicsState(page);
}

function applyRoundedRectClip(page, { x, y, width, height, radius }) {
  const safeRadius = Number(radius) || 0;
  const effectiveRadius = Math.max(0, Math.min(safeRadius, Math.min(width, height) / 2));

  page.pushOperators(pushGraphicsState());
  page.pushOperators(
    ...roundedRectPathOperators(x, y, width, height, effectiveRadius),
    clip(),
    endPath(),
  );
}

function restoreGraphicsState(page) {
  page.pushOperators(popGraphicsState());
}

function roundedRectPathOperators(x, y, width, height, radius) {
  if (!radius) {
    const x0 = x;
    const y0 = y;
    const x1 = x + width;
    const y1 = y + height;
    return [
      moveTo(x0, y0),
      lineTo(x1, y0),
      lineTo(x1, y1),
      lineTo(x0, y1),
      closePath(),
    ];
  }

  const x0 = x;
  const y0 = y;
  const x1 = x + width;
  const y1 = y + height;
  const k = radius * 0.5522847498307936;

  return [
    moveTo(x0 + radius, y0),
    lineTo(x1 - radius, y0),
    appendBezierCurve(x1 - radius + k, y0, x1, y0 + radius - k, x1, y0 + radius),
    lineTo(x1, y1 - radius),
    appendBezierCurve(x1, y1 - radius + k, x1 - radius + k, y1, x1 - radius, y1),
    lineTo(x0 + radius, y1),
    appendBezierCurve(x0 + radius - k, y1, x0, y1 - radius + k, x0, y1 - radius),
    lineTo(x0, y0 + radius),
    appendBezierCurve(x0, y0 + radius - k, x0 + radius - k, y0, x0 + radius, y0),
    closePath(),
  ];
}

function drawCardBackground(page, { x, y, width, height, color }) {
  page.drawRectangle({ x, y, width, height, color });
}

function drawMissingImagePlaceholder(page, fonts, { x, y, width, height, card, face }) {
  const label = buildPlaceholderLabel(card, face);
  const lines = wrapText(fonts.bold, label, 10, width - 10);

  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });

  const lineHeight = 12;
  const totalTextHeight = lines.length * lineHeight;
  let cursorY = y + height / 2 + totalTextHeight / 2 - lineHeight;

  for (const line of lines) {
    const textWidth = fonts.bold.widthOfTextAtSize(line, 10);
    page.drawText(line, {
      x: x + (width - textWidth) / 2,
      y: cursorY,
      size: 10,
      font: fonts.bold,
      color: rgb(0, 0, 0),
    });
    cursorY -= lineHeight;
  }
}

function buildPlaceholderLabel(card, face) {
  const name = typeof card?.fullName === 'string'
    ? card.fullName.trim()
    : typeof card?.name === 'string'
      ? card.name.trim()
      : '';
  const code = card?.code != null ? String(card.code).trim() : '';
  const faceSuffix = face ? ` (${face})` : '';

  if (name && code) return `${name} [${code}]${faceSuffix}`;
  if (name) return `${name}${faceSuffix}`;
  if (code) return `${code}${faceSuffix}`;
  return `Missing image${faceSuffix}`;
}

function wrapText(font, text, fontSize, maxWidth) {
  const raw = typeof text === 'string' ? text.trim() : String(text);
  if (!raw) return [];

  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);

  const maxLines = 8;
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines - 1).concat(['…']);
  }

  return lines;
}

module.exports = {
  buildPdf,
};

