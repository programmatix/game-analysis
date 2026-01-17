#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { normalizeForSearch } = require('../../shared/text-utils');
const { loadCardDatabase } = require('./card-data');
const { getRecommendedModularSetCodesForVillainSet } = require('./pack-recommendations');

const HERO_KIT_TYPE_CODES = new Set(['hero', 'alter_ego', 'obligation'].map(normalizeForSearch));
const PLAYER_TYPE_CODES = new Set(
  ['ally', 'event', 'resource', 'support', 'upgrade', 'player_side_scheme'].map(normalizeForSearch)
);
const SCENARIO_TYPE_CODES = new Set(
  [
    'attachment',
    'environment',
    'evidence_means',
    'evidence_motive',
    'evidence_opportunity',
    'leader',
    'main_scheme',
    'minion',
    'side_scheme',
    'treachery',
    'villain',
  ].map(normalizeForSearch)
);

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
    .option(
      '--hero-specific',
      'Only output hero-specific cards (signature + obligation + nemesis); ignores --kind',
      false
    )
    .option(
      '--set <set>',
      'Only output cards from a specific card set within the pack (matches card_set_code or card_set_name); can be repeated',
      (value, previous) => (Array.isArray(previous) ? previous.concat([value]) : [value])
    )
    .option('--no-codes', 'Omit [code] suffixes in output')
    .option('--list-packs', 'List all packs found in the MarvelCDB data and exit', false)
    .option('--list-sets', 'List all card sets in the resolved pack and exit', false)
    .option(
      '--no-recommended-modular',
      'When outputting a scenario set, do not auto-include its recommended modular encounter set(s)'
    )
    .option('--data-cache <file>', 'Where to cache MarvelCDB cards JSON', path.join('.cache', 'marvelcdb-cards.json'))
    .option('--refresh-data', 'Re-download the MarvelCDB cards JSON into the cache', false)
    .option('--json', 'Output JSON instead of a deck list', false)
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride();

  try {
    program.parse(process.argv);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (
      error.code === 'commander.tooManyArguments' &&
      Array.isArray(process.argv) &&
      process.argv.includes('--')
    ) {
      console.error(
        [
          error.message,
          '',
          'Note: `--` ends option parsing, so everything after it is treated as extra positional arguments.',
          'Try:',
          '  npx marvel-pack next_evol --kind scenario --set juggernaut',
        ].join('\n')
      );
      process.exit(1);
    }
    throw err;
  }

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
  const sets = buildSetIndex(pack.cards);
  const heroSpecific = Boolean(options.heroSpecific);
  const kind = heroSpecific ? 'hero-specific' : normalizeKind(options.kind, pack.cards);
  const kindFiltered = heroSpecific ? filterHeroSpecificPackCards(pack.cards) : filterPackCards(pack.cards, kind);
  if (heroSpecific && kindFiltered.length === 0) {
    throw new Error(`No hero-specific cards were found in pack "${pack.code}" (${pack.name || 'unknown name'}).`);
  }

  if (options.listSets) {
    process.stdout.write(`${formatSetList(sets)}\n`);
    return;
  }

  const setQueries = Array.isArray(options.set) ? options.set.map(s => String(s || '').trim()).filter(Boolean) : [];
  const setFiltered = setQueries.length
    ? filterPackCardsBySets(kindFiltered, setQueries, sets, {
        includeRecommendedModular: Boolean(options.recommendedModular),
        kind,
      })
    : kindFiltered;
  if (setQueries.length && setFiltered.length === 0) {
    throw new Error(
      `No cards matched the requested set(s) (${setQueries.map(s => JSON.stringify(s)).join(', ')}) in pack "${pack.code}".`
    );
  }

  const canonical = canonicalizeByDuplicateCode(setFiltered);
  const faceCanonical = canonicalizeByFaceVariants(canonical);
  const entries = buildDeckEntries(faceCanonical, { includeCodes: Boolean(options.codes) });

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
    const hasPlayer = counts.heroKit > 0 || counts.player > 0;
    const hasScenario = counts.scenario > 0 || counts.other > 0;
    if (hasPlayer && hasScenario) return 'all';
    if (hasScenario) return 'scenario';
    if (hasPlayer) return 'hero';
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

function filterHeroSpecificPackCards(cards) {
  return (Array.isArray(cards) ? cards : []).filter(card => {
    const faction = normalizeForSearch(card?.faction_code || '');
    if (faction === 'hero') return true;

    const type = normalizeForSearch(card?.type_code || '');
    if (type === 'obligation') return true;

    const setCode = normalizeForSearch(card?.card_set_code || '');
    const setName = normalizeForSearch(card?.card_set_name || '');
    return (setCode && setCode.includes('nemesis')) || (setName && setName.includes('nemesis'));
  });
}

function buildSetIndex(packCards) {
  const sets = new Map();

  for (const card of Array.isArray(packCards) ? packCards : []) {
    const code = String(card?.card_set_code || '').trim();
    const name = String(card?.card_set_name || '').trim();
    if (!code && !name) continue;

    const key = `${code}||${name}`;
    const entry = sets.get(key) || { code, name, cards: [] };
    if (!entry.code && code) entry.code = code;
    if (!entry.name && name) entry.name = name;
    entry.cards.push(card);
    sets.set(key, entry);
  }

  return sets;
}

