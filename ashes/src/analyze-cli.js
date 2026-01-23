#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList, hasCardEntries } = require('../../shared/deck-utils');
const { renderAsciiBarChart } = require('../../shared/ascii-chart');
const { normalizeAshesDeckEntries } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

async function main() {
  const program = new Command();
  program
    .name('ashes-analyze')
    .description('Analyze Ashes Reborn deck lists (types, releases, dice costs)')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('--data-cache <file>', 'Where to cache Ashes.live cards JSON', path.join('.cache', 'asheslive-cards.json'))
    .option('--refresh-data', 'Re-download the Ashes.live cards JSON into the cache', false)
    .option('--api-base-url <url>', 'Base URL for Ashes.live API', 'https://api.ashes.live')
    .option('--show-legacy', 'Include legacy cards in the local database cache', false)
    .option('--bar-width <number>', 'Width of the ASCII bars', '22')
    .option('--json', 'Output JSON instead of text', false)
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

  const report = computeReport(resolved);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const barWidth = parseBarWidth(options.barWidth);
  process.stdout.write(formatTextReport(report, { barWidth }));
}

function parseBarWidth(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 22;
  return Math.floor(value);
}

function computeReport(entries) {
  const totalCards = entries.reduce((sum, entry) => {
    if (!entry || entry.proxyPageBreak) return sum;
    return sum + (Number(entry.count) || 0);
  }, 0);

  const byType = new Map();
  const byRelease = new Map();
  const diceCost = new Map(); // dieFace -> total symbols
  let chained = 0;

  for (const entry of entries) {
    if (!entry || entry.proxyPageBreak) continue;
    const count = Number(entry.count) || 0;
    const card = entry.resolved;
    const type = typeof card?.type === 'string' ? card.type.trim() : '';
    const release = typeof card?.release?.name === 'string' ? card.release.name.trim() : '';

    if (type) byType.set(type, (byType.get(type) || 0) + count);
    if (release) byRelease.set(release, (byRelease.get(release) || 0) + count);
    if (card?.chained) chained += count;

    const magicCost = card?.magicCost && typeof card.magicCost === 'object' ? card.magicCost : null;
    if (magicCost) {
      for (const [key, value] of Object.entries(magicCost)) {
        const symbols = Number(value);
        if (!Number.isFinite(symbols) || symbols <= 0) continue;
        const dieFace = String(key || '').trim();
        if (!dieFace) continue;
        diceCost.set(dieFace, (diceCost.get(dieFace) || 0) + symbols * count);
      }
    }
  }

  return {
    totalCards,
    chained,
    types: mapToSortedList(byType),
    releases: mapToSortedList(byRelease),
    dice: mapToSortedList(diceCost),
  };
}

function mapToSortedList(map) {
  const entries = [...(map instanceof Map ? map.entries() : [])].map(([label, count]) => ({
    label,
    count,
  }));
  entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return String(a.label).localeCompare(String(b.label));
  });
  return entries;
}

function formatTextReport(report, options = {}) {
  const width = Number.isFinite(options.barWidth) ? options.barWidth : 22;
  const lines = [];

  lines.push(`Cards: ${Number(report.totalCards) || 0}`);
  if (report.chained) lines.push(`Chained: ${Number(report.chained) || 0}`);

  lines.push('');
  lines.push('Types:');
  lines.push(renderAsciiBarChart(report.types || [], { width }));

  lines.push('');
  lines.push('Releases:');
  lines.push(renderAsciiBarChart(report.releases || [], { width }));

  lines.push('');
  lines.push('Dice costs (magicCost):');
  lines.push(renderAsciiBarChart(report.dice || [], { width }));

  lines.push('');
  return `${lines.join('\n')}\n`;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

