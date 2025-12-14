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
  deckName,
  face,
  cardIndex,
}) {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const cardBackgroundColor = rgb(0, 0, 0);
  const strokeColor = rgb(0, 0, 0);

  const cardsPerPage = gridSize * gridSize;
  const gapPt = mmToPt(GAP_BETWEEN_CARDS_MM);
  const imageCache = new Map();
  const cardEntries = cards.map(card => resolveCardFaces(normalizeDeckCard(card), face, cardIndex));
  const pagePlan = buildPagePlan(cardEntries, cardsPerPage);
  const totalPages = pagePlan.length || 1;
  const layout = computeGridLayout({
    cardWidthPt,
    cardHeightPt,
    gapPt,
    gridSize,
    pageWidth: A4_WIDTH_PT,
    pageHeight: A4_HEIGHT_PT,
  });

  for (let pageIndex = 0; pageIndex < pagePlan.length; pageIndex++) {
    const pageConfig = pagePlan[pageIndex];
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);

    const { scaledWidth, scaledHeight, scaledGap, originX, originY } = layout;
    const bleedPt = Math.min(mmToPt(1), scaledGap / 2);

    for (let slotIndex = 0; slotIndex < cardsPerPage; slotIndex++) {
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
        color: cardBackgroundColor,
      });
      const imagePath = await ensureCardImage(slot.card, cacheDir, face, { face: slot.face });
      const embedded = await embedImage(pdfDoc, imagePath, imageCache);
      drawCardImage(page, embedded, {
        x,
        y,
        width: scaledWidth,
        height: scaledHeight,
      });
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
    drawPageLabel(page, fonts.bold, {
      label: pageLabel,
      pageNumber,
      totalPages,
      color: strokeColor,
    });
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

function resolveCardFaces(deckCard, defaultFace, cardIndex) {
  const card = deckCard && deckCard.card ? deckCard.card : deckCard;
  const skipBack = Boolean(deckCard && deckCard.skipBack);
  const faceFromCode = parseFaceFromCode(card?.code);
  const frontFace = faceFromCode ?? (defaultFace === 'b' ? 'b' : 'a');
  let backCard = null;
  let backFace = null;

  if (!skipBack) {
    if (card?.double_sided) {
      backCard = card;
      backFace = flipFace(frontFace);
    } else if (card?.back_link) {
      const target = cardIndex?.get(String(card.back_link).trim());
      if (target) {
        backCard = target;
        backFace = parseFaceFromCode(target.code) ?? flipFace(frontFace);
      } else {
        const label = card?.name || card?.code || 'card';
        console.warn(`Unable to find back_link card "${card.back_link}" for ${label}.`);
      }
    }
  }

  return { card, face: frontFace, backFace, backCard };
}

function parseFaceFromCode(code) {
  if (!code) return null;
  const match = /([a-z])$/i.exec(code.trim());
  if (!match) return null;
  const face = match[1].toLowerCase();
  return face === 'a' || face === 'b' ? face : null;
}

function flipFace(face) {
  if (face === 'a') return 'b';
  if (face === 'b') return 'a';
  return null;
}

function buildPagePlan(cardEntries, cardsPerPage) {
  const pages = [];
  for (let i = 0; i < cardEntries.length; i += cardsPerPage) {
    const slice = cardEntries.slice(i, i + cardsPerPage);
    pages.push({
      slots: fillSlots(slice, cardsPerPage, entry => ({ card: entry.card, face: entry.face })),
      isBack: false,
    });

    if (slice.some(entry => entry.backFace)) {
      pages.push({
        slots: fillSlots(
          slice,
          cardsPerPage,
          entry => (entry.backFace ? { card: entry.backCard || entry.card, face: entry.backFace } : null)
        ),
        isBack: true,
      });
    }
  }

  return pages.length ? pages : [{ slots: fillSlots([], cardsPerPage, entry => entry), isBack: false }];
}

function fillSlots(entries, size, mapFn) {
  const slots = new Array(size).fill(null);
  for (let i = 0; i < entries.length && i < size; i++) {
    slots[i] = mapFn(entries[i]);
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
