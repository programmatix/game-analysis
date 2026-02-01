#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const YAML = require('yaml');
const { buildStickerSheetPdf } = require('./sticker-sheet-pdf');

async function main() {
  const program = new Command();
  program
    .name('marvel-sticker-sheet')
    .description('Generate a printable sticker sheet PDF from a YAML config')
    .requiredOption('--input <file>', 'Input YAML file path (use - for stdin)')
    .option('--debug', 'Enable debug guidelines (uses YAML debug settings)', false)
    .option('-o, --output <file>', 'Output PDF path', '')
    .parse(process.argv);

  const opts = program.opts();
  const yamlText = await readYamlInput(opts.input);

  let config;
  try {
    config = YAML.parse(yamlText);
  } catch (err) {
    throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { normalized, errors } = normalizeStickerSheetConfig(config);
  if (errors.length) {
    throw new Error(`Invalid config:\n- ${errors.join('\n- ')}`);
  }

  const outputPath = resolveOutputPath(opts.output);
  const { pdfBytes, sheet } = await buildStickerSheetPdf(normalized, { debug: Boolean(opts.debug) });

  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
  console.log(`Sheet: ${sheet.pageWidthMm}×${sheet.pageHeightMm}mm (${sheet.orientation}), ${sheet.rows}×${sheet.columns}, ${sheet.stickers} stickers`);
}

async function readYamlInput(inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) throw new Error('--input is required');
  if (raw === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }
  const abs = path.resolve(raw);
  try {
    return await fs.promises.readFile(abs, 'utf8');
  } catch (err) {
    throw new Error(`Unable to read --input: ${abs} (${err instanceof Error ? err.message : String(err)})`);
  }
}

function resolveOutputPath(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed) {
    const hasPdf = /\.pdf$/i.test(trimmed);
    return path.resolve(hasPdf ? trimmed : `${trimmed}.pdf`);
  }
  return path.resolve('sticker-sheet.pdf');
}

function normalizeStickerSheetConfig(config) {
  const errors = [];
  const root = config && typeof config === 'object' ? config : {};

  const sheet = normalizeSheet(root.sheet, errors);
  const debug = normalizeDebug(root.debug, errors);
  const defaults = normalizeDefaults(root.defaults, errors);
  const stickers = normalizeStickers(root.stickers, defaults, errors);

  if (stickers.length === 0) {
    errors.push('stickers must be a non-empty array');
  }

  if (sheet.columns * sheet.rows < stickers.length) {
    errors.push(`sheet.columns * sheet.rows must be >= stickers.length (${sheet.columns}*${sheet.rows} < ${stickers.length})`);
  }

  // Basic fit sanity check at true size (no scaling in this tool).
  const usableW = sheet.pageWidthMm - sheet.marginMm * 2;
  const usableH = sheet.pageHeightMm - sheet.marginMm * 2;
  const gridW = sheet.stickerWidthMm * sheet.columns + sheet.gutterMm * (sheet.columns - 1);
  const gridH = sheet.stickerHeightMm * sheet.rows + sheet.gutterMm * (sheet.rows - 1);
  if (gridW > usableW + 1e-6) {
    errors.push(`Grid too wide for page at true size (${format1(gridW)}mm > ${format1(usableW)}mm usable). Reduce columns/sticker width/gutter/margins.`);
  }
  if (gridH > usableH + 1e-6) {
    errors.push(`Grid too tall for page at true size (${format1(gridH)}mm > ${format1(usableH)}mm usable). Reduce rows/sticker height/gutter/margins.`);
  }

  return { normalized: { version: root.version ?? 1, sheet, debug, defaults, stickers }, errors };
}

