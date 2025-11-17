#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Command } = require('commander');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const MM_TO_PT = 72 / 25.4;
const A4_WIDTH_PT = 210 * MM_TO_PT;
const A4_HEIGHT_PT = 297 * MM_TO_PT;
const DEFAULT_CACHE_DIR = path.join('.cache', 'card-art');
const ASSET_CACHE_DIR = path.join('.cache', 'assets');
const GAP_BETWEEN_CARDS_MM = 1;
const ARTWORK_CROP = { x: 0.07, y: 0.0, width: 0.86, height: 0.50 };
const RARITY_PRIORITY = ['enchanted', 'legendary', 'super rare', 'rare', 'uncommon', 'common'];
const LOGO_URL = 'https://ravensburger.cloud/cms/gallery/lorcana-web/products/s10/logos/dlc_s10_logos_en.png';
const LOCAL_LOGO_FILE = path.join(process.cwd(), 'Disney Lorcana_TCG_Logo transparent.avif');
const LOGO_CACHE_FILE = LOCAL_LOGO_FILE;
const SHOWCASE_CARD_WIDTH_PX = 900;

const program = new Command();
program
  .name('lorcana-proxy')
  .description('Create printable PDF proxies from a deck list')
  .option('-a, --allcards <file>', 'Path to allCards.json', 'allCards.json')
  .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
  .option('--cache-dir <dir>', 'Cache directory for downloaded art', DEFAULT_CACHE_DIR)
  .option('--grid-size <number>', 'Grid size (NxN)', '3')
  .option('--card-width-mm <number>', 'Card width in millimetres', '63.5')
  .option('--card-height-mm <number>', 'Card height in millimetres', '88.9')
  .option('--cut-mark-length-mm <number>', 'Length of cut marks in millimetres', '5')
  .option('--label <text>', 'Label to print on each page (also used for the PDF filename)', 'deck')
  .parse(process.argv);

const options = program.opts();

async function main() {
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckEntries = parseDeckList(deckText);
  if (!deckEntries.length) {
    throw new Error('No valid deck entries were found.');
  }

  const cardDatabase = await loadCardDatabase(options.allcards);
  const deckCards = resolveDeckCards(deckEntries, cardDatabase);

  const cacheDir = path.resolve(options.cacheDir);
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const gridSize = Number(options.gridSize);
  if (!Number.isInteger(gridSize) || gridSize <= 0) {
    throw new Error('--grid-size must be a positive integer');
  }

  const { pageLabel, outputPath } = resolveLabelAndOutput(options.label);

  const cardWidthMm = Number(options.cardWidthMm);
  const cardHeightMm = Number(options.cardHeightMm);
  const cutMarkLengthMm = Number(options.cutMarkLengthMm);

  if (!Number.isFinite(cardWidthMm) || cardWidthMm <= 0) {
    throw new Error('--card-width-mm must be a positive number');
  }
  if (!Number.isFinite(cardHeightMm) || cardHeightMm <= 0) {
    throw new Error('--card-height-mm must be a positive number');
  }
  if (!Number.isFinite(cutMarkLengthMm) || cutMarkLengthMm <= 0) {
    throw new Error('--cut-mark-length-mm must be a positive number');
  }

  const cardWidthPt = mmToPt(cardWidthMm);
  const cardHeightPt = mmToPt(cardHeightMm);
  const cutMarkLengthPt = mmToPt(cutMarkLengthMm);

  const pdfBytes = await buildPdf({
    cards: deckCards,
    cardWidthPt,
    cardHeightPt,
    cutMarkLengthPt,
    gridSize,
    cacheDir,
    label: pageLabel,
  });

  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
}

function mmToPt(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Measurements must be non-negative numbers');
  }
  return value * MM_TO_PT;
}

async function readDeckText(filePath) {
  if (filePath) {
    return fs.promises.readFile(path.resolve(filePath), 'utf8');
  }

  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);

    if (process.stdin.isTTY) {
      resolve('');
    }
  });
}

