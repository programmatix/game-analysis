#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');

const EXO2_BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/exo2';

async function main() {
  const program = new Command();
  program
    .name('marvel-fonts-download')
    .description('Download open-licensed fonts used by the Marvel Champions tools (only fonts with permissive licenses).')
    .argument('[family]', 'Font family to download (currently: exo2)')
    .option('--out-dir <dir>', 'Destination directory', path.join('assets', 'fonts'))
    .option('--force', 'Overwrite existing files', false)
    .parse(process.argv);

  const family = String(program.args[0] || '').trim().toLowerCase();
  const opts = program.opts();
  const outDir = path.resolve(String(opts.outDir || path.join('assets', 'fonts')));
  await fs.promises.mkdir(outDir, { recursive: true });

  if (!family) {
    throw new Error('Missing <family>. Try: `npx marvel-fonts-download exo2`');
  }

  if (family !== 'exo2') {
    throw new Error(`Unknown family "${family}". Supported: exo2`);
  }

  const plan = [
    { url: `${EXO2_BASE}/Exo2[wght].ttf`, fileName: 'Exo2[wght].ttf' },
    { url: `${EXO2_BASE}/Exo2-Italic[wght].ttf`, fileName: 'Exo2-Italic[wght].ttf' },
    { url: `${EXO2_BASE}/OFL.txt`, fileName: 'Exo2-OFL.txt' },
  ];

  const errors = [];
  const results = [];
  for (const item of plan) {
    const dest = path.join(outDir, item.fileName);
    try {
      const status = await downloadToFile(item.url, dest, { force: Boolean(opts.force) });
      results.push({ ...item, dest, status });
    } catch (err) {
      errors.push(`${item.url} -> ${dest}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const r of results) {
    console.log(`${r.status}: ${r.dest}`);
  }

  if (errors.length) {
    throw new Error(`One or more downloads failed:\n- ${errors.join('\n- ')}`);
  }
}

async function downloadToFile(url, filePath, { force }) {
  if (!force) {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return 'skipped';
    } catch (_) {
      // continue
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 1024) {
    throw new Error(`Downloaded file looks too small (${bytes.length} bytes)`);
  }
  await fs.promises.writeFile(filePath, bytes);
  return 'downloaded';
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});

