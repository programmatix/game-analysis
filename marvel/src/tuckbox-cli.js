#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { sanitizeFileName } = require('../../shared/deck-utils');
const { buildTuckBoxPdf } = require('./tuckbox-pdf');

async function main() {
  const program = new Command();
  program
    .name('marvel-tuckbox')
    .description('Generate a printable tuckbox template for Marvel Champions decks (defaults to duplex: outside + marks)')
    .requiredOption('--hero <name>', 'Hero name (shown on front/top)')
    .option('--text <text>', 'Misc text (supports literal \\n for line breaks)', '')
    .option('--inner-width-mm <number>', 'Internal box width in millimetres', '68')
    .option('--inner-height-mm <number>', 'Internal box height in millimetres', '93')
    .option('--inner-depth-mm <number>', 'Internal box depth in millimetres', '32')
    .option('--glue-flap-mm <number>', 'Glue flap width in millimetres', '8')
    .option('--tuck-extra-mm <number>', 'Extra tuck tab length beyond the top/bottom face depth', '15')
    .option('--margin-mm <number>', 'Minimum page margin for the net (0 maximizes usable area)', '0')
    .option('--accent <hex>', 'Accent color (hex like #f7d117)', '#f7d117')
    .option('--aspect <name>', 'Aspect color preset (justice|leadership|aggression|protection|basic|pool)', '')
    .option('--art <file>', 'Front art image (PNG/JPG)', '')
    .option('--front-art-offset-x-mm <number>', 'Front art horizontal offset in millimetres', '0')
    .option('--front-art-offset-y-mm <number>', 'Front art vertical offset in millimetres', '0')
    .option('--top-art-offset-x-mm <number>', 'Top art horizontal offset in millimetres', '0')
    .option('--top-art-offset-y-mm <number>', 'Top art vertical offset in millimetres', '0')
    .option('--logo <file>', 'Marvel Champions logo image (PNG/JPG). Defaults to assets/logo.png', '')
    .option('--logo-scale <number>', 'Logo scale factor (multiplies default size)', '1')
    .option('--no-logo', 'Disable the logo entirely', false)
    .option('--back <file>', 'Back panel image (PNG/JPG). Defaults to assets/cardback.png', '')
    .option('--no-duplex', 'Generate a 1-page single-sided template (cut/fold marks on front)')
    .option('--print', 'Print mode: hide zone/line labels (keeps cut/fold guides)', false)
    .option('--forgiving', 'Alias of --print (deprecated)', false)
    .option('--fonts-dir <dir>', 'Directory containing Marvel Champions fonts (TTF/OTF)', path.join(__dirname, '..', 'assets', 'fonts'))
    .option('--font-config <file>', 'JSON mapping font keys to file paths (optional)', '')
    .option('--page-size <a4|letter>', 'Page size for printing', 'a4')
    .option('--orientation <auto|portrait|landscape>', 'Orientation selection', 'auto')
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
    glueFlapMm: parseNumber('--glue-flap-mm', opts.glueFlapMm, errors, { min: 1 }),
    tuckExtraMm: parseNumber('--tuck-extra-mm', opts.tuckExtraMm, errors, { min: 0 }),
    marginMm: parseNumber('--margin-mm', opts.marginMm, errors, { min: 0 }),
    frontArtOffsetXMm: parseNumber('--front-art-offset-x-mm', opts.frontArtOffsetXMm, errors, { min: -1000 }),
    frontArtOffsetYMm: parseNumber('--front-art-offset-y-mm', opts.frontArtOffsetYMm, errors, { min: -1000 }),
    topArtOffsetXMm: parseNumber('--top-art-offset-x-mm', opts.topArtOffsetXMm, errors, { min: -1000 }),
    topArtOffsetYMm: parseNumber('--top-art-offset-y-mm', opts.topArtOffsetYMm, errors, { min: -1000 }),
    logoScale: parseNumber('--logo-scale', opts.logoScale, errors, { min: 0.01 }),
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

  if (errors.length) {
    throw new Error(`Invalid options:\n- ${errors.join('\n- ')}`);
  }

  const fontOverrides = await loadFontConfig(opts.fontConfig);

  const { pdfBytes, layout, fontWarnings } = await buildTuckBoxPdf({
    heroName: hero,
    miscText: opts.text,
    ...numbers,
    accent,
    artPath: opts.art,
    logoPath: opts.logo,
    logoScale: numbers.logoScale,
    noLogo: Boolean(opts.noLogo),
    backPath: opts.back,
    duplex: Boolean(opts.duplex),
    print: Boolean(opts.print) || Boolean(opts.forgiving),
    fontsDir: opts.fontsDir,
    fontOverrides,
    pageSize,
    orientation,
  });

  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);
  console.log(
    `Net: ${layout.netWidthMm.toFixed(1)}mm × ${layout.netHeightMm.toFixed(1)}mm on A4 ${layout.orientation} (${layout.pageWidthMm}×${layout.pageHeightMm}mm)`
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
  return path.resolve(`${base}-tuckbox.pdf`);
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
