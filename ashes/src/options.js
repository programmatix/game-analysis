const path = require('path');
const { Command } = require('commander');
const { mmToPt } = require('../../shared/pdf-layout');
const { resolveNameAndOutput } = require('../../shared/deck-utils');
const { DEFAULT_API_BASE_URL } = require('./card-data');
const { DEFAULT_CDN_BASE_URL } = require('./image-utils');

const DEFAULT_CACHE_DIR = path.join('.cache', 'ashes-card-art');

function parseCliOptions() {
  const program = new Command();
  program
    .name('ashes-proxy')
    .description('Create printable Ashes Reborn proxy PDFs from a deck list')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('--data-cache <file>', 'Where to cache Ashes.live cards JSON', path.join('.cache', 'asheslive-cards.json'))
    .option('--refresh-data', 'Re-download the Ashes.live cards JSON into the cache', false)
    .option('--api-base-url <url>', 'Base URL for Ashes.live API', DEFAULT_API_BASE_URL)
    .option('--show-legacy', 'Include legacy cards in the local database cache', false)
    .option('--cache-dir <dir>', 'Cache directory for downloaded card images', DEFAULT_CACHE_DIR)
    .option('--cdn-base-url <url>', 'Base URL for Ashes CDN images', DEFAULT_CDN_BASE_URL)
    .option('--expected-size <number>', 'Warn when the total card count differs (0 disables)', '0')
    .option('--grid-size <number>', 'Grid size (NxN)', '3')
    .option('--card-width-mm <number>', 'Card width in millimetres', '63.5')
    .option('--card-height-mm <number>', 'Card height in millimetres', '88.9')
    .option('--corner-radius-mm <number>', 'Corner radius in millimetres (default: 3.2)', '3.2')
    .option('--cut-mark-length-mm <number>', 'Length of cut marks in millimetres', '5')
    .option('--scale <number>', 'Scale factor for card size (default: 0.97, i.e. 97% for tight sleeves)', '0.97')
    .option('--name <text>', 'Deck name for the PDF filename and footer', 'deck')
    .parse(process.argv);

  const options = program.opts();

  const gridSize = parseGridSize(options.gridSize);
  const cardWidthPt = mmToPt(parsePositiveNumber('--card-width-mm', options.cardWidthMm));
  const cardHeightPt = mmToPt(parsePositiveNumber('--card-height-mm', options.cardHeightMm));
  const cornerRadiusMm = parsePositiveNumber('--corner-radius-mm', options.cornerRadiusMm);
  const cutMarkLengthPt = mmToPt(parsePositiveNumber('--cut-mark-length-mm', options.cutMarkLengthMm));
  const scaleFactor = parseScaleFactor(options.scale);
  const expectedDeckSize = parseExpectedSize(options.expectedSize);
  const { deckName, outputPath } = resolveNameAndOutput(options.name);

  return {
    input: options.input,
    dataCache: path.resolve(options.dataCache),
    refreshData: Boolean(options.refreshData),
    apiBaseUrl: String(options.apiBaseUrl || DEFAULT_API_BASE_URL).trim(),
    showLegacy: Boolean(options.showLegacy),
    cacheDir: path.resolve(options.cacheDir),
    cdnBaseUrl: String(options.cdnBaseUrl || DEFAULT_CDN_BASE_URL).trim(),
    expectedDeckSize,
    gridSize,
    cardWidthPt,
    cardHeightPt,
    cornerRadiusMm,
    cutMarkLengthPt,
    scaleFactor,
    deckName,
    outputPath,
  };
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

function parseExpectedSize(raw) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('--expected-size must be a non-negative integer (0 disables)');
  }
  return parsed === 0 ? null : parsed;
}

function parseScaleFactor(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error('--scale must be a positive number between 0 and 1');
  }
  return value;
}

module.exports = {
  parseCliOptions,
};

