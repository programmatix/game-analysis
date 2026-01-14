#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { readDeckText, hasCardEntries } = require('../../shared/deck-utils');
const { renderAsciiBarChart } = require('../../shared/ascii-chart');
const { parseLotrDeckList } = require('./decklist');
const { DEFAULT_BASE_URL, loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

const DEFAULT_DATA_CACHE = path.join(__dirname, '..', '.cache', 'ringsdb-cards.json');

async function main() {
  const program = new Command();
  program
    .name('lotr-analyze')
    .description('Analyze LOTR LCG deck lists (heroes, spheres, types, and cost curve)')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('--base-url <url>', 'RingsDB base URL', DEFAULT_BASE_URL)
    .option('--data-cache <file>', 'Where to cache RingsDB cards JSON', DEFAULT_DATA_CACHE)
    .option('--refresh-data', 'Re-download the RingsDB cards JSON into the cache', false)
    .option('--bar-width <number>', 'Width of the ASCII bars', '20')
    .option('--json', 'Output JSON instead of text', false)
    .parse(process.argv);

  const options = program.opts();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const deckEntries = parseLotrDeckList(deckText, {
    baseDir: deckBaseDir,
    sourcePath: options.input ? path.resolve(options.input) : '<stdin>',
  });
  if (!hasCardEntries(deckEntries)) {
    throw new Error('No valid deck entries were found.');
  }

  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const cards = await loadCardDatabase({
    baseUrl,
    cachePath: options.dataCache ? path.resolve(options.dataCache) : DEFAULT_DATA_CACHE,
    refresh: Boolean(options.refreshData),
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

  const heroes = pickHeroes(resolved);
  const startingThreat = heroes.reduce((sum, hero) => sum + (Number(hero?.threat) || 0), 0);
  const totals = computeDeckTotals(resolved);
  const spheres = computeSphereCounts(resolved);
  const types = computeTypeCounts(resolved);
  const costCurve = computeCostCurve(resolved);

  const output = {
    heroes: heroes.map(formatHero),
    startingThreat,
    totals,
    spheres,
    types,
    costs: costCurve,
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

function pickHeroes(entries) {
  const heroes = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (entry.section !== 'heroes') continue;
    if (entry.resolved) heroes.push(entry.resolved);
  }

  if (heroes.length) return heroes;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    const card = entry.resolved;
    if (String(card?.type || '').toLowerCase() !== 'hero') continue;
    if (card) heroes.push(card);
  }

  return heroes;
}

function computeDeckTotals(entries) {
  let heroCards = 0;
  let mainDeckCards = 0;
  let sideboardCards = 0;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    const count = Number(entry.count) || 0;
    if (entry.section === 'heroes') {
      heroCards += count;
    } else if (entry.section === 'sideboard') {
      sideboardCards += count;
    } else {
      mainDeckCards += count;
    }
  }

  return { heroCards, mainDeckCards, sideboardCards };
}

function computeSphereCounts(entries) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (entry.section === 'heroes' || entry.section === 'sideboard') continue;
    const card = entry.resolved;
    const sphere = String(card?.sphere || '').trim().toLowerCase();
    if (!sphere) continue;
    counts.set(sphere, (counts.get(sphere) || 0) + (Number(entry.count) || 0));
  }

  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function computeTypeCounts(entries) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (entry.section === 'sideboard') continue;
    const card = entry.resolved;
    const type = String(card?.type || '').trim().toLowerCase();
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + (Number(entry.count) || 0));
  }

  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function computeCostCurve(entries) {
  const histogram = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (entry.section === 'heroes' || entry.section === 'sideboard') continue;
    const card = entry.resolved;
    const cost = Number(card?.cost);
    if (!Number.isFinite(cost)) continue;
    const bucket = String(cost);
    histogram.set(bucket, (histogram.get(bucket) || 0) + (Number(entry.count) || 0));
  }

  const buckets = Array.from(histogram.entries()).map(([label, count]) => ({ label, count }));
  buckets.sort((a, b) => Number(a.label) - Number(b.label));
  return buckets;
}

function formatHero(card) {
  if (!card) return null;
  return {
    code: card.code || null,
    name: card.fullName || card.name || null,
    sphere: card.sphere || null,
    threat: Number.isFinite(card.threat) ? card.threat : null,
  };
}

function formatTextReport(report, options = {}) {
  const barWidth = Number(options.barWidth) || 20;
  const lines = [];

  if (Array.isArray(report.heroes) && report.heroes.length) {
    lines.push('Heroes:');
    for (const hero of report.heroes) {
      if (!hero) continue;
      const tags = [hero.sphere, Number.isFinite(hero.threat) ? `threat ${hero.threat}` : null].filter(Boolean).join(', ');
      lines.push(`- ${hero.name || '(unknown)'}${hero.code ? ` [${hero.code}]` : ''}${tags ? ` (${tags})` : ''}`);
    }
    if (Number.isFinite(report.startingThreat)) {
      lines.push(`Starting threat: ${report.startingThreat}`);
    }
    lines.push('');
  }

  lines.push(`Main deck cards: ${Number(report.totals?.mainDeckCards) || 0}`);
  if (Number(report.totals?.sideboardCards) > 0) {
    lines.push(`Sideboard cards: ${Number(report.totals?.sideboardCards) || 0}`);
  }
  lines.push('');

  if (report.types && Object.keys(report.types).length) {
    lines.push('Types:');
    for (const [key, value] of Object.entries(report.types)) {
      lines.push(`- ${key}: ${value}`);
    }
    lines.push('');
  }

  if (report.spheres && Object.keys(report.spheres).length) {
    lines.push('Spheres:');
    for (const [key, value] of Object.entries(report.spheres)) {
      lines.push(`- ${key}: ${value}`);
    }
    lines.push('');
  }

  if (Array.isArray(report.costs) && report.costs.length) {
    lines.push('Cost curve:');
    lines.push(renderAsciiBarChart(report.costs, { width: barWidth }));
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
