const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
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
const { ensureCardImage, embedImage, MissingCardImageError } = require('./image-utils');

async function buildPdf({
  cards,
  cacheDir,
  cardWidthPt,
  cardHeightPt,
  cutMarkLengthPt,
  gridSize,
  scaleFactor,
  label,
  refreshImages = false,
}) {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const strokeColor = rgb(0, 0, 0);
  const backgroundColor = rgb(0, 0, 0);
  const missingColor = rgb(0.95, 0.95, 0.95);

  const cardsPerPage = gridSize * gridSize;
  const gapPt = mmToPt(GAP_BETWEEN_CARDS_MM);
  const imageCache = new Map();

  const normalizedCards = Array.isArray(cards) ? cards.filter(Boolean) : [];
  const pages = chunkCards(normalizedCards, cardsPerPage);
  const totalPages = pages.length || 1;

  const layout = computeGridLayout({
    cardWidthPt,
    cardHeightPt,
    gapPt,
    gridSize,
    scaleFactor,
    pageWidth: A4_WIDTH_PT,
    pageHeight: A4_HEIGHT_PT,
  });

  const preflight = await preflightImages(normalizedCards, cacheDir, { refresh: refreshImages });
  if (preflight.failures.length) {
    console.warn(formatPreflightWarnings(preflight.failures));
  }

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    const pageCards = pages[pageIndex] || [];
    const { scaledWidth, scaledHeight, scaledGap, originX, originY } = layout;
    const bleedPt = Math.min(mmToPt(1), scaledGap / 2);

    for (let slotIndex = 0; slotIndex < cardsPerPage; slotIndex += 1) {
      const row = Math.floor(slotIndex / gridSize);
      const col = slotIndex % gridSize;
      const x = originX + col * (scaledWidth + scaledGap);
      const y = originY + (gridSize - row - 1) * (scaledHeight + scaledGap);

      const card = pageCards[slotIndex];
      if (!card) continue;

      drawRect(page, {
        x: x - bleedPt,
        y: y - bleedPt,
        width: scaledWidth + bleedPt * 2,
        height: scaledHeight + bleedPt * 2,
        color: backgroundColor,
      });

      try {
        const imagePath = await ensureCardImage(card, cacheDir, { refresh: refreshImages });
        const embedded = await embedImage(pdfDoc, imagePath, imageCache);
        page.drawImage(embedded, { x, y, width: scaledWidth, height: scaledHeight });
      } catch (err) {
        if (err instanceof MissingCardImageError) {
          drawMissingImage(page, fonts, {
            x,
            y,
            width: scaledWidth,
            height: scaledHeight,
            card,
            color: missingColor,
            strokeColor,
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

    drawPageLabel(page, fonts.bold, {
      label: label || 'KeyForge Adventure',
      pageNumber: pageIndex + 1,
      totalPages,
      color: strokeColor,
    });
  }

  return pdfDoc.save();
}

async function preflightImages(cards, cacheDir, { refresh } = {}) {
  const failures = [];

  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card) continue;
    try {
      await ensureCardImage(card, cacheDir, { refresh });
    } catch (err) {
      if (err instanceof MissingCardImageError) {
        failures.push(err.message);
        continue;
      }
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { failures };
}

function formatPreflightWarnings(failures) {
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
  const lines = [`Warning: ${total} card image issue${total === 1 ? '' : 's'}; rendering placeholders:`];
  const maxLines = 50;
  for (const [message, count] of entries.slice(0, maxLines)) {
    lines.push(`- ${message}${count > 1 ? ` (x${count})` : ''}`);
  }
  if (entries.length > maxLines) {
    lines.push(`- ...and ${entries.length - maxLines} more`);
  }
  return lines.join('\n');
}

function chunkCards(cards, chunkSize) {
  if (!cards.length) return [];
  const chunks = [];
  for (let i = 0; i < cards.length; i += chunkSize) {
    chunks.push(cards.slice(i, i + chunkSize));
  }
  return chunks;
}

function drawRect(page, { x, y, width, height, color }) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color,
  });
}

function drawMissingImage(page, fonts, { x, y, width, height, card, color, strokeColor }) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color,
    borderColor: strokeColor,
    borderWidth: 1,
  });

  const title = String(card?.name || 'Missing image');
  const fileName = String(card?.image || '').trim();
  const details = fileName ? `File: ${fileName}` : '';

  const padding = 10;
  const fontSize = 10;
  const lines = [title, details].filter(Boolean);
  const maxWidth = width - padding * 2;

  let cursorY = y + height - padding - fontSize;
  for (const line of lines) {
    const clipped = clipText(fonts.bold, line, fontSize, maxWidth);
    page.drawText(clipped, {
      x: x + padding,
      y: cursorY,
      size: fontSize,
      font: fonts.bold,
      color: rgb(0, 0, 0),
    });
    cursorY -= fontSize + 4;
  }
}

function clipText(font, text, size, maxWidth) {
  const raw = String(text || '');
  if (font.widthOfTextAtSize(raw, size) <= maxWidth) return raw;
  const suffix = '…';
  const suffixWidth = font.widthOfTextAtSize(suffix, size);
  let result = '';
  for (const ch of raw) {
    const next = result + ch;
    if (font.widthOfTextAtSize(next, size) + suffixWidth > maxWidth) break;
    result = next;
  }
  return result ? `${result}${suffix}` : suffix;
}

module.exports = {
  buildPdf,
};

