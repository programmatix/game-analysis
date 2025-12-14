#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Command } = require('commander');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const {
  MM_TO_PT,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  GAP_BETWEEN_CARDS_MM,
  mmToPt,
  computeGridLayout,
  drawCutMarks,
  drawRulers,
  drawPageLabel,
} = require('../../shared/pdf-layout');
const { readDeckText, parseDeckList, normalizeName, sanitizeFileName, resolveNameAndOutput } = require('../../shared/deck-utils');
const DEFAULT_CACHE_DIR = path.join('.cache', 'card-art');
const ASSET_CACHE_DIR = path.join('.cache', 'assets');
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
  .option('--name <text>', 'Deck name for the PDF filename and title page', 'deck')
  .option('--author <text>', 'Deck author shown on the title card')
  .option('--archetype <text>', 'Deck archetype shown on the title card')
  .option('--date <text>', 'Date or event label shown on the title card')
  .option('--showcase-output <file>', 'Write the showcase title card PNG to this path')
  .option('--showcase-only', 'Only render the showcase title card and skip the PDF grid')
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

  const { deckName, outputPath } = resolveNameAndOutput(options.name);
  const deckMeta = {
    name: deckName,
    author: normalizeMetadata(options.author),
    archetype: normalizeMetadata(options.archetype),
    date: normalizeMetadata(options.date),
  };
  const showcaseOutputPath = options.showcaseOutput ? path.resolve(options.showcaseOutput) : null;
  const showcaseOnly = Boolean(options.showcaseOnly);
  if (showcaseOnly && !showcaseOutputPath) {
    throw new Error('--showcase-only requires --showcase-output to specify a PNG destination.');
  }

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

  const rarestCard = pickRarestCard(deckCards);
  let showcaseEntry = null;
  if (rarestCard) {
    showcaseEntry = await createShowcaseCardEntry({
      card: rarestCard,
      cardWidthPt,
      cardHeightPt,
      cacheDir,
      metadata: deckMeta,
    });
    if (showcaseOutputPath) {
      await fs.promises.mkdir(path.dirname(showcaseOutputPath), { recursive: true });
      await fs.promises.writeFile(showcaseOutputPath, showcaseEntry.buffer);
      console.log(`Saved showcase card to ${showcaseOutputPath}`);
    }
  }

  if (showcaseOnly) {
    if (!showcaseEntry) {
      throw new Error('Unable to create showcase card for this deck.');
    }
    console.log('Showcase-only mode enabled; skipping PDF generation.');
    return;
  }

  const pdfBytes = await buildPdf({
    cards: deckCards,
    cardWidthPt,
    cardHeightPt,
    cutMarkLengthPt,
    gridSize,
    cacheDir,
    deckMeta,
    showcaseEntry,
  });

  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
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
    if (card.fullName) keys.add(normalizeName(card.fullName));
    if (card.name) keys.add(normalizeName(card.name));
    if (card.simpleName) keys.add(normalizeName(card.simpleName));

    for (const key of keys) {
      if (!key) continue;
      lookup.set(key, card);
    }
  }
  return lookup;
}

function resolveDeckCards(entries, lookup) {
  const cards = [];
  for (const entry of entries) {
    const key = normalizeName(entry.name);
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

async function buildPdf({ cards, cardWidthPt, cardHeightPt, cutMarkLengthPt, gridSize, cacheDir, deckMeta, showcaseEntry }) {
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

  const metadata = {
    name: normalizeMetadata(deckMeta?.name) || 'deck',
    author: normalizeMetadata(deckMeta?.author),
    archetype: normalizeMetadata(deckMeta?.archetype),
    date: normalizeMetadata(deckMeta?.date),
  };

  const workingCards = showcaseEntry ? [showcaseEntry, ...cards] : [...cards];

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

    const { scaledWidth, scaledHeight, scaledGap, originX, originY } = computeGridLayout({
      cardWidthPt,
      cardHeightPt,
      gapPt,
      gridSize,
      pageWidth: A4_WIDTH_PT,
      pageHeight: A4_HEIGHT_PT,
    });

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
        const imagePath = await ensureImage(entry, cacheDir, sanitizeFileName);
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
      label: metadata.name,
      pageNumber,
      totalPages,
      color: strokeColor,
    });
  }

  return pdfDoc.save();
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

