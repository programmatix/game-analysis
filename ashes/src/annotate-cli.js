#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList, hasCardEntries } = require('../../shared/deck-utils');
const { normalizeAshesDeckEntries, formatResolvedDeckEntries } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');
const { ANNOTATION_PREFIX, buildCardComment } = require('./annotation-format');

async function main() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', err => {
      if (err && err.code === 'EPIPE') process.exit(0);
    });
  }

  const program = new Command();
  program
    .name('ashes-annotate')
    .description('Annotate Ashes Reborn deck lists with per-card notes')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('--data-cache <file>', 'Where to cache Ashes.live cards JSON', path.join('.cache', 'asheslive-cards.json'))
    .option('--refresh-data', 'Re-download the Ashes.live cards JSON into the cache', false)
    .option('--api-base-url <url>', 'Base URL for Ashes.live API', 'https://api.ashes.live')
    .option('--show-legacy', 'Include legacy cards in the local database cache', false)
    .option('--json', 'Output JSON instead of annotated deck text', false)
    .parse(process.argv);

  const options = program.opts();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const parsedEntries = parseDeckList(deckText, {
    baseDir: deckBaseDir,
    sourcePath: options.input ? path.resolve(options.input) : '<stdin>',
  });
  if (!hasCardEntries(parsedEntries)) {
    throw new Error('No valid deck entries were found.');
  }
  const deckEntries = normalizeAshesDeckEntries(parsedEntries);

  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: Boolean(options.refreshData),
    baseUrl: String(options.apiBaseUrl || 'https://api.ashes.live').trim(),
    showLegacy: Boolean(options.showLegacy),
  });
  const { lookup, cardIndex } = buildCardLookup(cards);

  const failures = [];
  const resolved = deckEntries.map(entry => {
    if (!entry || entry.proxyPageBreak) return entry;
    try {
      const card = resolveCard(entry, lookup, cardIndex);
      return { ...entry, resolved: card };
    } catch (err) {
      failures.push(`- ${entry.name || '(unknown)'}: ${err instanceof Error ? err.message : String(err)}`);
      return { ...entry, resolved: null };
    }
  });

  if (failures.length) {
    throw new Error(`Failed to resolve ${failures.length} card${failures.length === 1 ? '' : 's'}:\n${failures.join('\n')}`);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
    return;
  }

  for (const entry of resolved) {
    if (!entry) continue;
    if (entry.proxyPageBreak) {
      process.stdout.write('[proxypagebreak]\n');
      continue;
    }
    const card = entry.resolved;
    const formattedLine = formatResolvedDeckEntries([{ ...entry, name: card?.name || entry.name, code: card?.stub || entry.code }]);
    if (formattedLine) {
      process.stdout.write(`${formattedLine}\n`);
      process.stdout.write(`${ANNOTATION_PREFIX}${buildCardComment(card)}\n`);
    }
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