function parseDeckList(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue;
    }

    const match = /^(\d+)\s+(.+)$/.exec(trimmed);
    if (!match) {
      console.warn(`Skipping line "${line}" - expected format "<count> <card name>"`);
      continue;
    }

    const [, countStr, name] = match;
    const count = Number(countStr);
    if (!Number.isFinite(count) || count <= 0) {
      console.warn(`Skipping line "${line}" - count must be positive`);
      continue;
    }

    entries.push({ count, name: name.trim() });
  }

  return entries;
}

async function loadCardDatabase(allCardsPath) {
  const raw = await fs.promises.readFile(path.resolve(allCardsPath), 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.cards)) {
    throw new Error('allCards.json does not contain a "cards" array.');
  }

  const lookup = new Map();
  for (const card of parsed.cards) {
    const keys = new Set();
    if (card.fullName) keys.add(normalize(card.fullName));
    if (card.name) keys.add(normalize(card.name));
    if (card.simpleName) keys.add(normalize(card.simpleName));

    for (const key of keys) {
      if (!key) continue;
      lookup.set(key, card);
    }
  }
  return lookup;
}

function normalize(text) {
  return text ? text.toLowerCase().replace(/\s+/g, ' ').trim() : '';
}

function resolveDeckCards(entries, lookup) {
  const cards = [];
  for (const entry of entries) {
    const key = normalize(entry.name);
    const card = lookup.get(key);
    if (!card) {
      throw new Error(`Card "${entry.name}" was not found in allCards.json`);
    }

    for (let i = 0; i < entry.count; i++) {
      cards.push(card);
    }
  }
  return cards;
}

function pickRarestCard(cards) {
  let selected = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const card of cards) {
    const rank = rarityRank(card?.rarity);
    if (rank < bestRank) {
      bestRank = rank;
      selected = card;
    }
  }

  return selected;
}

function rarityRank(rarity) {
  const normalized = (rarity || '').toLowerCase();
  const idx = RARITY_PRIORITY.indexOf(normalized);
  return idx === -1 ? RARITY_PRIORITY.length : idx;
}

