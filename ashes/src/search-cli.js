#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { normalizeForSearch } = require('../../shared/text-utils');
const { loadCardDatabase } = require('./card-data');
const { ANNOTATION_PREFIX, buildCardComment } = require('./annotation-format');

async function main() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', err => {
      if (err && err.code === 'EPIPE') process.exit(0);
    });
  }

  const program = new Command();
  program
    .name('ashes-search')
    .description('Search Ashes.live cards (name/text/type/release)')
    .argument('[query...]', 'Search terms')
    .option('--data-cache <file>', 'Where to cache Ashes.live cards JSON', path.join('.cache', 'asheslive-cards.json'))
    .option('--refresh-data', 'Re-download the Ashes.live cards JSON into the cache', false)
    .option('--api-base-url <url>', 'Base URL for Ashes.live API', 'https://api.ashes.live')
    .option('--show-legacy', 'Include legacy cards in the local database cache', false)
    .option('--in <scope>', 'Search scope: name|text|all', 'all')
    .option('--type <type>', 'Filter by card type (substring match)')
    .option('--release <release>', 'Filter by release name or stub (substring match)')
    .option('--chained', 'Only show chained cards', false)
    .option('--limit <number>', 'Max results to print (0 = no limit)', '25')
    .option('--json', 'Output JSON instead of a formatted list', false)
    .option('--annotate', 'Output deck-style entries with //? annotations', false)
    .parse(process.argv);

  const options = program.opts();
  if (options.json && options.annotate) {
    throw new Error('Use only one of --json or --annotate');
  }

  const query = buildQuery(program.args);
  const scope = normalizeScope(options.in);
  const limit = parseLimit(options.limit);

  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: Boolean(options.refreshData),
    baseUrl: String(options.apiBaseUrl || 'https://api.ashes.live').trim(),
    showLegacy: Boolean(options.showLegacy),
  });

  const filters = {
    type: normalizeForSearch(options.type || ''),
    release: normalizeForSearch(options.release || ''),
    chained: Boolean(options.chained),
  };

  const results = searchCards(cards, { query, scope, filters });
  const toPrint = limit === null ? results : results.slice(0, limit);

  if (Boolean(options.json)) {
    process.stdout.write(`${JSON.stringify(toPrint, null, 2)}\n`);
  } else if (Boolean(options.annotate)) {
    for (const card of toPrint) {
      process.stdout.write(`1 ${card.name} [stub:${card.stub}]\n`);
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
  if (scope === 'name' || scope === 'text' || scope === 'all') return scope;
  throw new Error('--in must be one of: name, text, all');
}

function parseLimit(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('--limit must be a non-negative integer (0 = no limit)');
  }
  return value === 0 ? null : value;
}

function searchCards(cards, options) {
  const { query = '', scope = 'all', filters = {} } = options || {};
  const normalizedQuery = normalizeForSearch(query);
  const terms = normalizedQuery ? normalizedQuery.split(' ') : [];

  const filtered = (Array.isArray(cards) ? cards : []).filter(card => matchesFilters(card, filters));
  const searched = terms.length ? filtered.filter(card => matchesQuery(card, terms, scope)) : filtered;

  searched.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  return searched;
}

function matchesFilters(card, filters) {
  if (!card) return false;

  if (filters.chained && !card.chained) return false;

  if (filters.type) {
    const typeText = normalizeForSearch(card.type || '');
    if (!typeText.includes(filters.type)) return false;
  }

  if (filters.release) {
    const relText = normalizeForSearch(`${card.release?.name || ''} ${card.release?.stub || ''}`);
    if (!relText.includes(filters.release)) return false;
  }

  return true;
}

function matchesQuery(card, terms, scope) {
  const name = normalizeForSearch(card?.name || '');
  const text = normalizeForSearch(card?.text || '');

  const haystack = scope === 'name' ? name : scope === 'text' ? text : normalizeForSearch(`${card?.name || ''} ${card?.type || ''} ${card?.release?.name || ''} ${card?.text || ''}`);
  return terms.every(term => haystack.includes(term));
}

function formatCardLine(card) {
  const name = card?.name || '(no name)';
  const stub = card?.stub || '(no stub)';
  const type = card?.type || '';
  const release = card?.release?.name || card?.release?.stub || '';
  const parts = [name, `[${stub}]`];
  if (type) parts.push(`— ${type}`);
  if (release) parts.push(`(${release})`);
  return parts.join(' ');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

