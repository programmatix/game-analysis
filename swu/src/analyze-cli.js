#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { readDeckText, hasCardEntries } = require('../../shared/deck-utils');
const { renderAsciiBarChart } = require('../../shared/ascii-chart');
const { parseSwuDeckList } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

async function main() {
  const program = new Command();
  program
    .name('swu-analyze')
    .description('Analyze Star Wars: Unlimited deck lists (counts, aspects, types, and cost curves)')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('--data-file <file>', 'Additional card data JSON file to merge into the built-in database')
    .option('--bar-width <number>', 'Width of the ASCII bars', '20')
    .option('--json', 'Output JSON instead of text', false)
    .parse(process.argv);

  const options = program.opts();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const deckEntries = parseSwuDeckList(deckText, {
    baseDir: deckBaseDir,
    sourcePath: options.input ? path.resolve(options.input) : '<stdin>',
  });
  if (!hasCardEntries(deckEntries)) {
    throw new Error('No valid deck entries were found.');
  }

  const cards = await loadCardDatabase({ dataFile: options.dataFile ? path.resolve(options.dataFile) : null });
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

  const leader = pickIdentityCard(resolved, 'leader');
  const base = pickIdentityCard(resolved, 'base');
  const identityAspects = computeIdentityAspects(leader, base);

  const mainDeckTotals = computeSectionTotals(resolved, new Set(['deck', 'other']));
  const sideboardTotals = computeSectionTotals(resolved, new Set(['sideboard']));

  const typeCounts = computeTypeCounts(resolved, new Set(['deck', 'other']));
  const aspectCounts = computeAspectCounts(resolved, new Set(['deck', 'other']));
  const costCurve = computeCostCurve(resolved, new Set(['deck', 'other']));
  const offAspect = computeOffAspectStats(resolved, identityAspects, new Set(['deck', 'other']));

  const output = {
    leader: leader ? formatCardIdentity(leader) : null,
    base: base ? formatCardIdentity(base) : null,
    identityAspects: Array.from(identityAspects).sort(),
    totals: {
      mainDeckCards: mainDeckTotals.totalCards,
      sideboardCards: sideboardTotals.totalCards,
    },
    offAspect,
    types: typeCounts,
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

function pickIdentityCard(entries, section) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (entry.section !== section) continue;
    return entry.resolved || null;
  }

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    const card = entry.resolved;
    const type = String(card?.type || '').trim().toLowerCase();
    if (type !== section) continue;
    return card;
  }

  return null;
}

function computeIdentityAspects(leader, base) {
  const aspects = new Set();
  for (const card of [leader, base]) {
    for (const aspect of Array.isArray(card?.aspects) ? card.aspects : []) {
      const normalized = String(aspect || '').trim().toLowerCase();
      if (normalized) aspects.add(normalized);
    }
  }
  return aspects;
}

function computeSectionTotals(entries, sections) {
  let totalCards = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (!sections.has(entry.section || 'other')) continue;
    totalCards += Number(entry.count) || 0;
  }
  return { totalCards };
}

function computeTypeCounts(entries, sections) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (!sections.has(entry.section || 'other')) continue;
    const card = entry.resolved;
    const type = String(card?.type || '').trim().toLowerCase();
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + (Number(entry.count) || 0));
  }

  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function computeAspectCounts(entries, sections) {
  const counts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (!sections.has(entry.section || 'other')) continue;
    const card = entry.resolved;
    const aspects = Array.isArray(card?.aspects) ? card.aspects : [];
    const count = Number(entry.count) || 0;
    for (const aspect of aspects) {
      const key = String(aspect || '').trim().toLowerCase();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + count);
    }
  }

  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function computeCostCurve(entries, sections) {
  const histogram = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (!sections.has(entry.section || 'other')) continue;
    const card = entry.resolved;
    const type = String(card?.type || '').trim().toLowerCase();
    if (!type || type === 'leader' || type === 'base') continue;

    const cost = Number(card?.cost);
    if (!Number.isFinite(cost)) continue;
    const bucket = String(cost);
    histogram.set(bucket, (histogram.get(bucket) || 0) + (Number(entry.count) || 0));
  }

  const buckets = Array.from(histogram.entries()).map(([label, count]) => ({ label, count }));
  buckets.sort((a, b) => Number(a.label) - Number(b.label));
  return buckets;
}

function computeOffAspectStats(entries, identityAspects, sections) {
  const identity = identityAspects instanceof Set ? identityAspects : new Set();
  let offAspectCopies = 0;
  let offAspectUnique = 0;
  let totalPenalty = 0;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.proxyPageBreak) continue;
    if (!sections.has(entry.section || 'other')) continue;
    const card = entry.resolved;
    if (!card) continue;
    const aspects = Array.isArray(card.aspects) ? card.aspects.map(a => String(a || '').trim().toLowerCase()).filter(Boolean) : [];
    if (!aspects.length) continue;

    const mismatch = aspects.filter(aspect => !identity.has(aspect)).length;
    if (mismatch <= 0) continue;

    const copies = Number(entry.count) || 0;
    offAspectCopies += copies;
    offAspectUnique += 1;
    totalPenalty += mismatch * 2 * copies;
  }

  return {
    offAspectCopies,
    offAspectUniqueCards: offAspectUnique,
    totalAspectPenalty: totalPenalty,
  };
}

function formatCardIdentity(card) {
  if (!card) return null;
  return {
    code: card.code || null,
    name: card.fullName || card.name || null,
  };
}

function formatTextReport(report, options = {}) {
  const lines = [];

  if (report.leader?.name) lines.push(`Leader: ${report.leader.name}${report.leader.code ? ` [${report.leader.code}]` : ''}`);
  if (report.base?.name) lines.push(`Base: ${report.base.name}${report.base.code ? ` [${report.base.code}]` : ''}`);
  if (Array.isArray(report.identityAspects) && report.identityAspects.length) {
    lines.push(`Identity aspects: ${report.identityAspects.join(', ')}`);
  }

  lines.push(`Main deck cards: ${Number(report.totals?.mainDeckCards) || 0}`);
  if (Number(report.totals?.sideboardCards) > 0) {
    lines.push(`Sideboard cards: ${Number(report.totals?.sideboardCards) || 0}`);
  }

  if (report.offAspect) {
    lines.push(
      `Off-aspect: ${report.offAspect.offAspectCopies || 0} copies (${report.offAspect.offAspectUniqueCards || 0} unique), total penalty ${report.offAspect.totalAspectPenalty || 0}`
    );
  }

  lines.push('');

  if (report.types && Object.keys(report.types).length) {
    lines.push('Types:');
    for (const [key, value] of Object.entries(report.types)) {
      lines.push(`- ${key}: ${value}`);
    }
    lines.push('');
  }

  if (report.aspects && Object.keys(report.aspects).length) {
    lines.push('Aspects:');
    for (const [key, value] of Object.entries(report.aspects)) {
      lines.push(`- ${key}: ${value}`);
    }
    lines.push('');
  }

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
