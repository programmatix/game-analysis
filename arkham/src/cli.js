#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Command } = require('commander');
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
const { readDeckText, parseDeckList, normalizeName, sanitizeFileName, resolveNameAndOutput } = require('../../shared/deck-utils');

const DEFAULT_CACHE_DIR = path.join('.cache', 'arkham-card-art');
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'arkhamdb-json-data');

const program = new Command();
program
  .name('arkham-proxy')
  .description('Create printable Arkham Horror LCG proxy PDFs from a deck list')
  .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
  .option('--data-dir <dir>', 'Path to arkhamdb-json-data root', DEFAULT_DATA_DIR)
  .option('--cache-dir <dir>', 'Cache directory for downloaded art', DEFAULT_CACHE_DIR)
  .option('--grid-size <number>', 'Grid size (NxN)', '3')
  .option('--card-width-mm <number>', 'Card width in millimetres', '63.5')
  .option('--card-height-mm <number>', 'Card height in millimetres', '88.9')
  .option('--cut-mark-length-mm <number>', 'Length of cut marks in millimetres', '5')
  .option('--face <a|b>', 'Card face to render when the code lacks a side', 'a')
  .option('--name <text>', 'Deck name for the PDF filename and footer', 'deck')
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

  const dataDir = path.resolve(options.dataDir);
  const cards = await loadCardDatabase(dataDir);
  const lookup = buildCardLookup(cards);
  const deckCards = resolveDeckCards(deckEntries, lookup);

  const cacheDir = path.resolve(options.cacheDir);
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const gridSize = parseGridSize(options.gridSize);
  const cardWidthPt = mmToPt(parsePositiveNumber('--card-width-mm', options.cardWidthMm));
  const cardHeightPt = mmToPt(parsePositiveNumber('--card-height-mm', options.cardHeightMm));
  const cutMarkLengthPt = mmToPt(parsePositiveNumber('--cut-mark-length-mm', options.cutMarkLengthMm));
  const face = String(options.face || 'a').toLowerCase() === 'b' ? 'b' : 'a';

  const { deckName, outputPath } = resolveNameAndOutput(options.name);
  const pdfBytes = await buildPdf({
    cards: deckCards,
    cacheDir,
    cardWidthPt,
    cardHeightPt,
    cutMarkLengthPt,
    gridSize,
    deckName,
    face,
  });

  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
}

function parseGridSize(raw) {
  const gridSize = Number(raw);
  if (!Number.isInteger(gridSize) || gridSize <= 0) {
    throw new Error('--grid-size must be a positive integer');
  }
  return gridSize;
}

function parsePositiveNumber(flag, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return value;
}

