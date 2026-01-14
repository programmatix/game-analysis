#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { normalizeForSearch } = require('../../shared/text-utils');
const { DEFAULT_BASE_URL, loadCardDatabase } = require('./card-data');
const { ANNOTATION_PREFIX, buildCardComment } = require('./annotation-format');

const DEFAULT_DATA_CACHE = path.join(__dirname, '..', '.cache', 'ringsdb-cards.json');

async function main() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', err => {
      if (err && err.code === 'EPIPE') process.exit(0);
    });
  }

  const program = new Command();
  program
    .name('lotr-search')
    .description('Search LOTR LCG cards (name/text/traits/sphere/type/pack)')
    .argument('[query...]', 'Search terms (default: match name and rules text)')
    .option('--base-url <url>', 'RingsDB base URL', DEFAULT_BASE_URL)
    .option('--data-cache <file>', 'Where to cache RingsDB cards JSON', DEFAULT_DATA_CACHE)
    .option('--refresh-data', 'Re-download the RingsDB cards JSON into the cache', false)
    .option('--in <scope>', 'Search scope: name|text|traits|all', 'all')
    .option('--type <type>', 'Filter by type (hero|ally|attachment|event|side_quest|contract)')
    .option('--sphere <sphere>', 'Filter by sphere (leadership|tactics|spirit|lore|neutral)')
    .option('--pack <pack>', 'Filter by pack code or a substring of the pack name')
    .option('--cost <number>', 'Filter by cost (e.g. 2, 2-, 2+)')
    .option('--code <code>', 'Filter by exact card code (e.g. 01073)')
    .option('--sort <mode>', 'Sort results by: cost|name', 'cost')
    .option('--limit <number>', 'Max results to print (0 = no limit)', '25')
    .option('--json', 'Output JSON instead of a formatted list', false)
    .option('--annotate', 'Output deck-style entries with //? annotations', false)
    .parse(process.argv);

  const options = program.opts();
  if (options.json && options.annotate) {
    throw new Error('Use only one of --json or --annotate');
  }

  const query = buildQuery(program.args);
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const cards = await loadCardDatabase({
    baseUrl,
    cachePath: options.dataCache ? path.resolve(options.dataCache) : DEFAULT_DATA_CACHE,
    refresh: Boolean(options.refreshData),
  });

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

  const code = options.code ? String(options.code).trim() : '';
  if (options.code && !code) {
    throw new Error('--code cannot be empty');
  }

  const packRaw = options.pack ? String(options.pack).trim() : '';
  const pack = packRaw ? packRaw.toLowerCase() : '';

  return {
    code,
    type: filterText(options.type),
    sphere: filterText(options.sphere),
    pack,
    cost: parseCostFilter(options.cost),
  };
}

function searchCards(cards, options) {
  const { query = '', scope = 'all', filters = {}, sortMode = 'cost' } = options || {};
  const normalizedQuery = normalizeForSearch(query);
  const terms = normalizedQuery ? normalizedQuery.split(' ') : [];

  const filtered = (Array.isArray(cards) ? cards : []).filter(card => matchesFilters(card, filters));
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
    if (String(card.code || '').trim() !== filters.code) return false;
  }

  if (filters.type) {
    const type = normalizeForSearch(card.type || '');
    if (type !== filters.type) return false;
  }

  if (filters.sphere) {
    const sphere = normalizeForSearch(card.sphere || '');
    if (sphere !== filters.sphere) return false;
  }

  if (filters.pack) {
    const packCode = String(card.pack_code || '').trim().toLowerCase();
    const packName = String(card.pack_name || '').trim().toLowerCase();
    const filter = filters.pack;
    if (packCode !== filter && !packName.includes(filter)) return false;
  }

  if (filters.cost !== null) {
    const cost = Number(card.cost);
    if (!Number.isFinite(cost)) return false;
    if (filters.cost.op === 'eq' && cost !== filters.cost.value) return false;
    if (filters.cost.op === 'lte' && cost > filters.cost.value) return false;
    if (filters.cost.op === 'gte' && cost < filters.cost.value) return false;
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
    parts.push(card.fullName, card.name, card.code, card.pack_name, card.pack_code);
  }

  if (scope === 'text' || scope === 'all') {
    parts.push(card.textFront);
  }

  if (scope === 'traits' || scope === 'all') {
    if (Array.isArray(card.traits)) parts.push(card.traits.join(' '));
  }

  if (scope === 'all') {
    parts.push(card.type, card.sphere);
  }

  return normalizeForSearch(parts.filter(Boolean).join(' '));
}

function formatCardLine(card) {
  const name = card?.fullName || card?.name || '(unknown)';
  const code = card?.code ? String(card.code).trim() : '';
  const type = card?.type ? String(card.type).trim() : '';
  const sphere = card?.sphere ? String(card.sphere).trim() : '';
  const cost = Number.isFinite(card?.cost) ? ` cost ${card.cost}` : '';
  const right = [type, sphere].filter(Boolean).join(' / ');
  return `${name}${code ? ` [${code}]` : ''}${right ? ` — ${right}` : ''}${cost}`;
}

function formatDeckEntryLine(card) {
  const name = card?.fullName || card?.name || '(unknown)';
  const code = card?.code ? String(card.code).trim() : '';
  return `1 ${name}${code ? ` [${code}]` : ''}`;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
