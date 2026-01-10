#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { normalizeForSearch } = require('../../shared/text-utils');
const { loadCardDatabase } = require('./card-data');

async function main() {
  const program = new Command();
  program
    .name('swu-pack')
    .description('Generate a deck list for a Star Wars: Unlimited set (useful for proxying an entire set/type)')
    .argument('[set]', 'Set code (e.g. "SOR")')
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .option('--data-file <file>', 'Additional card data JSON file to merge into the built-in database')
    .option('--type <type>', 'Filter by type (leader|base|unit|event|upgrade)')
    .option('--rarity <rarity>', 'Filter by rarity (e.g. C, U, R, L)')
    .option('--no-codes', 'Omit [code] suffixes in output')
    .option('--list-sets', 'List all sets found in the loaded database and exit', false)
    .option('--json', 'Output JSON instead of a deck list', false)
    .parse(process.argv);

  const options = program.opts();
  const cards = await loadCardDatabase({ dataFile: options.dataFile ? path.resolve(options.dataFile) : null });

  const sets = buildSetIndex(cards);
  if (options.listSets) {
    process.stdout.write(`${formatSetList(sets)}\n`);
    return;
  }

  const setQuery = String(program.args[0] || '').trim();
  if (!setQuery) {
    throw new Error('Set is required (or use --list-sets).');
  }

  const set = resolveSet(setQuery, sets);
  const filtered = filterCards(set.cards, options);
  const canonical = canonicalizeByCode(filtered);
  const entries = buildDeckEntries(canonical, { includeCodes: Boolean(options.codes) });

  const outputText = options.json
    ? JSON.stringify({ set: { code: set.code }, entries }, null, 2)
    : `${formatDeckEntries(entries)}\n`;

  if (options.output) {
    const outPath = path.resolve(options.output);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, outputText);
    console.log(`Wrote set deck list to ${outPath}`);
    return;
  }

  process.stdout.write(outputText);
}

function buildSetIndex(cards) {
  const sets = new Map();

  for (const card of Array.isArray(cards) ? cards : []) {
    const code = String(card?.set || '').trim().toUpperCase();
    if (!code) continue;

    const entry = sets.get(code) || { code, cards: [] };
    entry.cards.push(card);
    sets.set(code, entry);
  }

  return sets;
}

function formatSetList(sets) {
  const codes = Array.from(sets.keys()).sort();
  if (!codes.length) return 'No sets found.';
  return codes.map(code => `- ${code}`).join('\n');
}

function resolveSet(query, sets) {
  const normalizedQuery = normalizeForSearch(query).toUpperCase();
  if (!normalizedQuery) {
    throw new Error('Set query is empty.');
  }

  const direct = sets.get(normalizedQuery);
  if (direct) return direct;

  const candidates = Array.from(sets.values()).filter(set => normalizeForSearch(set.code).includes(normalizedQuery));
  if (candidates.length === 1) return candidates[0];

  if (candidates.length === 0) {
    throw new Error(`No set matched "${query}".`);
  }

  const details = candidates.slice(0, 20).map(set => `- ${set.code}`).join('\n');
  throw new Error(`Set "${query}" is ambiguous; choose one of:\n${details}`);
}

function filterCards(cards, options) {
  const type = options.type ? normalizeForSearch(options.type) : '';
  const rarity = options.rarity ? String(options.rarity).trim().toUpperCase() : '';

  return (Array.isArray(cards) ? cards : []).filter(card => {
    if (type) {
      const cardType = normalizeForSearch(card?.type || '');
      if (cardType !== type) return false;
    }
    if (rarity) {
      if (String(card?.rarity || '').trim().toUpperCase() !== rarity) return false;
    }
    return true;
  });
}

function canonicalizeByCode(cards) {
  const out = [];
  const seen = new Set();
  for (const card of Array.isArray(cards) ? cards : []) {
    const code = String(card?.code || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(card);
  }
  out.sort((a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true }));
  return out;
}

function buildDeckEntries(cards, options = {}) {
  const includeCodes = options.includeCodes !== false;
  return (Array.isArray(cards) ? cards : []).map(card => ({
    count: 1,
    name: card.fullName || card.name || '(unknown)',
    code: includeCodes ? card.code : null,
  }));
}

function formatDeckEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(entry => {
      const count = Number(entry.count) || 0;
      const base = `${count} ${entry.name || ''}`.trim();
      const code = entry.code ? String(entry.code).trim() : '';
      return code ? `${base} [${code}]` : base;
    })
    .filter(Boolean)
    .join('\n');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

