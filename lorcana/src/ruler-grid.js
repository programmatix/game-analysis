#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { A4_WIDTH_MM, A4_HEIGHT_MM, A4_WIDTH_PT, A4_HEIGHT_PT, mmToPt } = require('./pdf-layout');

const program = new Command();
program
  .name('lorcana-ruler-grid')
  .description('Generate a full-page black-on-white ruler grid for duplex alignment testing')
  .option('--output <file>', 'Output PDF path', 'ruler-grid.pdf')
  .option('--major-cm <number>', 'Spacing of major grid lines (cm)', '1')
  .option('--minor-mm <number>', 'Spacing of minor tick marks (mm)', '1')
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
  const majorCm = parsePositiveNumber('--major-cm', options.majorCm);
  const minorMm = parsePositiveNumber('--minor-mm', options.minorMm);

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

  drawGrid(page, { majorCm, strokeColor });
  drawTicks(page, { minorMm, majorCm, strokeColor, font: fonts.regular });

  page.drawText('Ruler Grid — 1mm ticks, 1cm grid', {
    x: mmToPt(5),
    y: mmToPt(5),
    size: 8,
    font: fonts.bold,
    color: strokeColor,
  });

  const outputPath = path.resolve(options.output);
  const pdfBytes = await pdfDoc.save();
  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
}

function drawGrid(page, { majorCm, strokeColor }) {
  const majorMm = majorCm * 10;
  const thickness = 0.5;

  for (let mm = 0; mm <= A4_WIDTH_MM; mm += majorMm) {
    const x = mmToPt(mm);
    page.drawLine({
      start: { x, y: 0 },
      end: { x, y: A4_HEIGHT_PT },
      thickness,
      color: strokeColor,
    });
  }

  for (let mm = 0; mm <= A4_HEIGHT_MM; mm += majorMm) {
    const y = mmToPt(mm);
    page.drawLine({
      start: { x: 0, y },
      end: { x: A4_WIDTH_PT, y },
      thickness,
      color: strokeColor,
    });
  }
}

function drawTicks(page, { minorMm, majorCm, strokeColor, font }) {
  const minorLength = mmToPt(1.5);
  const majorLength = mmToPt(3);
  const labelOffset = mmToPt(2);
  const labelSize = 6;
  const majorMm = majorCm * 10;

  for (let mm = 0; mm <= A4_WIDTH_MM; mm += minorMm) {
    const isMajor = mm % majorMm === 0;
    const x = mmToPt(mm);
    const length = isMajor ? majorLength : minorLength;

    // Top and bottom ticks
    page.drawLine({ start: { x, y: 0 }, end: { x, y: length }, thickness: 0.5, color: strokeColor });
    page.drawLine({
      start: { x, y: A4_HEIGHT_PT },
      end: { x, y: A4_HEIGHT_PT - length },
      thickness: 0.5,
      color: strokeColor,
    });

    if (isMajor && mm !== 0) {
      const label = String(mm / 10);
      const textWidth = font.widthOfTextAtSize(label, labelSize);
      page.drawText(label, {
        x: x - textWidth / 2,
        y: A4_HEIGHT_PT - length - labelOffset,
        size: labelSize,
        font,
        color: strokeColor,
      });
      page.drawText(label, {
        x: x - textWidth / 2,
        y: length + labelOffset,
        size: labelSize,
        font,
        color: strokeColor,
      });
    }
  }

  for (let mm = 0; mm <= A4_HEIGHT_MM; mm += minorMm) {
    const isMajor = mm % majorMm === 0;
    const y = mmToPt(mm);
    const length = isMajor ? majorLength : minorLength;

    // Left and right ticks
    page.drawLine({ start: { x: 0, y }, end: { x: length, y }, thickness: 0.5, color: strokeColor });
    page.drawLine({
      start: { x: A4_WIDTH_PT, y },
      end: { x: A4_WIDTH_PT - length, y },
      thickness: 0.5,
      color: strokeColor,
    });

    if (isMajor && mm !== 0) {
      const label = String(mm / 10);
      const textHeight = labelSize;
      page.drawText(label, {
        x: length + labelOffset,
        y: y - textHeight / 2,
        size: labelSize,
        font,
        color: strokeColor,
      });
      page.drawText(label, {
        x: A4_WIDTH_PT - length - labelOffset - font.widthOfTextAtSize(label, labelSize),
        y: y - textHeight / 2,
        size: labelSize,
        font,
        color: strokeColor,
      });
    }
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