function normalizeSheet(raw, errors) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const pageSize = String(src.pageSize || 'a4').trim().toLowerCase();
  if (!['a4', 'letter'].includes(pageSize)) errors.push('sheet.pageSize must be a4 or letter');

  const orientation = String(src.orientation || 'auto').trim().toLowerCase();
  if (!['auto', 'portrait', 'landscape'].includes(orientation)) errors.push('sheet.orientation must be auto, portrait, or landscape');

  const base = pageSize === 'letter' ? { widthMm: 215.9, heightMm: 279.4 } : { widthMm: 210, heightMm: 297 };

  const sheet = {
    pageSize,
    marginMm: parseNumber('sheet.marginMm', src.marginMm, errors, { min: 0, fallback: 8 }),
    gutterMm: parseNumber('sheet.gutterMm', src.gutterMm, errors, { min: 0, fallback: 4 }),
    stickerWidthMm: parseNumber('sheet.stickerWidthMm', src.stickerWidthMm, errors, { min: 1, fallback: 70 }),
    stickerHeightMm: parseNumber('sheet.stickerHeightMm', src.stickerHeightMm, errors, { min: 1, fallback: 25 }),
    cornerRadiusMm: parseNumber('sheet.cornerRadiusMm', src.cornerRadiusMm, errors, { min: 0, fallback: 2 }),
    columns: parseInt('sheet.columns', src.columns, errors, { min: 1, max: 10, fallback: 2 }),
    rows: parseInt('sheet.rows', src.rows, errors, { min: 1, max: 40, fallback: 5 }),
  };

  const gridW = sheet.stickerWidthMm * sheet.columns + sheet.gutterMm * (sheet.columns - 1);
  const gridH = sheet.stickerHeightMm * sheet.rows + sheet.gutterMm * (sheet.rows - 1);

  const portrait = dimsFor(base, 'portrait', sheet.marginMm, gridW, gridH);
  const landscape = dimsFor(base, 'landscape', sheet.marginMm, gridW, gridH);

  const chosen =
    orientation === 'portrait'
      ? portrait
      : orientation === 'landscape'
        ? landscape
        : pickAutoOrientation(portrait, landscape);

  sheet.orientation = chosen.orientation;
  sheet.pageWidthMm = chosen.pageWidthMm;
  sheet.pageHeightMm = chosen.pageHeightMm;

  return sheet;
}

function dimsFor(base, orientation, marginMm, gridW, gridH) {
  const pageWidthMm = orientation === 'landscape' ? base.heightMm : base.widthMm;
  const pageHeightMm = orientation === 'landscape' ? base.widthMm : base.heightMm;
  const usableW = pageWidthMm - marginMm * 2;
  const usableH = pageHeightMm - marginMm * 2;
  const fits = gridW <= usableW + 1e-6 && gridH <= usableH + 1e-6;
  const slack = Math.min(usableW - gridW, usableH - gridH);
  return { orientation, pageWidthMm, pageHeightMm, fits, slack };
}

function pickAutoOrientation(portrait, landscape) {
  if (portrait.fits && !landscape.fits) return portrait;
  if (landscape.fits && !portrait.fits) return landscape;
  if (portrait.fits && landscape.fits) return landscape.slack >= portrait.slack ? landscape : portrait;
  return landscape.slack >= portrait.slack ? landscape : portrait;
}

function normalizeDebug(raw, errors) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const debug = {
    leftMm: parseNumber('debug.leftMm', src.leftMm, errors, { min: -10000, fallback: 10 }),
    rightFromRightMm: parseNumber('debug.rightFromRightMm', src.rightFromRightMm, errors, { min: -10000, fallback: 40 }),
    centerHorizontal: src.centerHorizontal !== false,
  };
  return debug;
}

function normalizeDefaults(raw, errors) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const gradientRaw = src.gradient ?? src.yellow ?? '#f7d117';
  const gradient = String(gradientRaw).trim();
  if (!isHexColor(gradient)) errors.push('defaults.gradient must be a 6-digit hex color like #f7d117');
  if (src.gradient != null && src.yellow != null) {
    const a = normalizeHexColor(src.gradient);
    const b = normalizeHexColor(src.yellow);
    if (a && b && a !== b) errors.push('defaults.gradient and defaults.yellow are both set (use only defaults.gradient)');
  }

  return {
    design: String(src.design || 'sample1').trim() || 'sample1',
    logo: resolveOptionalPath(src.logo),
    logoOffsetXMm: parseNumber('defaults.logoOffsetXMm', src.logoOffsetXMm, errors, { min: -1000, fallback: 0 }),
    logoOffsetYMm: parseNumber('defaults.logoOffsetYMm', src.logoOffsetYMm, errors, { min: -1000, fallback: 0 }),
    logoMaxWidthMm: parseNumber('defaults.logoMaxWidthMm', src.logoMaxWidthMm, errors, { min: 0.1, fallback: 28 }),
    logoMaxHeightMm: parseNumber('defaults.logoMaxHeightMm', src.logoMaxHeightMm, errors, { min: 0.1, fallback: 18 }),
    logoScale: parseNumber('defaults.logoScale', src.logoScale, errors, { min: 0.1, fallback: 1 }),
    gradient,
    gradientWidthMm: parseNumber('defaults.gradientWidthMm', src.gradientWidthMm, errors, { min: 0, fallback: 34 }),
    artScale: parseNumber('defaults.artScale', src.artScale, errors, { min: 0.1, fallback: 1 }),
  };
}