function resolveSet(query, sets) {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) {
    throw new Error('Set query is empty.');
  }

  const byCode = [];
  const byNameExact = [];
  const byNameIncludes = [];

  for (const set of sets.values()) {
    const setCode = normalizeForSearch(set.code);
    const setName = normalizeForSearch(set.name);

    if (setCode && setCode === normalizedQuery) byCode.push(set);
    if (setName && setName === normalizedQuery) byNameExact.push(set);
    if (setName && setName.includes(normalizedQuery)) byNameIncludes.push(set);
  }

  const candidates = byCode.length ? byCode : byNameExact.length ? byNameExact : byNameIncludes;
  if (candidates.length === 1) return candidates[0];

  if (candidates.length === 0) {
    const suggestions = bySimilarity(normalizedQuery, Array.from(sets.values()));
    const suggestionText = suggestions.length
      ? `\n\nDid you mean:\n${suggestions.map(set => `- ${set.code || '(no code)'} — ${set.name || '(unknown name)'}`).join('\n')}`
      : '';
    throw new Error(`No card set matched "${query}".${suggestionText}`);
  }

  const details = candidates
    .slice(0, 20)
    .map(set => `- ${set.code || '(no code)'} — ${set.name || '(unknown name)'}`)
    .join('\n');
  throw new Error(`Set "${query}" is ambiguous; choose one of:\n${details}`);
}

function filterPackCardsBySets(packCards, setQueries, sets, options = {}) {
  const kind = String(options.kind || '');
  const includeRecommendedModular = options.includeRecommendedModular !== false;

  const selected = resolveSetQueries(setQueries, sets);
  const expanded =
    includeRecommendedModular && kind === 'scenario'
      ? addRecommendedModularSets(selected, sets)
      : selected;

  const out = [];
  const seenCardCode = new Set();
  for (const set of expanded) {
    for (const card of Array.isArray(set.cards) ? set.cards : []) {
      const code = String(card?.code || '').trim();
      if (!code || seenCardCode.has(code)) continue;
      seenCardCode.add(code);
      out.push(card);
    }
  }

  return out;
}

function resolveSetQueries(setQueries, sets) {
  const selected = [];
  const seenSetKey = new Set();
  for (const query of Array.isArray(setQueries) ? setQueries : []) {
    const resolved = resolveSet(query, sets);
    const key = `${String(resolved.code || '').trim()}||${String(resolved.name || '').trim()}`;
    if (seenSetKey.has(key)) continue;
    seenSetKey.add(key);
    selected.push(resolved);
  }

  return selected;
}

function getSetTypeCode(set) {
  const first = Array.isArray(set?.cards) ? set.cards[0] : null;
  return normalizeForSearch(first?.card_set_type_name_code || '');
}

function addRecommendedModularSets(selectedSets, sets) {
  const out = [];
  const selectedCodes = new Set(
    (Array.isArray(selectedSets) ? selectedSets : [])
      .map(set => normalizeForSearch(set?.code || ''))
      .filter(Boolean)
  );

  const hasAnyModular = (Array.isArray(selectedSets) ? selectedSets : []).some(set => getSetTypeCode(set) === 'modular');

  for (const set of Array.isArray(selectedSets) ? selectedSets : []) {
    out.push(set);

    // If the user explicitly requested a modular set, don't auto-add any.
    if (hasAnyModular) continue;

    if (getSetTypeCode(set) !== 'villain') continue;

    const setCode = normalizeForSearch(set?.code || '');
    for (const recommendedCode of getRecommendedModularSetCodesForVillainSet(setCode)) {
      const normalizedRecommended = normalizeForSearch(recommendedCode);
      if (!normalizedRecommended || selectedCodes.has(normalizedRecommended)) continue;

      try {
        const resolved = resolveSet(recommendedCode, sets);
        out.push(resolved);
        selectedCodes.add(normalizedRecommended);
      } catch (err) {
        // Ignore missing/ambiguous recommendations; they are curated and should
        // not break normal pack output if the upstream data changes.
      }
    }
  }

  return out;
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

function canonicalizeByFaceVariants(packCards) {
  const cards = Array.isArray(packCards) ? packCards : [];

  const variantsByRoot = new Map(); // root -> { hasA: bool, hasBase: bool }
  for (const card of cards) {
    const code = String(card?.code || '').trim();
    const match = /^(\d+)([a-z]?)$/i.exec(code);
    if (!match) continue;
    const root = match[1];
    const suffix = match[2].toLowerCase();
    if (suffix !== '' && suffix !== 'a' && suffix !== 'b') continue;

    const entry = variantsByRoot.get(root) || { hasA: false, hasBase: false };
    if (suffix === 'a') entry.hasA = true;
    if (suffix === '') entry.hasBase = true;
    variantsByRoot.set(root, entry);
  }

  const out = [];
  const keptAForRoot = new Set();
  for (const card of cards) {
    const code = String(card?.code || '').trim();
    const match = /^(\d+)([a-z]?)$/i.exec(code);
    if (!match) {
      out.push(card);
      continue;
    }

    const root = match[1];
    const suffix = match[2].toLowerCase();
    const variants = variantsByRoot.get(root);
    const shouldPreferA = Boolean(variants?.hasA && variants?.hasBase);

    if (!shouldPreferA) {
      out.push(card);
      continue;
    }

    if (suffix === 'a') {
      if (keptAForRoot.has(root)) continue;
      keptAForRoot.add(root);
      out.push(card);
      continue;
    }

    if (suffix === '' || suffix === 'b') {
      continue;
    }

    out.push(card);
  }

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

function formatSetList(sets) {
  const list = Array.from(sets.values());
  list.sort((a, b) => {
    const nameA = normalizeForSearch(a.name || '');
    const nameB = normalizeForSearch(b.name || '');
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return normalizeForSearch(a.code).localeCompare(normalizeForSearch(b.code), 'en', { numeric: true });
  });

  return list
    .map(set => {
      const code = String(set.code || '').trim();
      const name = String(set.name || '').trim();
      const count = Array.isArray(set.cards) ? set.cards.length : 0;
      return `${code || '(no code)'} — ${name || '(unknown name)'} | cards:${count}`;
    })
    .join('\n');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
