#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { normalizeForSearch } = require('../../shared/text-utils');
const { loadCardDatabase } = require('./card-data');
const { ANNOTATION_PREFIX, buildCardComment } = require('./annotation-format');

const SUPPORTED_TYPES = ['leader', 'base', 'unit', 'event', 'upgrade'];
const SUPPORTED_ARENAS = ['ground', 'space'];

async function main() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', err => {
      if (err && err.code === 'EPIPE') process.exit(0);
    });
  }

  const program = new Command();
  program
    .name('swu-search')
    .description('Search Star Wars: Unlimited cards (name/text/traits/aspects/type/set)')
    .argument('[query...]', 'Search terms (default: match name and rules text)')
    .option('--data-file <file>', 'Additional card data JSON file to merge into the built-in database')
    .option('--in <scope>', 'Search scope: name|text|traits|all', 'all')
    .option('--type <type>', 'Filter by type (leader|base|unit|event|upgrade)')
    .option('--aspect <aspect>', 'Filter by aspect (e.g. vigilance, command, aggression, cunning, heroism, villainy)')
    .option('--set <set>', 'Filter by set code (e.g. SOR)')
    .option('--arena <arena>', 'Filter by arena (ground|space)')
    .option('--rarity <rarity>', 'Filter by rarity (e.g. C, U, R, L)')
    .option('--cost <number>', 'Filter by cost (e.g. 2, 2-, 2+)')
    .option('--code <code>', 'Filter by exact card code (e.g. SOR-001)')
    .option('--sort <mode>', 'Sort results by: cost|name', 'cost')
    .option('--limit <number>', 'Max results to print (0 = no limit)', '25')
    .option('--json', 'Output JSON instead of a formatted list', false)
    .option('--annotate', 'Output deck-style entries with //? annotations', false)
    .addHelpText('after', `\nSupported --type values:\n  ${SUPPORTED_TYPES.join(', ')}\n`)
    .parse(process.argv);

  const options = program.opts();
  if (options.json && options.annotate) {
    throw new Error('Use only one of --json or --annotate');
  }

  const query = buildQuery(program.args);
  const cards = await loadCardDatabase({ dataFile: options.dataFile ? path.resolve(options.dataFile) : null });

  const filters = parseFilters(options);
  const scope = normalizeScope(options.in);
  const sortMode = normalizeSort(options.sort);
  const results = searchCards(cards, { query, scope, filters, sortMode });
  const limit = parseLimit(options.limit);
  const toPrint = limit === null ? results : results.slice(0, limit);

  if (Boolean(options.json)) {
    process.stdout.write(`${JSON.stringify(toPrint, null, 2)}\n`);
  } else if (Boolean(options.annotate)) {
    for (const card of toPrint) {
      process.stdout.write(`${formatDeckEntryLine(card)}\n`);
      process.stdout.write(`${ANNOTATION_PREFIX}${buildCardComment(card)}\n`);
    }
  } else {
    for (const card of toPrint) {
      process.stdout.write(`${formatCardLine(card)}\n`);
    }
  }

  if (limit !== null && results.length > limit) {
    process.stderr.write(`Showing ${limit} of ${results.length} matches (use --limit 0 for all).\n`);
  }
}

function buildQuery(args) {
  if (!Array.isArray(args) || args.length === 0) return '';
  return args.join(' ').trim();
}

function normalizeScope(raw) {
  const scope = normalizeForSearch(raw);
  if (scope === 'name' || scope === 'text' || scope === 'traits' || scope === 'all') return scope;
  throw new Error('--in must be one of: name, text, traits, all');
}

function normalizeSort(raw) {
  const sort = normalizeForSearch(raw);
  if (sort === 'cost' || sort === 'name') return sort;
  throw new Error('--sort must be one of: cost, name');
}

function parseLimit(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('--limit must be a non-negative integer (0 = no limit)');
  }
  return value === 0 ? null : value;
}

function parseCostFilter(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const match = /^(\d+(?:\.\d+)?)([+-])?$/.exec(trimmed);
  if (!match) {
    throw new Error(`--cost must be like "2", "2-", or "2+" (got "${raw}")`);
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`--cost must be a number (got "${raw}")`);
  }

  const suffix = match[2];
  if (suffix === '+') return { op: 'gte', value };
  if (suffix === '-') return { op: 'lte', value };
  return { op: 'eq', value };
}

function parseFilters(options) {
  const filterText = value => (value ? normalizeForSearch(value) : '');

  const code = options.code ? String(options.code).trim().toUpperCase() : '';
  if (options.code && !code) {
    throw new Error('--code cannot be empty');
  }

  const arena = filterText(options.arena);
  if (arena && !SUPPORTED_ARENAS.includes(arena)) {
    throw new Error(`--arena must be one of: ${SUPPORTED_ARENAS.join(', ')}`);
  }

  const type = filterText(options.type);
  if (type && !SUPPORTED_TYPES.includes(type)) {
    throw new Error(`--type must be one of: ${SUPPORTED_TYPES.join(', ')}`);
  }

  const rarity = options.rarity ? String(options.rarity).trim().toUpperCase() : '';

  return {
    code,
    type,
    aspect: filterText(options.aspect),
    set: options.set ? String(options.set).trim().toUpperCase() : '',
    arena,
    rarity,
    cost: parseCostFilter(options.cost),
  };
}

