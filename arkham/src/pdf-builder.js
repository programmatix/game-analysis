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
}) {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const backgroundColor = rgb(0, 0, 0);
  const strokeColor = rgb(1, 1, 1);

  const cardsPerPage = gridSize * gridSize;
  const gapPt = mmToPt(GAP_BETWEEN_CARDS_MM);
  const imageCache = new Map();
  const totalPages = Math.ceil(cards.length / cardsPerPage) || 1;

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH_PT, height: A4_HEIGHT_PT, color: backgroundColor });

    const { scaledWidth, scaledHeight, scaledGap, originX, originY } = computeGridLayout({
      cardWidthPt,
      cardHeightPt,
      gapPt,
      gridSize,
      pageWidth: A4_WIDTH_PT,
      pageHeight: A4_HEIGHT_PT,
    });

    const startIndex = pageIndex * cardsPerPage;
    const endIndex = Math.min(startIndex + cardsPerPage, cards.length);
    for (let i = startIndex; i < endIndex; i++) {
      const slotIndex = i - startIndex;
      const row = Math.floor(slotIndex / gridSize);
      const col = slotIndex % gridSize;
      const x = originX + col * (scaledWidth + scaledGap);
      const y = originY + (gridSize - row - 1) * (scaledHeight + scaledGap);

      const card = cards[i];
      const imagePath = await ensureCardImage(card, cacheDir, face);
      const embedded = await embedImage(pdfDoc, imagePath, imageCache);
      page.drawImage(embedded, { x, y, width: scaledWidth, height: scaledHeight });
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
    drawPageLabel(page, fonts.bold, {
      label: deckName || 'deck',
      pageNumber,
      totalPages,
      color: strokeColor,
    });
  }

  return pdfDoc.save();
}

module.exports = {
  buildPdf,
};
