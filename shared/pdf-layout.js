const MM_TO_PT = 72 / 25.4;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const A4_WIDTH_PT = A4_WIDTH_MM * MM_TO_PT;
const A4_HEIGHT_PT = A4_HEIGHT_MM * MM_TO_PT;
const GAP_BETWEEN_CARDS_MM = 0.5;

function mmToPt(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Measurements must be non-negative numbers');
  }
  return value * MM_TO_PT;
}

function computeScale(cardWidthPt, cardHeightPt, gapPt, gridSize, pageWidth = A4_WIDTH_PT, pageHeight = A4_HEIGHT_PT) {
  const gridWidth = cardWidthPt * gridSize + gapPt * (gridSize - 1);
  const gridHeight = cardHeightPt * gridSize + gapPt * (gridSize - 1);
  const scaleX = pageWidth / gridWidth;
  const scaleY = pageHeight / gridHeight;
  const scale = Math.min(scaleX, scaleY, 1);

  if (scale < 1) {
    console.warn(
      `Grid and padding exceed page dimensions at true card size. Cards for this PDF are scaled by ${(scale * 100).toFixed(
        1
      )}% to keep the grid on page.`
    );
  }

  return scale;
}

function computeGridLayout({ cardWidthPt, cardHeightPt, gapPt, gridSize, pageWidth = A4_WIDTH_PT, pageHeight = A4_HEIGHT_PT }) {
  const scale = computeScale(cardWidthPt, cardHeightPt, gapPt, gridSize, pageWidth, pageHeight);
  const scaledWidth = cardWidthPt * scale;
  const scaledHeight = cardHeightPt * scale;
  const scaledGap = gapPt * scale;
  const gridWidth = scaledWidth * gridSize + scaledGap * (gridSize - 1);
  const gridHeight = scaledHeight * gridSize + scaledGap * (gridSize - 1);
  const originX = (pageWidth - gridWidth) / 2;
  const originY = (pageHeight - gridHeight) / 2;

  return { scale, scaledWidth, scaledHeight, scaledGap, gridWidth, gridHeight, originX, originY };
}

function drawCutMarks(page, { gridSize, originX, originY, cardWidth, cardHeight, cutMarkLength, gap, color }) {
  const edgesX = new Set();
  const edgesY = new Set();
  for (let col = 0; col < gridSize; col++) {
    const start = originX + col * (cardWidth + gap);
    edgesX.add(start);
    edgesX.add(start + cardWidth);
  }
  for (let row = 0; row < gridSize; row++) {
    const start = originY + row * (cardHeight + gap);
    edgesY.add(start);
    edgesY.add(start + cardHeight);
  }

  const top = originY + gridSize * cardHeight + gap * (gridSize - 1);
  const bottom = originY;
  const left = originX;
  const right = originX + gridSize * cardWidth + gap * (gridSize - 1);

  const lineWidth = 0.5;

  for (const x of Array.from(edgesX).sort((a, b) => a - b)) {
    page.drawLine({
      start: { x, y: top },
      end: { x, y: top + cutMarkLength },
      thickness: lineWidth,
      color,
    });
    page.drawLine({
      start: { x, y: bottom },
      end: { x, y: bottom - cutMarkLength },
      thickness: lineWidth,
      color,
    });
  }

  for (const y of Array.from(edgesY).sort((a, b) => a - b)) {
    page.drawLine({
      start: { x: left, y },
      end: { x: left - cutMarkLength, y },
      thickness: lineWidth,
      color,
    });
    page.drawLine({
      start: { x: right, y },
      end: { x: right + cutMarkLength, y },
      thickness: lineWidth,
      color,
    });
  }
}

function drawRulers(page, font, color) {
  const margin = mmToPt(5);
  const shortTick = mmToPt(1.5);
  const longTick = mmToPt(3);
  const fontSize = 6;
  const widthMm = A4_WIDTH_MM;

  drawHorizontalRuler(page, font, {
    baseY: page.getHeight() - margin,
    direction: -1,
    widthMm,
    shortTick,
    longTick,
    fontSize,
    color,
  });

  drawHorizontalRuler(page, font, {
    baseY: margin,
    direction: 1,
    widthMm,
    shortTick,
    longTick,
    fontSize,
    color,
  });
}

function drawHorizontalRuler(page, font, { baseY, direction, widthMm, shortTick, longTick, fontSize, color }) {
  const labelOffset = mmToPt(1);
  page.drawLine({
    start: { x: 0, y: baseY },
    end: { x: page.getWidth(), y: baseY },
    thickness: 0.5,
    color,
  });

  for (let mm = 0; mm <= widthMm; mm += 5) {
    const x = mmToPt(mm);
    const isLong = mm % 10 === 0;
    const length = isLong ? longTick : shortTick;
    page.drawLine({
      start: { x, y: baseY },
      end: { x, y: baseY + length * direction },
      thickness: 0.5,
      color,
    });

    if (isLong) {
      const label = String(mm / 10);
      const labelWidth = font.widthOfTextAtSize(label, fontSize);
      const textX = x - labelWidth / 2;
      const textY = baseY + (length + labelOffset) * direction - (direction < 0 ? fontSize : 0);
      page.drawText(label, {
        x: textX,
        y: textY,
        size: fontSize,
        font,
        color,
      });
    }
  }
}

function drawPageLabel(page, font, { label, pageNumber, totalPages, color }) {
  const text = `${label} — Page ${pageNumber}/${totalPages}`;
  const fontSize = 10;
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const x = (page.getWidth() - textWidth) / 2;
  const y = mmToPt(5);
  page.drawText(text, {
    x,
    y,
    size: fontSize,
    font,
    color,
  });
}

module.exports = {
  MM_TO_PT,
  A4_WIDTH_MM,
  A4_HEIGHT_MM,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  GAP_BETWEEN_CARDS_MM,
  mmToPt,
  computeScale,
  computeGridLayout,
  drawCutMarks,
  drawRulers,
  drawPageLabel,
};
