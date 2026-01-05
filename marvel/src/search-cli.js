#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { normalizeForSearch } = require('../../shared/text-utils');
const { loadCardDatabase } = require('./card-data');
const { ANNOTATION_PREFIX, buildCardComment } = require('./annotation-format');

const SUPPORTED_TYPE_CODES = [
  'ally',
  'alter_ego',
  'attachment',
  'environment',
  'event',
  'hero',
  'minion',
  'obligation',
  'player_side_scheme',
  'resource',
  'side_scheme',
  'support',
  'treachery',
  'upgrade',
];

async function main() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', err => {
      if (err && err.code === 'EPIPE') process.exit(0);
    });
  }

  const program = new Command();
  program
    .name('marvel-search')
    .description('Search MarvelCDB cards (name/text/aspect/type/pack)')
    .argument('[query...]', 'Search terms (default: match name and rules text)')
    .option('--data-cache <file>', 'Where to cache MarvelCDB cards JSON', path.join('.cache', 'marvelcdb-cards.json'))
    .option('--refresh-data', 'Re-download the MarvelCDB cards JSON into the cache', false)
    .option('--in <scope>', 'Search scope: name|text|traits|all', 'all')
    .option('--type <type>', 'Filter by card type (code or name; see supported codes below)')
    .option('--aspect <aspect>', 'Filter by aspect/faction (code or name)')
    .option('--pack <pack>', 'Filter by pack (code or name)')
    .option('--cost <number>', 'Filter by cost (e.g. 2, 2-, 2+)')
    .option('--code <code>', 'Filter by exact card code')
    .option('--sort <mode>', 'Sort results by: cost|name', 'cost')
    .option('--limit <number>', 'Max results to print (0 = no limit)', '25')
    .option('--json', 'Output JSON instead of a formatted list', false)
    .option('--annotate', 'Output deck-style entries with //? annotations', false)
    .addHelpText(
      'after',
      `\nSupported --type codes:\n  ${SUPPORTED_TYPE_CODES.join(', ')}\n`,
    )
    .parse(process.argv);

  const options = program.opts();
  if (options.json && options.annotate) {
    throw new Error('Use only one of --json or --annotate');
  }
  const query = buildQuery(program.args);

  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
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

function parseOptionalNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new Error(`Expected a number, got "${raw}"`);
  }
  return value;
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

  return {
    code,
    type: filterText(options.type),
    aspect: filterText(options.aspect),
    pack: filterText(options.pack),
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

    const nameA = normalizeForSearch(a?.name || a?.real_name || '');
    const nameB = normalizeForSearch(b?.name || b?.real_name || '');
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

  if (filters.cost !== null) {
    const cost = Number(card.cost);
    if (!Number.isFinite(cost)) return false;

    if (filters.cost.op === 'eq' && cost !== filters.cost.value) return false;
    if (filters.cost.op === 'lte' && cost > filters.cost.value) return false;
    if (filters.cost.op === 'gte' && cost < filters.cost.value) return false;
  }

  if (filters.type) {
    const type = normalizeForSearch(card.type_code || card.type_name || '');
    if (!type.includes(filters.type)) return false;
  }

  if (filters.aspect) {
    const aspect = normalizeForSearch(card.faction_code || card.faction_name || '');
    if (!aspect.includes(filters.aspect)) return false;
  }

  if (filters.pack) {
    const pack = normalizeForSearch(card.pack_code || card.pack_name || '');
    if (!pack.includes(filters.pack)) return false;
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
    parts.push(card.name, card.real_name);
    if (card.subname) {
      parts.push(card.subname, `${card.name || card.real_name} ${card.subname}`);
    }
  }

  if (scope === 'text' || scope === 'all') {
    parts.push(stripHtml(card.text));
  }

  if (scope === 'traits' || scope === 'all') {
    parts.push(card.traits);
  }

  return normalizeForSearch(parts.filter(Boolean).join(' '));
}

function stripHtml(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<\/?[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalizeCards(cards) {
  const cardIndex = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    const code = card?.code ? String(card.code).trim() : '';
    if (code) cardIndex.set(code, card);
  }

  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(cards) ? cards : []) {
    if (!raw?.code) continue;

    const dup = raw.duplicate_of_code ? String(raw.duplicate_of_code).trim() : '';
    const canonical = dup ? cardIndex.get(dup) || raw : raw;
    const canonicalCode = canonical?.code ? String(canonical.code).trim() : '';
    if (!canonicalCode || seen.has(canonicalCode)) continue;
    seen.add(canonicalCode);
    out.push(canonical);
  }

  return out;
}

function formatCardLine(card) {
  const code = String(card?.code || '').trim();
  const name = String(card?.name || card?.real_name || '').trim();
  const subname = String(card?.subname || '').trim();

  const label = subname ? `${name} — ${subname}` : name;
  const type = String(card?.type_name || card?.type_code || '').trim();
  const aspect = String(card?.faction_name || card?.faction_code || '').trim();
  const cost = card?.cost === 0 || Number.isFinite(card?.cost) ? String(card.cost) : '';
  const pack = String(card?.pack_name || card?.pack_code || '').trim();
  const position = Number.isFinite(card?.position) ? `#${card.position}` : '';

  const metaParts = [];
  if (type && aspect) metaParts.push(`${type} (${aspect})`);
  else if (type) metaParts.push(type);
  else if (aspect) metaParts.push(aspect);
  if (cost) metaParts.push(`Cost ${cost}`);
  if (pack || position) metaParts.push([pack, position].filter(Boolean).join(' '));

  const suffix = metaParts.length ? ` — ${metaParts.join(' — ')}` : '';
  return `${code || '(no code)'} ${label || '(no name)'}${suffix}`.trim();
}

function formatDeckEntryLine(card) {
  const code = String(card?.code || '').trim();
  const name = String(card?.name || card?.real_name || '').trim();
  const subname = String(card?.subname || '').trim();
  const label = subname ? `${name} — ${subname}` : name;

  const parts = ['1x', label || '(no name)'];
  if (code) {
    parts.push(`[${code}]`);
  }
  return parts.join(' ').trim();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
