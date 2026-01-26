#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { buildFontSheetPdf } = require('./font-sheet-pdf');

async function main() {
  const program = new Command();
  program
    .name('marvel-font-sheet')
    .description('Generate a PDF font sample sheet for Marvel Champions custom fonts')
    .option('--fonts-dir <dir>', 'Directory containing Marvel Champions fonts (TTF/OTF)', path.join('assets', 'fonts'))
    .option('--font-config <file>', 'JSON mapping font keys to file paths (optional)', '')
    .option('-o, --output <file>', 'Output PDF path', 'marvel-fonts.pdf')
    .parse(process.argv);

  const opts = program.opts();
  const fontOverrides = await loadFontConfig(opts.fontConfig);
  const { pdfBytes, warnings, fontPaths } = await buildFontSheetPdf({
    fontsDir: opts.fontsDir,
    fontOverrides,
  });

  const outputPath = ensurePdfExtension(path.resolve(String(opts.output || 'marvel-fonts.pdf')));
  await fs.promises.writeFile(outputPath, pdfBytes);
  console.log(`Created ${outputPath}`);

  if (warnings.length) {
    console.warn(`Font notes:\n- ${warnings.join('\n- ')}`);
    console.warn('Tip: put TTF/OTF files in `marvel/assets/fonts/`, or pass `--fonts-dir`, or pass `--font-config`.');
  } else {
    console.log('All fonts embedded.');
  }

  if (process.env.DEBUG_FONTS) {
    console.log(JSON.stringify(fontPaths, null, 2));
  }
}

function ensurePdfExtension(filePath) {
  return /\.pdf$/i.test(filePath) ? filePath : `${filePath}.pdf`;
}

async function loadFontConfig(rawPath) {
  const trimmed = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (!trimmed) return {};

  const abs = path.resolve(trimmed);
  const data = await fs.promises.readFile(abs, 'utf8');
  const parsed = JSON.parse(data);
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
