#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { normalizeForSearch } = require('../../shared/text-utils');
const { loadCardDatabase } = require('./card-data');

const HERO_KIT_TYPE_CODES = new Set(['hero', 'alter_ego', 'obligation']);
const PLAYER_TYPE_CODES = new Set(['ally', 'event', 'resource', 'support', 'upgrade', 'player_side_scheme']);
const SCENARIO_TYPE_CODES = new Set(['attachment', 'environment', 'minion', 'side_scheme', 'treachery']);

async function main() {
  const program = new Command();
  program
    .name('marvel-pack')
    .description('Generate a deck list for a Marvel Champions pack (hero/scenario)')
    .argument('[pack]', 'Pack code or name (e.g. "core" or "Green Goblin")')
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .option(
      '--kind <kind>',
      'Deck kind: auto|hero|scenario|all (auto infers hero vs scenario)',
      'auto'
    )
    .option('--no-codes', 'Omit [code] suffixes in output')
    .option('--list-packs', 'List all packs found in the MarvelCDB data and exit', false)
    .option('--data-cache <file>', 'Where to cache MarvelCDB cards JSON', path.join('.cache', 'marvelcdb-cards.json'))
    .option('--refresh-data', 'Re-download the MarvelCDB cards JSON into the cache', false)
    .option('--json', 'Output JSON instead of a deck list', false)
    .parse(process.argv);

  const options = program.opts();

  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: Boolean(options.refreshData),
  });

  const packs = buildPackIndex(cards);

  if (options.listPacks) {
    process.stdout.write(`${formatPackList(packs)}\n`);
    return;
  }

  const packQuery = String(program.args[0] || '').trim();
  if (!packQuery) {
    throw new Error('Pack is required (or use --list-packs).');
  }

  const pack = resolvePack(packQuery, packs);
  const kind = normalizeKind(options.kind, pack.cards);
  const filtered = filterPackCards(pack.cards, kind);
  const canonical = canonicalizeByDuplicateCode(filtered);
  const entries = buildDeckEntries(canonical, { includeCodes: Boolean(options.codes) });

  const outputText = options.json
    ? JSON.stringify({ pack: { code: pack.code, name: pack.name }, kind, entries }, null, 2)
    : `${formatDeckEntries(entries)}\n`;

  if (options.output) {
    const outPath = path.resolve(options.output);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, outputText);
    console.log(`Wrote pack deck list to ${outPath}`);
    return;
  }

  process.stdout.write(outputText);
}

function normalizeKind(raw, packCards) {
  const kind = normalizeForSearch(raw);
  if (!kind || kind === 'auto') {
    const counts = countPackKinds(packCards);
    if (counts.heroKit > 0) return 'hero';
    if (counts.scenario > 0 && counts.scenario >= counts.player) return 'scenario';
    if (counts.player > 0) return 'hero';
    return 'all';
  }

  if (kind === 'hero' || kind === 'scenario' || kind === 'all') return kind;
  throw new Error('--kind must be one of: auto, hero, scenario, all');
}

function countPackKinds(packCards) {
  const counts = { heroKit: 0, player: 0, scenario: 0, other: 0 };

  for (const card of Array.isArray(packCards) ? packCards : []) {
    const type = normalizeForSearch(card?.type_code || '');
    if (!type) continue;
    if (HERO_KIT_TYPE_CODES.has(type)) counts.heroKit += 1;
    else if (PLAYER_TYPE_CODES.has(type)) counts.player += 1;
    else if (SCENARIO_TYPE_CODES.has(type)) counts.scenario += 1;
    else counts.other += 1;
  }

  return counts;
}

function filterPackCards(cards, kind) {
  if (kind === 'all') return Array.isArray(cards) ? cards.slice() : [];

  const allowed = new Set();
  if (kind === 'hero') {
    for (const value of HERO_KIT_TYPE_CODES) allowed.add(value);
    for (const value of PLAYER_TYPE_CODES) allowed.add(value);
  } else if (kind === 'scenario') {
    for (const value of SCENARIO_TYPE_CODES) allowed.add(value);
  }

  return (Array.isArray(cards) ? cards : []).filter(card => allowed.has(normalizeForSearch(card?.type_code || '')));
}

function buildPackIndex(cards) {
  const packs = new Map();

  for (const card of Array.isArray(cards) ? cards : []) {
    const code = String(card?.pack_code || '').trim();
    if (!code) continue;

    const name = String(card?.pack_name || '').trim();
    const entry = packs.get(code) || { code, name, cards: [] };
    if (!entry.name && name) entry.name = name;
    entry.cards.push(card);
    packs.set(code, entry);
  }

  return packs;
}

