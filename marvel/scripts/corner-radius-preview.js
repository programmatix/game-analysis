#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
} = require('pdf-lib');
const { mmToPt, A4_WIDTH_PT, A4_HEIGHT_PT } = require('../../shared/pdf-layout');
const { applyRoundedRectClip, restoreGraphicsState } = require('../../shared/pdf-drawing');

async function main() {
  const outDir = path.resolve(__dirname, '..', '.cache');
  await fs.promises.mkdir(outDir, { recursive: true });

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
  const cardWidth = mmToPt(63.5 * 0.97);
  const cardHeight = mmToPt(88.9 * 0.97);
  const gap = mmToPt(8);

  const factors = [0.05, 0.04, 0.035, 0.03, 0.025, 0.02];
  const cols = 3;
  const rows = Math.ceil(factors.length / cols);

  const gridWidth = cols * cardWidth + (cols - 1) * gap;
  const gridHeight = rows * cardHeight + (rows - 1) * gap + mmToPt(10);
  const originX = (A4_WIDTH_PT - gridWidth) / 2;
  const originY = (A4_HEIGHT_PT - gridHeight) / 2;

  for (let i = 0; i < factors.length; i += 1) {
    const factor = factors[i];
    const row = Math.floor(i / cols);
    const col = i % cols;

    const x = originX + col * (cardWidth + gap);
    const y = originY + (rows - row - 1) * (cardHeight + gap) + mmToPt(10);

    page.drawRectangle({ x, y, width: cardWidth, height: cardHeight, color: rgb(0, 0, 0) });

    const radius = Math.min(cardWidth, cardHeight) * factor;
    applyRoundedRectClip(
      page,
      {
        pushGraphicsState,
        popGraphicsState,
        moveTo,
        lineTo,
        appendBezierCurve,
        closePath,
        clip,
        endPath,
      },
      { x, y, width: cardWidth, height: cardHeight, radius },
    );
    page.drawRectangle({ x, y, width: cardWidth, height: cardHeight, color: rgb(1, 1, 1) });
    restoreGraphicsState(page, { popGraphicsState });

    const label = `factor ${factor}`;
    page.drawText(label, { x, y: y - mmToPt(6), size: 10, font, color: rgb(0, 0, 0) });
  }

  const bytes = await pdfDoc.save();
  const outPath = path.join(outDir, 'corner-radius-preview.pdf');
  await fs.promises.writeFile(outPath, bytes);
  process.stdout.write(`${outPath}\n`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
