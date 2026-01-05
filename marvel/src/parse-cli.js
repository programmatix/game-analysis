#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList, hasCardEntries } = require('../../shared/deck-utils');
const { normalizeMarvelDeckEntries, formatResolvedDeckEntries } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

async function main() {
  const program = new Command();
  program
    .name('marvel-parse')
    .description('Parse Marvel Champions deck lists and resolve them against MarvelCDB')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .option('--data-cache <file>', 'Where to cache MarvelCDB cards JSON', path.join('.cache', 'marvelcdb-cards.json'))
    .option('--refresh-data', 'Re-download the MarvelCDB cards JSON into the cache', false)
    .option('--face <a|b>', 'Default face for numeric codes like [01001]', 'a')
    .option('--json', 'Output JSON instead of a normalized text list', false)
    .parse(process.argv);

  const options = program.opts();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const parsedEntries = parseDeckList(deckText, { baseDir: deckBaseDir });
  if (!hasCardEntries(parsedEntries)) {
    throw new Error('No valid deck entries were found.');
  }
  const entries = normalizeMarvelDeckEntries(parsedEntries);

  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: Boolean(options.refreshData),
  });
  const { lookup, cardIndex } = buildCardLookup(cards);

  const resolvedEntries = entries.map(entry => {
    if (!entry || entry.proxyPageBreak) return entry;
    const card = resolveCard(entry, lookup, cardIndex, { defaultFace: options.face });
    return { ...entry, code: card.code, name: card.name || entry.name };
  });

  const outputText = Boolean(options.json)
    ? JSON.stringify(resolvedEntries, null, 2)
    : `${formatResolvedDeckEntries(resolvedEntries)}\n`;

  if (options.output) {
    const outPath = path.resolve(options.output);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, outputText);
    console.log(`Wrote resolved deck to ${outPath}`);
    return;
  }

  process.stdout.write(outputText);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

