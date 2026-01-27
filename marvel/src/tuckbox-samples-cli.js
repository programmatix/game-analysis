#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { sanitizeFileName } = require('../../shared/deck-utils');
const { buildTuckBoxTopSampleSheetPdf } = require('./tuckbox-pdf');

async function main() {
  const program = new Command();
  program
    .name('marvel-tuckbox-samples')
    .description('Generate a 1-page sample sheet (grid) of different top-face tuckbox designs')
    .requiredOption('--hero <name>', 'Hero name (shown on the sample tops)')
    .option('--text <text>', 'Misc text (supports literal \\n for line breaks)', '')
    .option('--inner-width-mm <number>', 'Internal box width in millimetres', '68')
    .option('--inner-height-mm <number>', 'Internal box height in millimetres (for reference only)', '93')
    .option('--inner-depth-mm <number>', 'Internal box depth in millimetres', '32')
    .option('--accent <hex>', 'Accent color (hex like #f7d117)', '#f7d117')
    .option('--aspect <name>', 'Aspect color preset (justice|leadership|aggression|protection|basic|pool)', '')
    .option('--art <file>', 'Top art image (PNG/JPG). Defaults to Cyclops art', '')
    .option('--top-art-offset-x-mm <number>', 'Top art horizontal offset in millimetres', '0')
    .option('--top-art-offset-y-mm <number>', 'Top art vertical offset in millimetres', '0')
    .option('--logo <file>', 'Marvel Champions logo image (PNG/JPG). Defaults to assets/logo.png', '')
    .option('--no-logo', 'Disable the logo entirely', false)
    .option('--fonts-dir <dir>', 'Directory containing Marvel Champions fonts (TTF/OTF)', path.join(__dirname, '..', 'assets', 'fonts'))
    .option('--font-config <file>', 'JSON mapping font keys to file paths (optional)', '')
    .option('--page-size <a4|letter>', 'Page size for the sample sheet', 'a4')
    .option('--orientation <auto|portrait|landscape>', 'Orientation selection', 'auto')
    .option('--columns <number>', 'Grid columns', '4')
    .option('--rows <number>', 'Grid rows', '4')
    .option('--count <number>', 'Number of variants to render', '16')
    .option('--sheet-margin-mm <number>', 'Outer margin for the sheet', '8')
    .option('--gutter-mm <number>', 'Gap between cells', '3')
    .option('-o, --output <file>', 'Output PDF path', '')
    .parse(process.argv);

  const opts = program.opts();

  const errors = [];
  const hero = String(opts.hero || '').trim();
  const outputPath = resolveOutputPath(opts.output, hero);

  const numbers = {
    innerWidthMm: parseNumber('--inner-width-mm', opts.innerWidthMm, errors, { min: 1 }),
    innerHeightMm: parseNumber('--inner-height-mm', opts.innerHeightMm, errors, { min: 1 }),
    innerDepthMm: parseNumber('--inner-depth-mm', opts.innerDepthMm, errors, { min: 0.1 }),
    topArtOffsetXMm: parseNumber('--top-art-offset-x-mm', opts.topArtOffsetXMm, errors, { min: -1000 }),
    topArtOffsetYMm: parseNumber('--top-art-offset-y-mm', opts.topArtOffsetYMm, errors, { min: -1000 }),
    sheetMarginMm: parseNumber('--sheet-margin-mm', opts.sheetMarginMm, errors, { min: 0 }),
    gutterMm: parseNumber('--gutter-mm', opts.gutterMm, errors, { min: 0 }),
    columns: parseIntNumber('--columns', opts.columns, errors, { min: 1, max: 10 }),
    rows: parseIntNumber('--rows', opts.rows, errors, { min: 1, max: 10 }),
    count: parseIntNumber('--count', opts.count, errors, { min: 1, max: 100 }),
  };

  const orientation = String(opts.orientation || 'auto').trim().toLowerCase();
  if (!['auto', 'portrait', 'landscape'].includes(orientation)) {
    errors.push('--orientation must be one of: auto, portrait, landscape');
  }

  const pageSize = String(opts.pageSize || 'a4').trim().toLowerCase();
  if (!['a4', 'letter'].includes(pageSize)) {
    errors.push('--page-size must be one of: a4, letter');
  }

  const accent = resolveAccent(opts.aspect, opts.accent, errors);

  if (numbers.count > numbers.columns * numbers.rows) {
    errors.push('--count must be <= --columns * --rows');
  }

  if (errors.length) {
    throw new Error(`Invalid options:\n- ${errors.join('\n- ')}`);
  }

  const fontOverrides = await loadFontConfig(opts.fontConfig);

  const { pdfBytes, sheet, fontWarnings } = await buildTuckBoxTopSampleSheetPdf({
    heroName: hero,
    miscText: opts.text,
    ...numbers,
    accent,
    artPath: opts.art,
    logoPath: opts.logo,
    noLogo: Boolean(opts.noLogo),
    fontsDir: opts.fontsDir,
    fontOverrides,
    pageSize,
    orientation,
  });

  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
  console.log(
    `Sheet: ${sheet.pageWidthMm}×${sheet.pageHeightMm}mm (${sheet.orientation}), grid ${sheet.rows}×${sheet.columns} (${sheet.count} variants)`
  );

  if (Array.isArray(fontWarnings) && fontWarnings.length) {
    console.warn(`Font notes:\n- ${fontWarnings.join('\n- ')}`);
    console.warn('Tip: put TTF/OTF files in `marvel/assets/fonts/`, or pass `--fonts-dir`, or pass `--font-config`.');
  }
}

function resolveAccent(aspectRaw, accentRaw, errors) {
  const aspect = typeof aspectRaw === 'string' ? aspectRaw.trim().toLowerCase() : '';
  if (!aspect) return accentRaw;

  const presets = {
    justice: '#f7d117',
    leadership: '#0076c8',
    aggression: '#d4252a',
    protection: '#1f8a3b',
    basic: '#9aa0a6',
    pool: '#7c4dff',
  };

  const hex = presets[aspect];
  if (!hex) {
    errors.push('--aspect must be one of: justice, leadership, aggression, protection, basic, pool');
    return accentRaw;
  }
  return hex;
}

function resolveOutputPath(raw, heroName) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed) {
    const hasPdf = /\.pdf$/i.test(trimmed);
    return path.resolve(hasPdf ? trimmed : `${trimmed}.pdf`);
  }

  const base = sanitizeFileName(heroName) || 'tuckbox';
  return path.resolve(`${base}-tuckbox-top-samples.pdf`);
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

async function loadFontConfig(rawPath) {
  const trimmed = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!trimmed) return {};

  const abs = path.resolve(trimmed);
  let data;
  try {
    data = await fs.promises.readFile(abs, 'utf8');
  } catch (err) {
    throw new Error(`Unable to read --font-config: ${abs} (${err instanceof Error ? err.message : String(err)})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    throw new Error(`--font-config is not valid JSON: ${abs} (${err instanceof Error ? err.message : String(err)})`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`--font-config must be a JSON object: ${abs}`);
  }

  const baseDir = path.dirname(abs);
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value == null) {
      out[key] = null;
      continue;
    }
    const str = String(value).trim();
    if (!str) continue;
    out[key] = path.isAbsolute(str) ? str : path.join(baseDir, str);
  }
  return out;
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