function searchCards(cards, options) {
  const { query = '', scope = 'all', filters = {}, sortMode = 'cost' } = options || {};
  const normalizedQuery = normalizeForSearch(query);
  const terms = normalizedQuery ? normalizedQuery.split(' ') : [];

  const canonical = canonicalizeCards(cards);
  const filtered = canonical.filter(card => matchesFilters(card, filters));
  const searched = terms.length ? filtered.filter(card => matchesQuery(card, terms, scope)) : filtered;

  searched.sort((a, b) => {
    if (sortMode === 'cost') {
      const costA = parseSortCost(a);
      const costB = parseSortCost(b);
      if (costA !== costB) return costA - costB;
    }

    const nameA = normalizeForSearch(a?.fullName || a?.name || '');
    const nameB = normalizeForSearch(b?.fullName || b?.name || '');
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return String(a?.code || '').localeCompare(String(b?.code || ''), 'en', { numeric: true });
  });

  return searched;
}

function parseSortCost(card) {
  const cost = Number(card?.cost);
  return Number.isFinite(cost) ? cost : Number.POSITIVE_INFINITY;
}

function matchesFilters(card, filters) {
  if (!card) return false;

  if (filters.code) {
    if (String(card.code || '').trim().toUpperCase() !== filters.code) return false;
  }

  if (filters.set) {
    if (String(card.set || '').trim().toUpperCase() !== filters.set) return false;
  }

  if (filters.rarity) {
    if (String(card.rarity || '').trim().toUpperCase() !== filters.rarity) return false;
  }

  if (filters.cost !== null) {
    const cost = Number(card.cost);
    if (!Number.isFinite(cost)) return false;
    if (filters.cost.op === 'eq' && cost !== filters.cost.value) return false;
    if (filters.cost.op === 'lte' && cost > filters.cost.value) return false;
    if (filters.cost.op === 'gte' && cost < filters.cost.value) return false;
  }

  if (filters.type) {
    const type = normalizeForSearch(card.type || '');
    if (type !== filters.type) return false;
  }

  if (filters.arena) {
    const arena = normalizeForSearch(card.arena || '');
    if (arena !== filters.arena) return false;
  }

  if (filters.aspect) {
    const aspects = Array.isArray(card.aspects) ? card.aspects.map(value => normalizeForSearch(value)) : [];
    if (!aspects.some(value => value.includes(filters.aspect))) return false;
  }

  return true;
}

function matchesQuery(card, terms, scope) {
  const haystack = buildSearchText(card, scope);
  if (!haystack) return false;
  return terms.every(term => haystack.includes(term));
}

function buildSearchText(card, scope) {
  if (!card) return '';
  const parts = [];

  if (scope === 'name' || scope === 'all') {
    parts.push(card.fullName, card.name, card.title, card.code);
  }

  if (scope === 'text' || scope === 'all') {
    parts.push(card.textFront, card.textBack);
  }

  if (scope === 'traits' || scope === 'all') {
    if (Array.isArray(card.traits)) parts.push(card.traits.join(' '));
  }

  return normalizeForSearch(parts.filter(Boolean).join(' '));
}

function canonicalizeCards(cards) {
  const out = [];
  const seen = new Set();
  for (const card of Array.isArray(cards) ? cards : []) {
    const code = card?.code ? String(card.code).trim() : '';
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(card);
  }
  return out;
}

function formatCardLine(card) {
  const code = String(card?.code || '').trim();
  const label = String(card?.fullName || card?.name || '').trim();
  const type = String(card?.type || '').trim();
  const aspects = Array.isArray(card?.aspects) ? card.aspects.join('/') : '';
  const arena = String(card?.arena || '').trim();
  const cost = Number.isFinite(card?.cost) ? String(card.cost) : '';
  const rarity = String(card?.rarity || '').trim();

  const meta = [];
  if (type) meta.push(type);
  if (aspects) meta.push(aspects);
  if (arena) meta.push(arena);
  if (cost) meta.push(`Cost ${cost}`);
  if (rarity) meta.push(rarity);

  const suffix = meta.length ? ` — ${meta.join(' — ')}` : '';
  return `${code || '(no code)'} ${label || '(no name)'}${suffix}`.trim();
}

function formatDeckEntryLine(card) {
  const code = String(card?.code || '').trim();
  const label = String(card?.fullName || card?.name || '').trim();

  const parts = ['1x', label || '(no name)'];
  if (code) parts.push(`[${code}]`);
  return parts.join(' ').trim();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

