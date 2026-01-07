#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList, hasCardEntries } = require('../../shared/deck-utils');
const { renderAsciiBarChart } = require('../../shared/ascii-chart');
const { normalizeMarvelDeckEntries } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

async function main() {
  const program = new Command();
  program
    .name('marvel-analyze')
    .description('Analyze Marvel Champions deck lists (counts, aspects, and cost curves)')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('--data-cache <file>', 'Where to cache MarvelCDB cards JSON', path.join('.cache', 'marvelcdb-cards.json'))
    .option('--refresh-data', 'Re-download the MarvelCDB cards JSON into the cache', false)
    .option('--face <a|b>', 'Default face for numeric codes like [01001]', 'a')
    .option('--bar-width <number>', 'Width of the ASCII bars', '20')
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
  const deckEntries = normalizeMarvelDeckEntries(parsedEntries);

  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: Boolean(options.refreshData),
  });
  const { lookup, cardIndex } = buildCardLookup(cards);

  const failures = [];
  const resolved = deckEntries.map(entry => {
    if (!entry || entry.proxyPageBreak) return entry;
    try {
      const card = resolveCard(entry, lookup, cardIndex, { defaultFace: options.face });
      return { ...entry, resolved: card };
    } catch (err) {
      failures.push(`- ${entry.name || '(unknown)'}: ${err instanceof Error ? err.message : String(err)}`);
      return { ...entry, resolved: null };
    }
  });

  if (failures.length) {
    throw new Error(`Failed to resolve ${failures.length} card${failures.length === 1 ? '' : 's'}:\n${failures.join('\n')}`);
  }

  const totals = computeDeckTotals(resolved);
  const aspectCounts = computeAspectCounts(resolved);
  const allyCount = computeTypeCount(resolved, 'ally');
  const costCurve = computeCostCurve(resolved);

  const output = {
    totalCards: totals.totalCards,
    ignoredForDeckLimit: totals.ignoredForDeckLimit,
    allies: allyCount,
    aspects: aspectCounts,
    resourceCosts: costCurve,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  const barWidth = parseBarWidth(options.barWidth);
  process.stdout.write(formatTextReport(output, { barWidth }));
}

function parseBarWidth(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 20;
  return Math.floor(value);
}

function computeDeckTotals(entries) {
  const ignoredForDeckLimit = entries.reduce((total, entry) => {
    if (entry?.proxyPageBreak) return total;
    if (!entry) return total;
    const card = entry.resolved;
    if (!isPlayerDeckCard(card)) return total;
    return total + (isIgnoredForDeckLimit(entry) ? (Number(entry.count) || 0) : 0);
  }, 0);

  const totalCards = entries.reduce((total, entry) => {
    if (entry?.proxyPageBreak) return total;
    if (!entry || isIgnoredForDeckLimit(entry)) return total;
    const card = entry.resolved;
    if (!isPlayerDeckCard(card)) return total;
    return total + (Number(entry.count) || 0);
  }, 0);

  return {
    totalCards,
    ignoredForDeckLimit,
  };
}

function computeTypeCount(entries, typeCode) {
  const target = String(typeCode || '').toLowerCase();
  return entries.reduce((total, entry) => {
    if (entry?.proxyPageBreak) return total;
    if (!entry || isIgnoredForDeckLimit(entry)) return total;
    const card = entry.resolved;
    if (!isPlayerDeckCard(card)) return total;
    if (String(card.type_code || '').toLowerCase() !== target) return total;
    return total + (Number(entry.count) || 0);
  }, 0);
}

function computeAspectCounts(entries) {
  const order = ['aggression', 'justice', 'leadership', 'protection', 'basic', 'pool'];
  const counts = new Map(order.map(code => [code, 0]));

  for (const entry of entries) {
    if (entry?.proxyPageBreak) continue;
    if (!entry || isIgnoredForDeckLimit(entry)) continue;
    const card = entry.resolved;
    if (!isPlayerDeckCard(card)) continue;

    const faction = String(card.faction_code || '').toLowerCase();
    const count = Number(entry.count) || 0;
    if (counts.has(faction)) {
      counts.set(faction, counts.get(faction) + count);
    }
  }

  const output = {};
  for (const code of order) {
    output[code] = counts.get(code) || 0;
  }
  return output;
}

function computeCostCurve(entries) {
  const histogram = new Map();

  for (const entry of entries) {
    if (entry?.proxyPageBreak) continue;
    if (!entry || isIgnoredForDeckLimit(entry)) continue;
    const card = entry.resolved;
    if (!isPlayerDeckCard(card)) continue;
    if (String(card.type_code || '').toLowerCase() === 'resource') continue;

    const bucket = getCostBucket(card);
    if (!bucket) continue;
    const prev = histogram.get(bucket) || 0;
    histogram.set(bucket, prev + (Number(entry.count) || 0));
  }

  const buckets = Array.from(histogram.entries()).map(([label, count]) => ({ label, count }));
  buckets.sort((a, b) => compareCostBuckets(a.label, b.label));
  return buckets;
}

function compareCostBuckets(a, b) {
  const aNum = isNumericBucket(a) ? Number(a) : null;
  const bNum = isNumericBucket(b) ? Number(b) : null;
  if (aNum !== null && bNum !== null) return aNum - bNum;
  if (aNum !== null) return -1;
  if (bNum !== null) return 1;
  return String(a).localeCompare(String(b));
}

function isNumericBucket(value) {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function getCostBucket(card) {
  if (Number.isFinite(card?.cost)) return String(card.cost);
  if (card?.cost === 0) return '0';
  if (typeof card?.cost === 'string' && card.cost.trim()) return card.cost.trim().toUpperCase();
  return null;
}

function isIgnoredForDeckLimit(entry) {
  const annotations = entry?.annotations;
  const keywords = Array.isArray(annotations?.keywords) ? annotations.keywords : [];
  const isPermanent = Boolean(annotations?.permanent)
    || keywords.some(keyword => String(keyword).toLowerCase() === 'permanent');
  const ignoreDeckLimit = Boolean(annotations?.ignoreDeckLimit)
    || keywords.some(keyword => String(keyword).toLowerCase() === 'ignorefordecklimit');
  return isPermanent || ignoreDeckLimit;
}

function isPlayerDeckCard(card) {
  const type = String(card?.type_code || '').toLowerCase();
  return type === 'ally'
    || type === 'event'
    || type === 'upgrade'
    || type === 'support'
    || type === 'resource'
    || type === 'player_side_scheme';
}

function formatTextReport(report, options = {}) {
  const lines = [];
  lines.push(`Cards: ${report.totalCards}`);
  if (report.ignoredForDeckLimit) {
    lines.push(`Ignored for deck limit: ${report.ignoredForDeckLimit}`);
  }
  lines.push(`Allies: ${report.allies}`);

  const aspectParts = [];
  const aspectLabels = {
    aggression: 'Aggression',
    justice: 'Justice',
    leadership: 'Leadership',
    protection: 'Protection',
    basic: 'Basic',
    pool: 'Pool',
  };
  for (const code of Object.keys(aspectLabels)) {
    aspectParts.push(`${aspectLabels[code]}: ${Number(report.aspects?.[code]) || 0}`);
  }
  lines.push(`Aspects/basic: ${aspectParts.join(', ')}`);

  lines.push('');
  lines.push('Resource costs:');
  const width = Number.isFinite(options.barWidth) ? options.barWidth : 20;
  lines.push(renderAsciiBarChart(report.resourceCosts || [], { width }));
  lines.push('');
  return `${lines.join('\n')}\n`;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
