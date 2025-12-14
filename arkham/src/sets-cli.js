#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList } = require('../../shared/deck-utils');
const { loadCardDatabase, buildCardLookup, resolveDeckCards } = require('./card-data');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'arkhamdb-json-data');

async function main() {
  const program = new Command();
  program
    .name('arkham-sets')
    .description('List Arkham Horror LCG packs/boxes required by a deck list')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('--data-dir <dir>', 'Path to arkhamdb-json-data root', DEFAULT_DATA_DIR)
    .parse(process.argv);

  const options = program.opts();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const dataDir = path.resolve(options.dataDir);
  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const deckEntries = parseDeckList(deckText, { baseDir: deckBaseDir });
  if (!deckEntries.length) {
    throw new Error('No valid deck entries were found.');
  }

  const cards = await loadCardDatabase(dataDir);
  const lookup = buildCardLookup(cards);
  const deckCards = resolveDeckCards(deckEntries, lookup);

  const packMap = await loadPackMetadata(dataDir);
  const packSummary = summarizePacks(deckCards, packMap);

  if (!packSummary.length) {
    console.log('No packs could be resolved for this deck.');
    return;
  }

  console.log('Sets required for this deck:');
  packSummary.forEach(({ name, code, count }) => {
    const suffix = count === 1 ? 'card' : 'cards';
    console.log(`- ${name} [${code}] — ${count} ${suffix}`);
  });

  const unknown = packSummary.filter(pack => pack.isUnknown);
  if (unknown.length) {
    console.warn('\nSome cards have pack codes not found in packs.json:');
    unknown.forEach(pack => console.warn(`- ${pack.code}`));
  }
}

async function loadPackMetadata(dataDir) {
  const packsPath = path.join(dataDir, 'packs.json');
  let raw;
  try {
    raw = await fs.promises.readFile(packsPath, 'utf8');
  } catch (err) {
    throw new Error(`Unable to read packs.json at ${packsPath}: ${err instanceof Error ? err.message : err}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error('packs.json is not valid JSON.');
  }

  const map = new Map();
  if (Array.isArray(parsed)) {
    parsed.forEach(pack => {
      if (pack && pack.code) {
        map.set(pack.code, pack);
      }
    });
  }

  return map;
}

function summarizePacks(cards, packMap) {
  const counts = new Map();

  cards.forEach(card => {
    const packCode = card && (card.pack_code || card.packCode);
    const code = packCode || 'unknown';
    counts.set(code, (counts.get(code) || 0) + 1);
  });

  const packs = Array.from(counts.entries()).map(([code, count]) => {
    const meta = packMap.get(code);
    return {
      code,
      count,
      name: meta && meta.name ? meta.name : `Unknown pack (${code})`,
      date: meta && meta.date_release ? meta.date_release : null,
      position: Number.isFinite(meta && meta.position) ? meta.position : Number.MAX_SAFE_INTEGER,
      isUnknown: !meta,
    };
  });

  packs.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    return a.name.localeCompare(b.name);
  });

  return packs;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
