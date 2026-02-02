#!/usr/bin/env node
const { Command } = require('commander');
const YAML = require('yaml');
const { buildStickerSheetYamlConfig } = require('./sticker-sheet-yaml');

const DEFAULT_LOGO = 'assets/logo.png';
const DEFAULT_ART = 'assets/sample/image.png';

async function main() {
  const program = new Command();
  program
    .name('deckbox-sticker-sheet-template')
    .description('Print a starter sticker-sheet YAML config to stdout')
    .option('--count <number>', 'Number of sticker entries to include', '10')
    .option('--page-size <a4|letter>', 'Page size', 'a4')
    .option('--orientation <auto|portrait|landscape>', 'Orientation selection', 'auto')
    .option('--columns <number>', 'Grid columns', '2')
    .option('--sticker-width-mm <number>', 'Sticker width in millimetres', '70')
    .option('--top-sticker-height-mm <number>', 'Top sticker height in millimetres', '25')
    .option('--front-sticker-height-mm <number>', 'Front sticker height in millimetres', '40')
    .option('--sticker-height-mm <number>', 'DEPRECATED: use --top-sticker-height-mm', '')
    .option('--logo <file>', 'Default logo path for stickers', DEFAULT_LOGO)
    .option('--art <file>', 'Sample art path for the first sticker', DEFAULT_ART)
    .parse(process.argv);

  const opts = program.opts();
  const count = clampInt(opts.count, { min: 1, max: 200 });

  const template = buildStickerSheetYamlConfig({
    pageSize: String(opts.pageSize || 'a4').trim().toLowerCase(),
    orientation: String(opts.orientation || 'auto').trim().toLowerCase(),
    sheetMarginMm: 8,
    gutterMm: 4,
    stickerWidthMm: Number(opts.stickerWidthMm) || 70,
    topStickerHeightMm: Number(opts.topStickerHeightMm || opts.stickerHeightMm) || 25,
    frontStickerHeightMm: Number(opts.frontStickerHeightMm) || 40,
    cornerRadiusMm: 2,
    columns: clampInt(opts.columns, { min: 1, max: 10 }),
    count,
    sampleNumber: 1,
    sample1Logo: String(opts.logo || '').trim(),
    sample1Art: String(opts.art || '').trim(),
    sample1Gradient: '#f7d117',
    sample1GradientWidthMm: 34,
    sample1LogoOffsetXMm: 0,
    sample1LogoOffsetYMm: 0,
    sample1LogoMaxWidthMm: 28,
    sample1LogoMaxHeightMm: 18,
    sample1ArtOffsetXMm: 0,
    sample1ArtOffsetYMm: 0,
    debug: {
      leftMm: 10,
      rightFromRightMm: 40,
      centerHorizontal: true,
    },
  });

  process.stdout.write(
    YAML.stringify(template, {
      indent: 2,
    }),
  );
}

function clampInt(value, { min = 1, max = 999 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