async function loadCardDatabase(dataDir) {
  const packRoot = path.join(dataDir, 'pack');
  const packEntries = await readDirSafe(packRoot);
  const packs = packEntries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  if (!packs.length) {
    throw new Error(`No pack JSON files were found under ${packRoot}`);
  }

  const cards = [];
  for (const pack of packs) {
    const packPath = path.join(packRoot, pack);
    const files = (await readDirSafe(packPath)).filter(entry => entry.isFile()).map(entry => entry.name);
    for (const fileName of files) {
      if (!fileName.endsWith('.json')) continue;
      const filePath = path.join(packPath, fileName);
      const raw = await fs.promises.readFile(filePath, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          cards.push(...parsed);
        }
      } catch (error) {
        console.warn(`Skipping ${filePath}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  return cards;
}

async function readDirSafe(dirPath) {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Unable to read ${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildCardLookup(cards) {
  const lookup = new Map();
  const addKey = (key, card) => {
    const normalized = normalizeName(key);
    if (!normalized) return;
    const existing = lookup.get(normalized);
    if (existing) {
      existing.push(card);
    } else {
      lookup.set(normalized, [card]);
    }
  };

  for (const card of cards) {
    addKey(card.code, card);
    addKey(card.name, card);
    if (card.name && card.subname) {
      addKey(`${card.name}: ${card.subname}`, card);
      addKey(`${card.name} — ${card.subname}`, card);
    }
    if (Number.isFinite(card.xp)) {
      addKey(`${card.name} (${card.xp})`, card);
    }
  }

  return lookup;
}

function resolveDeckCards(entries, lookup) {
  const cards = [];
  for (const entry of entries) {
    const key = normalizeName(entry.name);
    const matches = lookup.get(key);
    if (!matches || !matches.length) {
      throw new Error(`Card "${entry.name}" was not found in arkhamdb-json-data.`);
    }

    const unique = dedupeByCode(matches);
    const candidates = unique.length ? unique : matches;
    if (candidates.length > 1) {
      const codes = candidates
        .map(card => {
          const headerParts = [card.code || '(no code)', card.name || '(no name)'];
          if (Number.isFinite(card.xp)) {
            headerParts.push(`XP ${card.xp}`);
          }
          const header = headerParts.filter(Boolean).join(' — ');
          const text = typeof card.text === 'string' && card.text.trim() ? card.text.trim() : '(no description)';
          return `- ${header}: ${text}`;
        })
        .join('\n');
      throw new Error(
        `Card "${entry.name}" is ambiguous. Specify a code or XP value to disambiguate. Candidates:\n${codes}`
      );
    }

    const card = candidates[0];
    for (let i = 0; i < entry.count; i++) {
      cards.push(card);
    }
  }
  return cards;
}

function dedupeByCode(cards) {
  const seen = new Map();
  for (const card of cards) {
    if (!card || !card.code) continue;
    if (!seen.has(card.code)) {
      seen.set(card.code, card);
    }
  }
  return Array.from(seen.values());
}

async function buildPdf({ cards, cacheDir, cardWidthPt, cardHeightPt, cutMarkLengthPt, gridSize, deckName, face }) {
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
  const backgroundColor = rgb(1, 1, 1);
  const strokeColor = rgb(0, 0, 0);

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

async function ensureCardImage(card, cacheDir, defaultFace) {
  const imageCode = normalizeImageCode(card?.code, defaultFace);
  const identifier = sanitizeFileName(card?.name || imageCode);
  const fileName = `${identifier || 'card'}-${imageCode}.png`;
  const filePath = path.join(cacheDir, fileName);

  if (await fileExists(filePath)) {
    return filePath;
  }

  const url = buildImageUrl(imageCode);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image for "${card?.name || imageCode}": ${response.status} ${response.statusText}`);
  }
  const webpBuffer = Buffer.from(await response.arrayBuffer());
  const pngBuffer = await sharp(webpBuffer).png().toBuffer();
  await fs.promises.writeFile(filePath, pngBuffer);
  return filePath;
}

function normalizeImageCode(code, defaultFace) {
  const trimmed = (code || '').trim();
  if (!trimmed) {
    throw new Error('Card code is missing for an entry.');
  }
  const normalized = trimmed.toLowerCase();
  if (/[a-z]$/.test(normalized)) {
    return normalized;
  }
  const face = defaultFace === 'b' ? 'b' : 'a';
  return `${normalized}${face}`;
}

function buildImageUrl(imageCode) {
  const normalized = imageCode.toLowerCase();
  const prefixMatch = /^(\d{2})/.exec(normalized);
  const prefix = prefixMatch ? prefixMatch[1] : normalized.slice(0, 2);
  return `https://dragncards-ahlcg.s3.amazonaws.com/images/card_images/${prefix}/${normalized}.webp`;
}

async function embedImage(pdfDoc, imagePath, cache) {
  if (cache.has(imagePath)) {
    return cache.get(imagePath);
  }

  const data = await fs.promises.readFile(imagePath);
  const embedded = await pdfDoc.embedPng(data);
  cache.set(imagePath, embedded);
  return embedded;
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
