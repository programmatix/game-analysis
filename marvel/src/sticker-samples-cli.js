#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const YAML = require('yaml');
const { buildStickerSampleSheetPdf } = require('./sticker-samples-pdf');
const { buildStickerSheetYamlConfig } = require('./sticker-sheet-yaml');

const DEFAULT_SAMPLE_1_LOGO = '/home/grahamp/dev/game-decks/marvel/assets/storm/logo.png';
const DEFAULT_SAMPLE_1_ART = '/home/grahamp/dev/game-decks/marvel/assets/storm/image2.png';

async function main() {
  const program = new Command();
  program
    .name('marvel-sticker-samples')
    .description('Generate a 1-page sample sheet of deck-box sticker designs (10 slots; first slot filled)')
    .option('--format <pdf|yaml>', 'Output format (pdf writes a PDF file; yaml writes YAML to stdout)', 'pdf')
    .option('--yaml-sample <number>', 'When --format yaml: which sample number to emit (1-based)', '1')
    .option('--page-size <a4|letter>', 'Page size', 'a4')
    .option('--orientation <auto|portrait|landscape>', 'Orientation selection', 'auto')
    .option('--columns <number>', 'Grid columns (columns * rows must be >= 10)', '2')
    .option('--rows <number>', 'Grid rows (columns * rows must be >= 10)', '5')
    .option('--count <number>', 'Number of sticker slots to draw (default 10)', '10')
    .option('--sticker-width-mm <number>', 'Sticker width in millimetres', '70')
    .option('--sticker-height-mm <number>', 'Sticker height in millimetres', '25')
    .option('--corner-radius-mm <number>', 'Sticker corner radius (for clipping only)', '2')
    .option('--sheet-margin-mm <number>', 'Outer margin for the sheet', '8')
    .option('--gutter-mm <number>', 'Gap between stickers', '3')
    .option('--sheet-header-height-mm <number>', 'Header band height', '12')
    .option('--sample-1-logo <file>', 'Sample #1 logo image (PNG/JPG)', DEFAULT_SAMPLE_1_LOGO)
    .option('--sample-1-art <file>', 'Sample #1 art image (PNG/JPG)', DEFAULT_SAMPLE_1_ART)
    .option('--sample-1-logo-offset-x-mm <number>', 'Sample #1 logo horizontal offset (mm)', '0')
    .option('--sample-1-logo-offset-y-mm <number>', 'Sample #1 logo vertical offset (mm)', '0')
    .option('--sample-1-logo-max-width-mm <number>', 'Sample #1 logo max width (mm)', '28')
    .option('--sample-1-logo-max-height-mm <number>', 'Sample #1 logo max height (mm)', '18')
    .option('--sample-1-art-offset-x-mm <number>', 'Sample #1 art horizontal offset (mm)', '0')
    .option('--sample-1-art-offset-y-mm <number>', 'Sample #1 art vertical offset (mm)', '0')
    .option('--sample-1-gradient <hex>', 'Sample #1 fade color (hex like #f7d117)', '#f7d117')
    .option('--sample-1-yellow <hex>', 'DEPRECATED: use --sample-1-gradient', '')
    .option('--sample-1-gradient-width-mm <number>', 'Sample #1 fade width from gradient -> image (mm)', '34')
    .option('-o, --output <file>', 'Output PDF path', '')
    .parse(process.argv);

  const opts = program.opts();
  const errors = [];

  const format = String(opts.format || 'pdf').trim().toLowerCase();
  if (!['pdf', 'yaml'].includes(format)) {
    errors.push('--format must be one of: pdf, yaml');
  }

  const yamlSample = parseIntNumber('--yaml-sample', opts.yamlSample, errors, { min: 1, max: 999 });

  const pageSize = String(opts.pageSize || 'a4').trim().toLowerCase();
  if (!['a4', 'letter'].includes(pageSize)) {
    errors.push('--page-size must be one of: a4, letter');
  }

  const orientation = String(opts.orientation || 'auto').trim().toLowerCase();
  if (!['auto', 'portrait', 'landscape'].includes(orientation)) {
    errors.push('--orientation must be one of: auto, portrait, landscape');
  }

  const numbers = {
    columns: parseIntNumber('--columns', opts.columns, errors, { min: 1, max: 10 }),
    rows: parseIntNumber('--rows', opts.rows, errors, { min: 1, max: 20 }),
    count: parseIntNumber('--count', opts.count, errors, { min: 1, max: 200 }),
    stickerWidthMm: parseNumber('--sticker-width-mm', opts.stickerWidthMm, errors, { min: 1 }),
    stickerHeightMm: parseNumber('--sticker-height-mm', opts.stickerHeightMm, errors, { min: 1 }),
    cornerRadiusMm: parseNumber('--corner-radius-mm', opts.cornerRadiusMm, errors, { min: 0 }),
    sheetMarginMm: parseNumber('--sheet-margin-mm', opts.sheetMarginMm, errors, { min: 0 }),
    gutterMm: parseNumber('--gutter-mm', opts.gutterMm, errors, { min: 0 }),
    sheetHeaderHeightMm: parseNumber('--sheet-header-height-mm', opts.sheetHeaderHeightMm, errors, { min: 0 }),
    sample1LogoOffsetXMm: parseNumber('--sample-1-logo-offset-x-mm', opts.sample1LogoOffsetXMm, errors, { min: -1000 }),
    sample1LogoOffsetYMm: parseNumber('--sample-1-logo-offset-y-mm', opts.sample1LogoOffsetYMm, errors, { min: -1000 }),
    sample1LogoMaxWidthMm: parseNumber('--sample-1-logo-max-width-mm', opts.sample1LogoMaxWidthMm, errors, { min: 0.1 }),
    sample1LogoMaxHeightMm: parseNumber('--sample-1-logo-max-height-mm', opts.sample1LogoMaxHeightMm, errors, { min: 0.1 }),
    sample1ArtOffsetXMm: parseNumber('--sample-1-art-offset-x-mm', opts.sample1ArtOffsetXMm, errors, { min: -1000 }),
    sample1ArtOffsetYMm: parseNumber('--sample-1-art-offset-y-mm', opts.sample1ArtOffsetYMm, errors, { min: -1000 }),
    sample1GradientWidthMm: parseNumber('--sample-1-gradient-width-mm', opts.sample1GradientWidthMm, errors, { min: 0 }),
  };

  if (numbers.columns * numbers.rows < 10) {
    errors.push('--columns * --rows must be >= 10 (to leave space for 10 stickers)');
  }

  if (numbers.count > numbers.columns * numbers.rows) {
    errors.push('--count must be <= --columns * --rows');
  }

  const sample1Gradient = String((opts.sample1Gradient || opts.sample1Yellow || '').trim() || '#f7d117');
  if (!/^#?[0-9a-f]{6}$/i.test(sample1Gradient)) {
    errors.push('--sample-1-gradient must be a 6-digit hex color like #f7d117');
  }
  if (String(opts.sample1Yellow || '').trim() && String(opts.sample1Gradient || '').trim()) {
    errors.push('Use only one of: --sample-1-gradient, --sample-1-yellow');
  }

  const sample1Logo = resolveOptionalPath(opts.sample1Logo);
  if (sample1Logo && !fs.existsSync(sample1Logo)) {
    errors.push(`--sample-1-logo does not exist: ${sample1Logo}`);
  }

  const sample1Art = resolveOptionalPath(opts.sample1Art);
  if (sample1Art && !fs.existsSync(sample1Art)) {
    errors.push(`--sample-1-art does not exist: ${sample1Art}`);
  }

  if (errors.length) {
    throw new Error(`Invalid options:\n- ${errors.join('\n- ')}`);
  }

  if (format === 'yaml') {
    if (String(opts.output || '').trim()) {
      throw new Error('--output is not used with --format yaml (YAML is written to stdout)');
    }

    const yamlConfig = buildStickerSheetYamlConfig({
      pageSize,
      orientation,
      sheetMarginMm: numbers.sheetMarginMm,
      gutterMm: numbers.gutterMm,
      stickerWidthMm: numbers.stickerWidthMm,
      stickerHeightMm: numbers.stickerHeightMm,
      cornerRadiusMm: numbers.cornerRadiusMm,
      columns: numbers.columns,
      rows: numbers.rows,
      count: numbers.count,
      sampleNumber: yamlSample,
      sample1Logo,
      sample1Art,
      sample1Gradient,
      sample1GradientWidthMm: numbers.sample1GradientWidthMm,
      sample1LogoOffsetXMm: numbers.sample1LogoOffsetXMm,
      sample1LogoOffsetYMm: numbers.sample1LogoOffsetYMm,
      sample1LogoMaxWidthMm: numbers.sample1LogoMaxWidthMm,
      sample1LogoMaxHeightMm: numbers.sample1LogoMaxHeightMm,
      sample1ArtOffsetXMm: numbers.sample1ArtOffsetXMm,
      sample1ArtOffsetYMm: numbers.sample1ArtOffsetYMm,
      debug: {
        leftMm: 10,
        rightFromRightMm: 50,
        centerHorizontal: true,
      },
    });

    process.stdout.write(
      YAML.stringify(yamlConfig, {
        indent: 2,
      }),
    );
    return;
  }

  const outputPath = resolveOutputPath(opts.output);
  const { pdfBytes, sheet } = await buildStickerSampleSheetPdf({
    pageSize,
    orientation,
    ...numbers,
    sample1Logo,
    sample1Art,
    sample1Gradient,
  });

  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
  console.log(`Sheet: ${sheet.pageWidthMm}×${sheet.pageHeightMm}mm (${sheet.orientation}), ${sheet.rows}×${sheet.columns}, ${sheet.count} slots`);
}

function resolveOutputPath(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed) {
    const hasPdf = /\.pdf$/i.test(trimmed);
    return path.resolve(hasPdf ? trimmed : `${trimmed}.pdf`);
  }
  return path.resolve('sticker-samples.pdf');
}

function resolveOptionalPath(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return path.resolve(raw);
}

function parseNumber(flag, raw, errors, { min }) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    errors.push(`${flag} must be a number`);
    return 0;
  }
  if (value < min) {
    errors.push(`${flag} must be >= ${min}`);
    return value;
  }
  return value;
}

function parseIntNumber(flag, raw, errors, { min, max }) {
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    errors.push(`${flag} must be an integer`);
    return min;
  }
  if (value < min || value > max) {
    errors.push(`${flag} must be between ${min} and ${max}`);
    return value;
  }
  return value;
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
