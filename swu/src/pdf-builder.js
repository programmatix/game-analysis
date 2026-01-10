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
  includeBacks = false,
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
  const cardEntries = normalizedCards.map(deckCard => (deckCard ? resolveCardFaces(deckCard, { includeBacks }) : null));
  const pagePlan = buildPagePlan(cardEntries, cardsPerPage, { includeBacks });
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

  await preflightCardImages(pagePlan, cacheDir);

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
        const imagePath = await ensureCardImage(cardRef, cacheDir);
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
    const pageLabel = pageConfig.isBack ? `${deckName || 'deck'} (backs)` : deckName || 'deck';
    drawPageLabel(page, fonts.bold, { label: pageLabel, pageNumber, totalPages, color: strokeColor });
  }

  return pdfDoc.save();
}

async function preflightCardImages(pagePlan, cacheDir) {
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
        await ensureCardImage(cardRef, cacheDir);
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

function resolveCardFaces(deckCard, { includeBacks } = {}) {
  const card = deckCard?.card || deckCard;
  const skipBack = Boolean(deckCard?.skipBack);
  const front = { card, imageSrc: card?.images?.front, face: 'front' };

  if (!includeBacks) return { front, back: null };
  if (skipBack) return { front, back: null };

  const backSrc = card?.images?.back;
  if (card?.doubleSided && backSrc) return { front, back: { card, imageSrc: backSrc, face: 'back' } };
  if (backSrc) return { front, back: { card, imageSrc: backSrc, face: 'back' } };
  return { front, back: null };
}

function buildPagePlan(cardEntries, cardsPerPage, { includeBacks } = {}) {
  const pages = [];
  for (let i = 0; i < cardEntries.length; i += cardsPerPage) {
    const slice = cardEntries.slice(i, i + cardsPerPage);
    pages.push({
      slots: fillSlots(slice, cardsPerPage, entry => ({ card: entry.front })),
      isBack: false,
    });

    if (includeBacks && slice.some(entry => entry && entry.back)) {
      const backSlots = fillSlots(slice, cardsPerPage, entry => (entry && entry.back ? { card: entry.back } : null));
      const gridSize = Math.sqrt(cardsPerPage);
      for (let rowStart = 0; rowStart < backSlots.length; rowStart += gridSize) {
        const rowEnd = Math.min(rowStart + gridSize, backSlots.length);
        const row = backSlots.slice(rowStart, rowEnd);
        row.reverse();
        backSlots.splice(rowStart, row.length, ...row);
      }
      pages.push({
        slots: backSlots,
        isBack: true,
      });
    }
  }

  return pages.length ? pages : [{ slots: fillSlots([], cardsPerPage, entry => entry), isBack: false }];
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

function drawMissingImagePlaceholder(page, fonts, { x, y, width, height, card, face }) {
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

  const name = typeof card?.fullName === 'string' ? card.fullName.trim() : typeof card?.name === 'string' ? card.name.trim() : '';
  const code = card?.code != null ? String(card.code).trim() : '';
  const faceLabel = face ? String(face).trim() : '';

  const title = name || code || 'Unknown card';
  const subtitleParts = [];
  if (code) subtitleParts.push(code);
  if (faceLabel) subtitleParts.push(`[${faceLabel}]`);
  subtitleParts.push('Missing image');
  const subtitle = subtitleParts.join(' ');

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
}

function wrapText(font, text, fontSize, maxWidth, options = {}) {
  const maxLines = Number.isInteger(options.maxLines) ? options.maxLines : Infinity;
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return [];
  if (!font || typeof font.widthOfTextAtSize !== 'function') return [raw];

  const words = raw.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  const pushLine = line => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    lines.push(trimmed);
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      pushLine(current);
      current = word;
    } else {
      pushLine(truncateText(font, word, fontSize, maxWidth));
      current = '';
    }

    if (lines.length >= maxLines) {
      return lines.slice(0, maxLines);
    }
  }

  if (current && lines.length < maxLines) {
    pushLine(current);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  return lines;
}

function truncateText(font, text, fontSize, maxWidth) {
  const raw = typeof text === 'string' ? text : String(text);
  if (!raw) return '';
  if (font.widthOfTextAtSize(raw, fontSize) <= maxWidth) return raw;

  const ellipsis = '…';
  let end = raw.length;
  while (end > 0) {
    const candidate = `${raw.slice(0, end)}${ellipsis}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      return candidate;
    }
    end -= 1;
  }
  return ellipsis;
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
  const effectiveRadius = Math.max(0, Math.min(cornerRadius, width / 2, height / 2));

  page.pushOperators(
    pushGraphicsState(),
    ...roundedRectPathOperators(x, y, width, height, effectiveRadius),
    closePath(),
    clip(),
    endPath(),
  );

  const isLandscape = embedded.width > embedded.height;
  if (!isLandscape) {
    page.drawImage(embedded, { x, y, width, height });
    page.pushOperators(popGraphicsState());
    return;
  }

  page.drawImage(embedded, {
    x: x + width,
    y,
    width: height,
    height: width,
    rotate: degrees(90),
  });

  page.pushOperators(popGraphicsState());
}

function roundedRectPathOperators(x, y, width, height, radius) {
  if (!radius) {
    return [moveTo(x, y), lineTo(x + width, y), lineTo(x + width, y + height), lineTo(x, y + height)];
  }

  const kappa = 0.5522847498307936;
  const k = radius * kappa;

  const x0 = x;
  const y0 = y;
  const x1 = x + width;
  const y1 = y + height;

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
  ];
}

function drawCardBackground(page, { x, y, width, height, color }) {
  page.drawRectangle({ x, y, width, height, color });
}

module.exports = {
  buildPdf,
};
