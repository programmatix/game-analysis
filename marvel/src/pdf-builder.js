const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');
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
const { ensureCardImage, embedImage } = require('./image-utils');

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
  cardIndex,
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
  const cardEntries = normalizedCards.map(deckCard => (deckCard ? resolveCardFaces(deckCard, cardIndex) : null));
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

      const imagePath = await ensureCardImage(slot.card, cacheDir, { baseUrl });
      const embedded = await embedImage(pdfDoc, imagePath, imageCache);
      drawCardImage(page, embedded, { x, y, width: scaledWidth, height: scaledHeight });
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

function normalizeDeckCard(cardOrEntry) {
  if (cardOrEntry && typeof cardOrEntry === 'object' && 'card' in cardOrEntry) {
    return {
      card: cardOrEntry.card,
      skipBack: Boolean(cardOrEntry.skipBack),
    };
  }
  return { card: cardOrEntry, skipBack: false };
}

function resolveCardFaces(deckCard, cardIndex) {
  const card = deckCard?.card || deckCard;
  const skipBack = Boolean(deckCard?.skipBack);
  const front = { card, imageSrc: card?.imagesrc, face: 'front' };

  if (skipBack) {
    return { front, back: null };
  }

  const back = resolveBackTarget(card, cardIndex);
  return { front, back };
}

function resolveBackTarget(card, cardIndex) {
  if (!card) return null;

  if (card.double_sided && card.backimagesrc) {
    return { card, imageSrc: card.backimagesrc, face: 'back' };
  }

  if (card.backimagesrc) {
    return { card, imageSrc: card.backimagesrc, face: 'back' };
  }

  const linkedCode = card.linked_to_code ? String(card.linked_to_code).trim() : '';
  if (linkedCode) {
    const linked = cardIndex?.get(linkedCode) || card.linked_card;
    if (linked && linked.imagesrc) {
      return { card: linked, imageSrc: linked.imagesrc, face: 'back' };
    }
  }

  if (card.linked_card && card.linked_card.imagesrc) {
    return { card: card.linked_card, imageSrc: card.linked_card.imagesrc, face: 'back' };
  }

  return null;
}

function buildPagePlan(cardEntries, cardsPerPage) {
  const pages = [];
  for (let i = 0; i < cardEntries.length; i += cardsPerPage) {
    const slice = cardEntries.slice(i, i + cardsPerPage);
    pages.push({
      slots: fillSlots(slice, cardsPerPage, entry => ({ card: entry.front })),
      isBack: false,
    });

    if (slice.some(entry => entry && entry.back)) {
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
  const isLandscape = embedded.width > embedded.height;
  if (!isLandscape) {
    page.drawImage(embedded, { x, y, width, height });
    return;
  }

  page.drawImage(embedded, {
    x: x + width,
    y,
    width: height,
    height: width,
    rotate: degrees(90),
  });
}

function drawCardBackground(page, { x, y, width, height, color }) {
  page.drawRectangle({ x, y, width, height, color });
}

module.exports = {
  buildPdf,
};