async function createShowcaseCardEntry({ card, cardWidthPt, cardHeightPt, cacheDir, metadata }) {
  const cardImagePath = await ensureImage(card, cacheDir, sanitizeFileName);
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

  const labelHeight = Math.round(canvasHeight * 0.34);
  const labelY = canvasHeight - labelHeight - Math.round(canvasHeight * 0.035);
  const labelWidth = Math.round(canvasWidth * 0.9);
  const labelX = Math.round((canvasWidth - labelWidth) / 2);
  const labelPadding = Math.round(labelHeight * 0.2);
  const labelContentWidth = Math.max(50, labelWidth - labelPadding * 2);
  const textTop = labelY + labelPadding;
  const textBottom = labelY + labelHeight - labelPadding;
  const maxTextHeight = Math.max(30, textBottom - textTop);
  const normalizedMeta = {
    name: normalizeMetadata(metadata?.name) || 'deck',
    author: normalizeMetadata(metadata?.author),
    archetype: normalizeMetadata(metadata?.archetype),
    date: normalizeMetadata(metadata?.date),
  };

  const lines = [];
  const baseNameSize = Math.max(24, Math.round(labelHeight * 0.34));
  const nameMin = Math.max(17, Math.round(baseNameSize * 0.58));
  let nameLines = wrapText(normalizedMeta.name, labelContentWidth, baseNameSize, {
    charWidthFactor: 0.65,
    maxLines: 2,
  });
  if (!nameLines.length || nameLines.every(line => !line.trim())) {
    nameLines = ['deck'];
  }
  for (const nameLine of nameLines) {
    const nameFit = fitFontSizeToWidth(nameLine, baseNameSize, labelContentWidth, {
      minSize: nameMin,
      charWidthFactor: 0.62,
    });
    lines.push({
      text: nameLine,
      fontFamily: "Cinzel, 'Trebuchet MS', sans-serif",
      fontWeight: '600',
      color: '#FDE9A7',
      minSize: nameMin,
      size: nameFit.size,
      charWidthFactor: 0.62,
      forceWidth: nameFit.overflow,
    });
  }

  if (normalizedMeta.author) {
    const authorText = `by ${normalizedMeta.author}`;
    const baseAuthorSize = Math.max(15, Math.round(labelHeight * 0.18));
    const authorMin = Math.max(11, Math.round(baseAuthorSize * 0.62));
    const authorFit = fitFontSizeToWidth(authorText, baseAuthorSize, labelContentWidth, {
      minSize: authorMin,
      charWidthFactor: 0.52,
    });
    lines.push({
      text: authorText,
      fontFamily: "'Trebuchet MS', 'Gill Sans', sans-serif",
      color: 'rgba(255,255,255,0.9)',
      minSize: authorMin,
      size: authorFit.size,
      charWidthFactor: 0.52,
      forceWidth: authorFit.overflow,
    });
  }

  const archetypeText = normalizedMeta.archetype ? normalizedMeta.archetype.toUpperCase() : '';
  if (archetypeText) {
    const baseArchetypeSize = Math.max(13, Math.round(labelHeight * 0.17));
    const archetypeMin = Math.max(10, Math.round(baseArchetypeSize * 0.65));
    const archetypeFit = fitFontSizeToWidth(archetypeText, baseArchetypeSize, labelContentWidth, {
      minSize: archetypeMin,
      charWidthFactor: 0.65,
    });
    lines.push({
      text: archetypeText,
      fontFamily: "'Trebuchet MS', 'Gill Sans', sans-serif",
      color: 'rgba(253,233,167,0.92)',
      letterSpacing: Math.max(0.4, Math.round(archetypeFit.size * 0.12)),
      minSize: archetypeMin,
      size: archetypeFit.size,
      charWidthFactor: 0.65,
      forceWidth: archetypeFit.overflow,
    });
  }

  if (normalizedMeta.date) {
    const dateText = normalizedMeta.date;
    const baseDateSize = Math.max(11, Math.round(labelHeight * 0.15));
    const dateMin = Math.max(9, Math.round(baseDateSize * 0.72));
    const dateFit = fitFontSizeToWidth(dateText, baseDateSize, labelContentWidth, {
      minSize: dateMin,
      charWidthFactor: 0.55,
    });
    lines.push({
      text: dateText,
      fontFamily: "'Trebuchet MS', 'Gill Sans', sans-serif",
      color: 'rgba(255,255,255,0.8)',
      minSize: dateMin,
      size: dateFit.size,
      charWidthFactor: 0.55,
      forceWidth: dateFit.overflow,
    });
  }

  fitLinesToHeight(lines, maxTextHeight);
  updateLineWidthFlags(lines, labelContentWidth);
  const spacingScale = calculateSpacingScale(lines, maxTextHeight);

  let textY = textTop;
  const textElements = lines
    .map((line, index) => {
      const anchorX = labelX + labelWidth / 2;
      const widthAttrs = line.forceWidth
        ? ` textLength="${labelContentWidth}" lengthAdjust="spacingAndGlyphs"`
        : '';
      const element = `<text x="${anchorX}" y="${textY}" font-family="${line.fontFamily}"
             font-size="${line.size}" fill="${line.color}" ${line.fontWeight ? `font-weight="${line.fontWeight}"` : ''}
             ${line.letterSpacing ? `letter-spacing="${line.letterSpacing}"` : ''} dominant-baseline="text-before-edge"
             text-anchor="middle"${widthAttrs}>${escapeXml(line.text)}</text>`;
      textY += line.size;
      if (index !== lines.length - 1) {
        textY += Math.max(5, Math.round(line.size * 0.45 * spacingScale));
      }
      return element;
    })
    .join('\n');

  const labelSvg = Buffer.from(
    `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="deckInfoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="rgba(17,19,36,0.85)"/>
          <stop offset="100%" stop-color="rgba(5,5,12,0.95)"/>
        </linearGradient>
        <filter id="deckInfoShadow" x="-10%" y="-10%" width="120%" height="140%">
          <feDropShadow dx="0" dy="10" stdDeviation="15" flood-color="rgba(0,0,0,0.6)" />
        </filter>
      </defs>
      <g filter="url(#deckInfoShadow)">
        <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}"
              rx="${Math.round(labelHeight * 0.22)}" fill="url(#deckInfoGradient)" stroke="rgba(255,255,255,0.15)"
              stroke-width="${Math.max(1, Math.round(labelHeight * 0.015))}"/>
      </g>
      ${textElements}
    </svg>`
  );
  composites.push({
    input: labelSvg,
    top: 0,
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


function fitFontSizeToWidth(
  text,
  baseSize,
  maxWidth,
  { minSize = Math.max(10, Math.round(baseSize * 0.6)), charWidthFactor = 0.6 } = {}
) {
  const content = (text || '').trim();
  const safeBase = Math.max(minSize, Math.round(baseSize));
  if (!content) {
    return { size: safeBase, approxWidth: 0, overflow: false };
  }
  const factor = charWidthFactor > 0 ? charWidthFactor : 0.6;
  let workingSize = safeBase;
  let approxWidth = approximateTextWidth(content, workingSize, factor);
  if (approxWidth <= maxWidth) {
    return { size: workingSize, approxWidth, overflow: false };
  }

  const maxChars = content.length || 1;
  workingSize = Math.floor(maxWidth / (maxChars * factor));
  workingSize = Math.max(minSize, Math.min(safeBase, workingSize));
  approxWidth = approximateTextWidth(content, workingSize, factor);
  const overflow = approxWidth > maxWidth;
  return { size: workingSize, approxWidth, overflow };
}

function computeTotalLineHeight(lines, spacingScale = 1) {
  if (!Array.isArray(lines) || !lines.length) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    total += lines[i].size;
    if (i !== lines.length - 1) {
      total += Math.max(5, Math.round(lines[i].size * 0.45 * spacingScale));
    }
  }
  return total;
}

function fitLinesToHeight(lines, maxHeight) {
  if (!Array.isArray(lines) || !lines.length) {
    return;
  }
  let total = computeTotalLineHeight(lines);
  let attempts = 0;
  while (total > maxHeight && attempts < 200) {
    let adjusted = false;
    for (const line of lines) {
      const minSize = line.minSize ?? Math.max(10, Math.round(line.size * 0.6));
      if (line.size > minSize) {
        line.size -= 1;
        adjusted = true;
      }
    }
    if (!adjusted) {
      break;
    }
    total = computeTotalLineHeight(lines);
    attempts++;
  }
}

function updateLineWidthFlags(lines, maxWidth) {
  if (!Array.isArray(lines)) {
    return;
  }
  for (const line of lines) {
    const factor = line.charWidthFactor ?? 0.6;
    line.approxWidth = approximateTextWidth(line.text, line.size, factor);
    line.forceWidth = line.approxWidth > maxWidth;
  }
}

function approximateTextWidth(text, fontSize, charWidthFactor = 0.6) {
  const safeText = (text || '').trim();
  if (!safeText) {
    return 0;
  }
  const factor = charWidthFactor > 0 ? charWidthFactor : 0.6;
  return safeText.length * fontSize * factor;
}

function wrapText(text, maxWidth, fontSize, { charWidthFactor = 0.6, maxLines = 2 } = {}) {
  const content = normalizeMetadata(text);
  if (!content) {
    return [''];
  }
  const words = content.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [''];
  }
  const lines = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    const lastLineSlot = lines.length === Math.max(1, maxLines) - 1;
    if (!current || approximateTextWidth(candidate, fontSize, charWidthFactor) <= maxWidth || lastLineSlot) {
      current = candidate;
      if (lastLineSlot && i < words.length - 1) {
        current = `${current} ${words.slice(i + 1).join(' ')}`.trim();
        break;
      }
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.slice(0, Math.max(1, maxLines));
}

function calculateSpacingScale(lines, maxHeight) {
  if (!Array.isArray(lines) || lines.length <= 1) {
    return 1;
  }
  const sizeSum = lines.reduce((sum, line) => sum + line.size, 0);
  const baseSpacing = computeTotalLineHeight(lines, 1) - sizeSum;
  if (baseSpacing <= 0) {
    return 1;
  }
  const availableSpacing = maxHeight - sizeSum;
  if (availableSpacing >= baseSpacing) {
    return 1;
  }
  if (availableSpacing <= 0) {
    return 0;
  }
  return Math.max(0, availableSpacing / baseSpacing);
}

function normalizeMetadata(value) {
  return typeof value === 'string' ? value.trim() : '';
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
