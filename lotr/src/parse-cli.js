#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, hasCardEntries } = require('../../shared/deck-utils');
const { parseLotrDeckList, formatResolvedDeckEntries } = require('./decklist');
const { DEFAULT_BASE_URL, loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

const DEFAULT_DATA_CACHE = path.join(__dirname, '..', '.cache', 'ringsdb-cards.json');

async function main() {
  const program = new Command();
  program
    .name('lotr-parse')
    .description('Parse LOTR LCG deck lists and resolve them against the RingsDB card database')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .option('--base-url <url>', 'RingsDB base URL', DEFAULT_BASE_URL)
    .option('--data-cache <file>', 'Where to cache RingsDB cards JSON', DEFAULT_DATA_CACHE)
    .option('--refresh-data', 'Re-download the RingsDB cards JSON into the cache', false)
    .option('--json', 'Output JSON instead of a normalized text list', false)
    .parse(process.argv);

  const options = program.opts();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const parsedEntries = parseLotrDeckList(deckText, {
    baseDir: deckBaseDir,
    sourcePath: options.input ? path.resolve(options.input) : '<stdin>',
  });
  if (!hasCardEntries(parsedEntries)) {
    throw new Error('No valid deck entries were found.');
  }

  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const cards = await loadCardDatabase({
    cachePath: options.dataCache ? path.resolve(options.dataCache) : DEFAULT_DATA_CACHE,
    refresh: Boolean(options.refreshData),
    baseUrl,
  });
  const { lookup, cardIndex } = buildCardLookup(cards);

  const failures = [];
  const resolvedEntries = parsedEntries.map(entry => {
    if (!entry || entry.proxyPageBreak) return entry;
    try {
      const card = resolveCard(entry, lookup, cardIndex);
      return { ...entry, code: card.code, name: card.fullName || card.name || entry.name };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`- ${formatEntryLabel(entry)}: ${message}`);
      return { ...entry, resolved: null };
    }
  });
  if (failures.length) {
    throw new Error(`Failed to resolve ${failures.length} card${failures.length === 1 ? '' : 's'}:\n${failures.join('\n')}`);
  }

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

function formatEntryLabel(entry) {
  const name = entry?.name || '(unknown)';
  const sourceFile = typeof entry?.source?.file === 'string' ? entry.source.file : '';
  const sourceLine = Number(entry?.source?.line) || 0;
  const source = sourceFile ? `${sourceFile}${sourceLine ? `:${sourceLine}` : ''}` : '';
  return source ? `${name} (${source})` : name;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
