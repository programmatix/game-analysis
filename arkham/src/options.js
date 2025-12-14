const path = require('path');
const { Command } = require('commander');
const { mmToPt } = require('../../shared/pdf-layout');
const { resolveNameAndOutput } = require('../../shared/deck-utils');

const DEFAULT_CACHE_DIR = path.join('.cache', 'arkham-card-art');
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'arkhamdb-json-data');

function parseCliOptions() {
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

  const gridSize = parseGridSize(options.gridSize);
  const cardWidthPt = mmToPt(parsePositiveNumber('--card-width-mm', options.cardWidthMm));
  const cardHeightPt = mmToPt(parsePositiveNumber('--card-height-mm', options.cardHeightMm));
  const cutMarkLengthPt = mmToPt(parsePositiveNumber('--cut-mark-length-mm', options.cutMarkLengthMm));
  const face = String(options.face || 'a').toLowerCase() === 'b' ? 'b' : 'a';
  const { deckName, outputPath } = resolveNameAndOutput(options.name);

  return {
    input: options.input,
    dataDir: path.resolve(options.dataDir),
    cacheDir: path.resolve(options.cacheDir),
    gridSize,
    cardWidthPt,
    cardHeightPt,
    cutMarkLengthPt,
    face,
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

module.exports = {
  parseCliOptions,
};
