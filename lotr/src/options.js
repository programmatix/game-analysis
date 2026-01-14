const path = require('path');
const { Command } = require('commander');
const { mmToPt } = require('../../shared/pdf-layout');
const { resolveNameAndOutput } = require('../../shared/deck-utils');
const { DEFAULT_BASE_URL } = require('./card-data');

const DEFAULT_CACHE_DIR = path.join(__dirname, '..', '.cache', 'lotr-card-art');
const DEFAULT_DATA_CACHE = path.join(__dirname, '..', '.cache', 'ringsdb-cards.json');

function parseCliOptions() {
  const program = new Command();
  program
    .name('lotr-proxy')
    .description('Create printable The Lord of the Rings: The Card Game proxy PDFs from a deck list')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('--base-url <url>', 'RingsDB base URL', DEFAULT_BASE_URL)
    .option('--data-cache <file>', 'Where to cache RingsDB cards JSON', DEFAULT_DATA_CACHE)
    .option('--refresh-data', 'Re-download the RingsDB cards JSON into the cache', false)
    .option('--fallback-image-base-url <url>', 'Optional base URL to use as an image host fallback')
    .option('--cache-dir <dir>', 'Cache directory for downloaded card images', DEFAULT_CACHE_DIR)
    .option('--expected-size <number>', 'Warn when the total proxy card count differs (0 disables)', '53')
    .option('--grid-size <number>', 'Grid size (NxN)', '3')
    .option('--card-width-mm <number>', 'Card width in millimetres', '63.5')
    .option('--card-height-mm <number>', 'Card height in millimetres', '88.9')
    .option('--cut-mark-length-mm <number>', 'Length of cut marks in millimetres', '5')
    .option('--scale <number>', 'Scale factor for card size (default: 0.97, i.e. 97% for tight sleeves)', '0.97')
    .option('--name <text>', 'Deck name for the PDF filename and footer', 'deck')
    .parse(process.argv);

  const options = program.opts();

  const gridSize = parseGridSize(options.gridSize);
  const cardWidthPt = mmToPt(parsePositiveNumber('--card-width-mm', options.cardWidthMm));
  const cardHeightPt = mmToPt(parsePositiveNumber('--card-height-mm', options.cardHeightMm));
  const cutMarkLengthPt = mmToPt(parsePositiveNumber('--cut-mark-length-mm', options.cutMarkLengthMm));
  const scaleFactor = parseScaleFactor(options.scale);
  const expectedDeckSize = parseExpectedSize(options.expectedSize);
  const { deckName, outputPath } = resolveNameAndOutput(options.name);

  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;

  return {
    input: options.input,
    baseUrl,
    dataCache: options.dataCache ? path.resolve(options.dataCache) : DEFAULT_DATA_CACHE,
    refreshData: Boolean(options.refreshData),
    fallbackImageBaseUrl: options.fallbackImageBaseUrl ? String(options.fallbackImageBaseUrl).trim() : null,
    cacheDir: path.resolve(options.cacheDir),
    expectedDeckSize,
    gridSize,
    cardWidthPt,
    cardHeightPt,
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
    throw new Error('--expected-size must be a non-negative integer');
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