function normalizeStickers(raw, defaults, errors) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];

  for (let i = 0; i < arr.length; i++) {
    const src = arr[i] && typeof arr[i] === 'object' ? arr[i] : {};
    const prefix = `stickers[${i}]`;

    const gradientRaw = src.gradient ?? src.yellow ?? defaults.gradient;
    const gradient = gradientRaw != null ? String(gradientRaw).trim() : '';
    if (gradient && !isHexColor(gradient)) errors.push(`${prefix}.gradient must be a 6-digit hex color like #f7d117`);
    if (src.gradient != null && src.yellow != null) {
      const a = normalizeHexColor(src.gradient);
      const b = normalizeHexColor(src.yellow);
      if (a && b && a !== b) errors.push(`${prefix}.gradient and ${prefix}.yellow are both set (use only ${prefix}.gradient)`);
    }

    const design = String(src.design ?? defaults.design ?? 'sample1').trim() || 'sample1';
    if (design !== 'sample1') errors.push(`${prefix}.design must be "sample1" (for now)`);

    const sticker = {
      name: String(src.name || '').trim(),
      design,
      logo: resolveOptionalPath(src.logo ?? defaults.logo),
      art: resolveOptionalPath(src.art),
      logoOffsetXMm: parseNumber(`${prefix}.logoOffsetXMm`, src.logoOffsetXMm, errors, { min: -1000, fallback: defaults.logoOffsetXMm }),
      logoOffsetYMm: parseNumber(`${prefix}.logoOffsetYMm`, src.logoOffsetYMm, errors, { min: -1000, fallback: defaults.logoOffsetYMm }),
      logoMaxWidthMm: parseNumber(`${prefix}.logoMaxWidthMm`, src.logoMaxWidthMm, errors, { min: 0.1, fallback: defaults.logoMaxWidthMm }),
      logoMaxHeightMm: parseNumber(`${prefix}.logoMaxHeightMm`, src.logoMaxHeightMm, errors, { min: 0.1, fallback: defaults.logoMaxHeightMm }),
      logoScale: parseNumber(`${prefix}.logoScale`, src.logoScale, errors, { min: 0.1, fallback: defaults.logoScale }),
      artOffsetXMm: parseNumber(`${prefix}.artOffsetXMm`, src.artOffsetXMm, errors, { min: -1000, fallback: 0 }),
      artOffsetYMm: parseNumber(`${prefix}.artOffsetYMm`, src.artOffsetYMm, errors, { min: -1000, fallback: 0 }),
      artScale: parseNumber(`${prefix}.artScale`, src.artScale, errors, { min: 0.1, fallback: defaults.artScale }),
      gradient,
      gradientWidthMm: parseNumber(`${prefix}.gradientWidthMm`, src.gradientWidthMm, errors, { min: 0, fallback: defaults.gradientWidthMm }),
    };

    if (sticker.logo && !fs.existsSync(sticker.logo)) errors.push(`${prefix}.logo does not exist: ${sticker.logo}`);
    if (sticker.art && !fs.existsSync(sticker.art)) errors.push(`${prefix}.art does not exist: ${sticker.art}`);

    out.push(sticker);
  }

  return out;
}

function resolveOptionalPath(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return path.resolve(raw);
}

function parseNumber(label, raw, errors, { min, fallback }) {
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    errors.push(`${label} must be a number`);
    return fallback;
  }
  if (value < min) {
    errors.push(`${label} must be >= ${min}`);
    return value;
  }
  return value;
}

function parseInt(label, raw, errors, { min, max, fallback }) {
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    errors.push(`${label} must be an integer`);
    return fallback;
  }
  if (value < min || value > max) {
    errors.push(`${label} must be between ${min} and ${max}`);
    return value;
  }
  return value;
}

function isHexColor(value) {
  return /^#?[0-9a-f]{6}$/i.test(String(value || '').trim());
}

function normalizeHexColor(value) {
  const raw = String(value || '').trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!match) return '';
  return `#${match[1].toLowerCase()}`;
}

function format1(n) {
  return Number(n).toFixed(1).replace(/\.0$/, '');
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