async function buildPdf({ cards, cardWidthPt, cardHeightPt, cutMarkLengthPt, gridSize, cacheDir, label }) {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const backgroundColor = rgb(0, 0, 0);
  const strokeColor = rgb(1, 1, 1);

  const cardsPerPage = gridSize * gridSize;
  const sanitize = text =>
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '');
  const gapPt = mmToPt(GAP_BETWEEN_CARDS_MM);
  const imageCache = new Map();

  let workingCards = [...cards];
  const rarestCard = pickRarestCard(cards);
  let showcaseEntry = null;
  if (rarestCard) {
    showcaseEntry = await createShowcaseCardEntry({
      card: rarestCard,
      cardWidthPt,
      cardHeightPt,
      cacheDir,
      sanitize,
      label,
    });
    workingCards = [showcaseEntry, ...workingCards];
  }

  if (showcaseEntry) {
    showcaseEntry.embedded = await pdfDoc.embedPng(showcaseEntry.buffer);
  }

  const gridPageCount = Math.ceil(workingCards.length / cardsPerPage) || 1;
  const totalPages = gridPageCount;

  for (let pageIndex = 0; pageIndex < gridPageCount; pageIndex++) {
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: A4_WIDTH_PT,
      height: A4_HEIGHT_PT,
      color: backgroundColor,
    });

    const scale = computeScale(cardWidthPt, cardHeightPt, gapPt, gridSize, A4_WIDTH_PT, A4_HEIGHT_PT);
    const scaledWidth = cardWidthPt * scale;
    const scaledHeight = cardHeightPt * scale;
    const scaledGap = gapPt * scale;
    const gridWidth = scaledWidth * gridSize + scaledGap * (gridSize - 1);
    const gridHeight = scaledHeight * gridSize + scaledGap * (gridSize - 1);
    const originX = (A4_WIDTH_PT - gridWidth) / 2;
    const originY = (A4_HEIGHT_PT - gridHeight) / 2;

    const pageStart = pageIndex * cardsPerPage;
    const pageEnd = Math.min(pageStart + cardsPerPage, workingCards.length);
    for (let i = pageStart; i < pageEnd; i++) {
      const slotIndex = i - pageStart;
      const row = Math.floor(slotIndex / gridSize);
      const col = slotIndex % gridSize;

      const x = originX + col * (scaledWidth + scaledGap);
      const y = originY + (gridSize - row - 1) * (scaledHeight + scaledGap);
      const entry = workingCards[i];

      if (entry?.__showcase) {
        drawShowcaseCardSlot({
          page,
          showcaseEntry: entry,
          x,
          y,
          width: scaledWidth,
          height: scaledHeight,
        });
      } else {
        const imagePath = await ensureImage(entry, cacheDir, sanitize);
        const embedded = await embedImage(pdfDoc, imagePath, imageCache);
        page.drawImage(embedded, {
          x,
          y,
          width: scaledWidth,
          height: scaledHeight,
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
    const pageNumber = pageIndex + 1;
    drawPageLabel(page, fonts.bold, {
      label,
      pageNumber,
      totalPages,
      color: strokeColor,
    });
  }

  return pdfDoc.save();
}

function computeScale(cardWidthPt, cardHeightPt, gapPt, gridSize, pageWidth, pageHeight) {
  const gridWidth = cardWidthPt * gridSize + gapPt * (gridSize - 1);
  const gridHeight = cardHeightPt * gridSize + gapPt * (gridSize - 1);
  const scaleX = pageWidth / gridWidth;
  const scaleY = pageHeight / gridHeight;
  const scale = Math.min(scaleX, scaleY, 1);

  if (scale < 1) {
    console.warn(
      `Grid and padding exceed A4 dimensions at true card size. Cards for this PDF are scaled by ${(scale * 100).toFixed(
        1
      )}% to keep the grid on page.`
    );
  }

  return scale;
}

async function ensureImage(card, cacheDir, sanitizeFn) {
  const url = card?.images?.full;
  if (!url) {
    throw new Error(`Card "${card.fullName}" does not provide a 'full' image URL.`);
  }

  const extension = path.extname(new URL(url).pathname) || '.jpg';
  const identifier = sanitizeFn(card.fullName || card.name || `${card.id}`);
  const fileName = `${identifier || card.id}${card.id ? `-${card.id}` : ''}${extension}`;
  const filePath = path.join(cacheDir, fileName);

  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return filePath;
  } catch (_) {
    // no-op
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image for "${card.fullName}": ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.promises.writeFile(filePath, Buffer.from(arrayBuffer));
  return filePath;
}

async function embedImage(pdfDoc, imagePath, cache) {
  if (cache.has(imagePath)) {
    return cache.get(imagePath);
  }

  const data = await fs.promises.readFile(imagePath);
  const lower = imagePath.toLowerCase();
  const embedded = lower.endsWith('.png') ? await pdfDoc.embedPng(data) : await pdfDoc.embedJpg(data);
  cache.set(imagePath, embedded);
  return embedded;
}

async function createShowcaseCardEntry({ card, cardWidthPt, cardHeightPt, cacheDir, sanitize, label }) {
  const cardImagePath = await ensureImage(card, cacheDir, sanitize);
  const { buffer: artBuffer } = await cropArtwork(cardImagePath);

  const ratio = cardHeightPt / cardWidthPt;
  const canvasWidth = SHOWCASE_CARD_WIDTH_PX;
  const canvasHeight = Math.round(canvasWidth * ratio);

  const resizedArt = await sharp(artBuffer)
    .resize(canvasWidth, canvasHeight, { fit: 'cover' })
    .toBuffer();

  const composites = [];

  const logoPath = await ensureLogoImage();
  const logoBuffer = await sharp(logoPath)
    .resize(Math.round(canvasWidth * 0.4))
    .png()
    .toBuffer();
  composites.push({
    input: logoBuffer,
    top: Math.round(canvasHeight * 0.035),
    left: Math.round(canvasWidth * 0.055),
  });

  const labelHeight = Math.round(canvasHeight * 0.16);
  const labelY = canvasHeight - labelHeight - Math.round(canvasHeight * 0.045);
  const labelWidth = Math.round(canvasWidth * 0.9);
  const labelX = Math.round((canvasWidth - labelWidth) / 2);
  const labelSvg = Buffer.from(
    `<svg width="${canvasWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${labelX}" width="${labelWidth}" height="${labelHeight}" rx="${Math.round(
        labelHeight * 0.2
      )}" fill="rgba(0,0,0,0.78)"/>
      <text x="${canvasWidth / 2}" y="55%" font-family="Cinzel, 'Trebuchet MS', sans-serif"
            font-size="${labelHeight * 0.5}" fill="#FDE9A7" text-anchor="middle"
            textLength="${Math.round(labelWidth * 0.9)}" lengthAdjust="spacingAndGlyphs"
            dominant-baseline="middle">${escapeXml(label || 'deck')}</text>
    </svg>`
  );
  composites.push({
    input: labelSvg,
    top: labelY,
    left: 0,
  });

  const finalBuffer = await sharp(resizedArt).composite(composites).png().toBuffer();

  return {
    __showcase: true,
    buffer: finalBuffer,
    widthPx: canvasWidth,
    heightPx: canvasHeight,
  };
}

function drawShowcaseCardSlot({ page, showcaseEntry, x, y, width, height }) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(0, 0, 0),
  });

  page.drawImage(showcaseEntry.embedded, {
    x,
    y,
    width,
    height,
  });
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
  const widthMm = 210;

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

