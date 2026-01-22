#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { sanitizeFileName } = require('../../shared/deck-utils');
const { mmToPt } = require('../../shared/pdf-layout');
const { listAdventures, resolveAdventure, listAdventureCards } = require('./archon-arcana');
const { buildPdf } = require('./pdf-builder');

const DEFAULT_CACHE_DIR = path.join('.cache', 'keyforge-adventure-art');

const program = new Command();
program
  .name('keyforge-adventure')
  .description('Generate printable proxy PDFs for KeyForge Adventures (from Archon Arcana).')
  .argument('[adventure]', 'Adventure name, short code, or set number (e.g. "RotK", "AC", "KFA001")')
  .option('--list', 'List known adventures and exit')
  .option('--cards', 'Print the adventure card list and exit')
  .option('-o, --output <file>', 'Output PDF filename')
  .option('--cache-dir <dir>', 'Cache directory for downloaded card images', DEFAULT_CACHE_DIR)
  .option('--refresh', 'Re-download cached card images', false)
  .option('--grid-size <number>', 'Grid size (NxN)', '3')
  .option('--card-width-mm <number>', 'Card width in millimetres', '63.5')
  .option('--card-height-mm <number>', 'Card height in millimetres', '88.9')
  .option('--cut-mark-length-mm <number>', 'Length of cut marks in millimetres', '5')
  .option('--scale <number>', 'Scale factor for card size (default: 0.99 for tight sleeves)', '0.99')
  .parse(process.argv);

const options = program.opts();

async function main() {
  const adventures = await listAdventures();

  if (options.list) {
    printAdventures(adventures);
    return;
  }

  const adventureArg = program.args[0];
  const selection = resolveAdventure(adventures, adventureArg);
  if (!adventureArg || !String(adventureArg).trim()) {
    throw new Error('Missing adventure name. Use --list to see known adventures.');
  }
  if (!selection) {
    throw new Error(`Unknown adventure "${adventureArg}". Use --list to see known adventures.`);
  }
  if (selection?.ambiguous) {
    const matches = selection.matches || [];
    const lines = [`Ambiguous adventure "${adventureArg}" matched ${matches.length} adventures:`];
    for (const match of matches) {
      lines.push(`- ${formatAdventure(match)}`);
    }
    throw new Error(lines.join('\n'));
  }

  const cards = await listAdventureCards(selection);
  if (!cards.length) {
    throw new Error(`No cards found for "${selection.setName}" (${selection.setNumber}).`);
  }

  if (options.cards) {
    printCards(cards);
    return;
  }

  const cacheDir = path.resolve(options.cacheDir);
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const gridSize = Number(options.gridSize);
  if (!Number.isInteger(gridSize) || gridSize <= 0) {
    throw new Error('--grid-size must be a positive integer');
  }

  const cardWidthMm = Number(options.cardWidthMm);
  const cardHeightMm = Number(options.cardHeightMm);
  const cutMarkLengthMm = Number(options.cutMarkLengthMm);
  const scaleFactor = Number(options.scale);

  if (!Number.isFinite(cardWidthMm) || cardWidthMm <= 0) {
    throw new Error('--card-width-mm must be a positive number');
  }
  if (!Number.isFinite(cardHeightMm) || cardHeightMm <= 0) {
    throw new Error('--card-height-mm must be a positive number');
  }
  if (!Number.isFinite(cutMarkLengthMm) || cutMarkLengthMm <= 0) {
    throw new Error('--cut-mark-length-mm must be a positive number');
  }
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0 || scaleFactor > 1) {
    throw new Error('--scale must be a positive number between 0 and 1');
  }

  const outputPath = resolveOutputPath(selection, options.output);

  const pdfBytes = await buildPdf({
    cards,
    cacheDir,
    cardWidthPt: mmToPt(cardWidthMm),
    cardHeightPt: mmToPt(cardHeightMm),
    cutMarkLengthPt: mmToPt(cutMarkLengthMm),
    gridSize,
    scaleFactor,
    label: selection.setName,
    refreshImages: Boolean(options.refresh),
  });

  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
}

function resolveOutputPath(adventure, outputOption) {
  const raw = String(outputOption || '').trim();
  if (raw) {
    const resolved = path.resolve(raw);
    return /\.pdf$/i.test(resolved) ? resolved : `${resolved}.pdf`;
  }

  const base = sanitizeFileName(adventure?.setName || adventure?.shortName || adventure?.setNumber || 'keyforge-adventure');
  const fileName = base ? `${base}.pdf` : 'keyforge-adventure.pdf';
  return path.resolve(fileName);
}

function formatAdventure(adventure) {
  const setName = adventure?.setName || 'Unknown';
  const shortName = adventure?.shortName ? ` (${adventure.shortName})` : '';
  const setNumber = adventure?.setNumber ? ` — ${adventure.setNumber}` : '';
  return `${setName}${shortName}${setNumber}`;
}

function printAdventures(adventures) {
  const items = Array.isArray(adventures) ? adventures : [];
  if (!items.length) {
    console.log('No KeyForge Adventures found.');
    return;
  }

  console.log('KeyForge Adventures (Archon Arcana):');
  for (const adventure of items) {
    console.log(`- ${formatAdventure(adventure)}`);
  }
}

function printCards(cards) {
  for (const card of Array.isArray(cards) ? cards : []) {
    console.log(card.name);
  }
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});

