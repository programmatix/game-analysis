#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const {
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  GAP_BETWEEN_CARDS_MM,
  mmToPt,
  computeGridLayout,
  drawCutMarks,
  drawRulers,
  drawPageLabel,
} = require('./pdf-layout');

const program = new Command();
program
  .name('lorcana-grid-template')
  .description('Generate a blank A4 grid page with rulers and cut marks')
  .option('--output <file>', 'Output PDF path', 'grid-template.pdf')
  .option('--grid-size <number>', 'Grid size (NxN)', '3')
  .option('--card-width-mm <number>', 'Card width in millimetres', '63.5')
  .option('--card-height-mm <number>', 'Card height in millimetres', '88.9')
  .option('--gap-mm <number>', 'Gap between cards in millimetres', String(GAP_BETWEEN_CARDS_MM))
  .option('--cut-mark-length-mm <number>', 'Length of cut marks in millimetres', '5')
  .parse(process.argv);

const options = program.opts();

function parsePositiveNumber(flag, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return value;
}

async function main() {
  const gridSize = Number(options.gridSize);
  if (!Number.isInteger(gridSize) || gridSize <= 0) {
    throw new Error('--grid-size must be a positive integer');
  }

  const cardWidthMm = parsePositiveNumber('--card-width-mm', options.cardWidthMm);
  const cardHeightMm = parsePositiveNumber('--card-height-mm', options.cardHeightMm);
  const gapMm = parsePositiveNumber('--gap-mm', options.gapMm);
  const cutMarkLengthMm = parsePositiveNumber('--cut-mark-length-mm', options.cutMarkLengthMm);

  const cardWidthPt = mmToPt(cardWidthMm);
  const cardHeightPt = mmToPt(cardHeightMm);
  const gapPt = mmToPt(gapMm);
  const cutMarkLengthPt = mmToPt(cutMarkLengthMm);

  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
  const strokeColor = rgb(0, 0, 0);

  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4_WIDTH_PT,
    height: A4_HEIGHT_PT,
    color: rgb(1, 1, 1),
  });

  const { scaledWidth, scaledHeight, scaledGap, originX, originY } = computeGridLayout({
    cardWidthPt,
    cardHeightPt,
    gapPt,
    gridSize,
    pageWidth: A4_WIDTH_PT,
    pageHeight: A4_HEIGHT_PT,
  });

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const x = originX + col * (scaledWidth + scaledGap);
      const y = originY + (gridSize - row - 1) * (scaledHeight + scaledGap);
      page.drawRectangle({
        x,
        y,
        width: scaledWidth,
        height: scaledHeight,
        borderColor: strokeColor,
        borderWidth: 0.5,
        color: rgb(1, 1, 1),
      });
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
    label: 'Grid Template',
    pageNumber: 1,
    totalPages: 1,
    color: strokeColor,
  });

  const outputPath = path.resolve(options.output);
  const pdfBytes = await pdfDoc.save();
  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