function resolveLabelAndOutput(labelOption) {
  const rawInput = labelOption && labelOption.trim() ? labelOption.trim() : 'deck';
  const hasPdfExtension = /\.pdf$/i.test(rawInput);
  const outputPath = path.resolve(hasPdfExtension ? rawInput : `${rawInput}.pdf`);
  const labelBase = path.basename(rawInput).replace(/\.pdf$/i, '');
  return {
    pageLabel: labelBase || 'deck',
    outputPath,
  };
}

async function cropArtwork(imagePath) {
  const metadata = await sharp(imagePath).metadata();
  const { width, height } = metadata;
  if (!width || !height) {
    throw new Error(`Unable to read dimensions for ${imagePath}`);
  }

  const crop = {
    left: Math.max(0, Math.round(width * ARTWORK_CROP.x)),
    top: Math.max(0, Math.round(height * ARTWORK_CROP.y)),
    width: Math.max(1, Math.round(width * ARTWORK_CROP.width)),
    height: Math.max(1, Math.round(height * ARTWORK_CROP.height)),
  };

  const buffer = await sharp(imagePath).extract(crop).jpeg().toBuffer();
  return { buffer, width: crop.width, height: crop.height };
}

async function ensureLogoImage() {
  await fs.promises.mkdir(ASSET_CACHE_DIR, { recursive: true });
  try {
    await fs.promises.access(LOGO_CACHE_FILE, fs.constants.F_OK);
    return LOGO_CACHE_FILE;
  } catch (_) {
    // continue to generate
  }

  if (await fileExists(LOCAL_LOGO_FILE)) {
    await sharp(LOCAL_LOGO_FILE).png().toFile(LOGO_CACHE_FILE);
    return LOGO_CACHE_FILE;
  }

  const response = await fetch(LOGO_URL);
  if (!response.ok) {
    throw new Error(`Failed to download Lorcana logo: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.promises.writeFile(LOGO_CACHE_FILE, Buffer.from(arrayBuffer));
  return LOGO_CACHE_FILE;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