function resolvePack(query, packs) {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) {
    throw new Error('Pack query is empty.');
  }

  const byCode = [];
  const byNameExact = [];
  const byNameIncludes = [];

  for (const pack of packs.values()) {
    const packCode = normalizeForSearch(pack.code);
    const packName = normalizeForSearch(pack.name);

    if (packCode === normalizedQuery) byCode.push(pack);
    if (packName === normalizedQuery) byNameExact.push(pack);
    if (packName && packName.includes(normalizedQuery)) byNameIncludes.push(pack);
  }

  const candidates = byCode.length ? byCode : byNameExact.length ? byNameExact : byNameIncludes;
  if (candidates.length === 1) return candidates[0];

  if (candidates.length === 0) {
    const suggestions = bySimilarity(normalizedQuery, Array.from(packs.values()));
    const suggestionText = suggestions.length
      ? `\n\nDid you mean:\n${suggestions.map(pack => `- ${pack.code} — ${pack.name || '(unknown name)'}`).join('\n')}`
      : '';
    throw new Error(`No pack matched "${query}".${suggestionText}`);
  }

  const details = candidates
    .slice(0, 20)
    .map(pack => `- ${pack.code} — ${pack.name || '(unknown name)'}`)
    .join('\n');
  throw new Error(`Pack "${query}" is ambiguous; choose one of:\n${details}`);
}

function bySimilarity(normalizedQuery, packs) {
  const scored = packs
    .map(pack => {
      const haystack = `${normalizeForSearch(pack.code)} ${normalizeForSearch(pack.name)}`.trim();
      const score = scoreQueryMatch(haystack, normalizedQuery);
      return { pack, score };
    })
    .filter(item => item.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10).map(item => item.pack);
}

function scoreQueryMatch(haystack, needle) {
  if (!haystack || !needle) return 0;
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 200;
  if (haystack.includes(needle)) return 100;

  const terms = needle.split(' ').filter(Boolean);
  if (!terms.length) return 0;
  const hits = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
  return hits ? hits * 10 : 0;
}

function canonicalizeByDuplicateCode(packCards) {
  const codeIndex = new Map();
  for (const card of Array.isArray(packCards) ? packCards : []) {
    const code = String(card?.code || '').trim();
    if (code) codeIndex.set(code, card);
  }

  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(packCards) ? packCards : []) {
    const rawCode = String(raw?.code || '').trim();
    if (!rawCode) continue;

    const dup = String(raw?.duplicate_of_code || '').trim();
    const canonical = dup ? codeIndex.get(dup) || raw : raw;
    const canonicalCode = String(canonical?.code || '').trim();
    if (!canonicalCode || seen.has(canonicalCode)) continue;
    seen.add(canonicalCode);
    out.push(canonical);
  }

  out.sort((a, b) => {
    const posA = Number.isFinite(a?.position) ? Number(a.position) : Number.POSITIVE_INFINITY;
    const posB = Number.isFinite(b?.position) ? Number(b.position) : Number.POSITIVE_INFINITY;
    if (posA !== posB) return posA - posB;

    const nameA = normalizeForSearch(a?.name || a?.real_name || '');
    const nameB = normalizeForSearch(b?.name || b?.real_name || '');
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return String(a?.code || '').localeCompare(String(b?.code || ''), 'en', { numeric: true });
  });

  return out;
}

function buildDeckEntries(cards, options = {}) {
  const includeCodes = options.includeCodes !== false;
  return (Array.isArray(cards) ? cards : [])
    .map(card => {
      const count = Number(card?.quantity) || 0;
      const name = String(card?.name || card?.real_name || '').trim();
      const code = String(card?.code || '').trim();
      if (!count || !name) return null;
      return { count, name, code: includeCodes ? code : '' };
    })
    .filter(Boolean);
}

function formatDeckEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(entry => {
      const base = `${entry.count} ${entry.name}`.trim();
      if (entry.code) return `${base}[${entry.code}]`;
      return base;
    })
    .join('\n');
}

function formatPackList(packs) {
  const list = Array.from(packs.values());
  list.sort((a, b) => {
    const nameA = normalizeForSearch(a.name || '');
    const nameB = normalizeForSearch(b.name || '');
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return normalizeForSearch(a.code).localeCompare(normalizeForSearch(b.code), 'en', { numeric: true });
  });

  return list
    .map(pack => {
      const counts = countPackKinds(pack.cards);
      const parts = [
        `${pack.code} — ${pack.name || '(unknown name)'}`,
        counts.heroKit ? `heroKit:${counts.heroKit}` : null,
        counts.player ? `player:${counts.player}` : null,
        counts.scenario ? `scenario:${counts.scenario}` : null,
      ].filter(Boolean);
      return parts.join(' | ');
    })
    .join('\n');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
