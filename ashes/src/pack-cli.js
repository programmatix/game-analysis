#!/usr/bin/env node
const { Command } = require('commander');
const { normalizeForSearch } = require('../../shared/text-utils');
const { formatReleaseList, pickRelease } = require('./pack-utils');
const { ANNOTATION_PREFIX, buildCardComment } = require('./annotation-format');

async function main() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', err => {
      if (err && err.code === 'EPIPE') process.exit(0);
    });
  }

  const program = new Command();
  program
    .name('ashes-pack')
    .description('Generate a decklist from an Ashes release (great for solo boxes like The Corpse of Viros)')
    .argument('[release...]', 'Release name or stub (use "list" to print available releases)')
    .option('--api-base-url <url>', 'Base URL for Ashes.live API', 'https://api.ashes.live')
    .option('--show-legacy', 'Include legacy releases/cards', false)
    .option('--sort <mode>', 'Sort cards by: name|type', 'name')
    .option('--json', 'Output JSON instead of a decklist', false)
    .option('--annotate', 'Output deck-style entries with //? annotations', false)
    .parse(process.argv);

  const options = program.opts();
  if (options.json && options.annotate) {
    throw new Error('Use only one of --json or --annotate');
  }

  const query = (program.args || []).join(' ').trim();
  const apiBaseUrl = String(options.apiBaseUrl || 'https://api.ashes.live').trim();

  const releases = await fetchReleases(apiBaseUrl);
  const filteredReleases = Boolean(options.showLegacy) ? releases : releases.filter(r => !r?.is_legacy);

  if (!query || normalizeForSearch(query) === 'list') {
    process.stdout.write(`${formatReleaseList(filteredReleases)}\n`);
    return;
  }

  const { release, matches } = pickRelease(filteredReleases, query);
  if (!release) {
    if (!matches.length) {
      throw new Error(`No releases matched "${query}". Try:\n${formatReleaseList(filteredReleases)}`);
    }
    throw new Error(`Multiple releases matched "${query}"; be more specific:\n${formatReleaseList(matches)}`);
  }

  const cards = await fetchCardsForRelease(apiBaseUrl, release.stub, { showLegacy: Boolean(options.showLegacy) });
  const sorted = sortCards(cards, String(options.sort || 'name'));

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ release, cards: sorted }, null, 2)}\n`);
    return;
  }

  for (const card of sorted) {
    process.stdout.write(`1 ${card.name} [stub:${card.stub}]\n`);
    if (options.annotate) {
      process.stdout.write(`${ANNOTATION_PREFIX}${buildCardComment(card)}\n`);
    }
  }
}

async function fetchReleases(apiBaseUrl) {
  const url = new URL('/v2/releases', apiBaseUrl);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch releases: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error('Unexpected release payload (expected an array).');
  }
  return payload;
}

async function fetchCardsForRelease(apiBaseUrl, releaseStub, options = {}) {
  const out = [];
  const limit = 200;
  let nextUrl = new URL('/v2/cards', apiBaseUrl);
  nextUrl.searchParams.set('limit', String(limit));
  nextUrl.searchParams.set('offset', '0');
  nextUrl.searchParams.append('r', String(releaseStub));
  if (options.showLegacy) nextUrl.searchParams.set('show_legacy', 'true');

  for (;;) {
    const response = await fetch(nextUrl.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch cards for release "${releaseStub}": ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) {
      throw new Error('Unexpected cards payload (expected { results: [] }).');
    }

    out.push(...payload.results);

    const next = typeof payload.next === 'string' ? payload.next.trim() : '';
    if (!next) break;
    nextUrl = new URL(next);
  }

  return out;
}

function sortCards(cards, mode) {
  const normalized = normalizeForSearch(mode);
  const list = Array.isArray(cards) ? cards.slice() : [];
  list.sort((a, b) => {
    if (normalized === 'type') {
      const typeA = String(a?.type || '');
      const typeB = String(b?.type || '');
      if (typeA !== typeB) return typeA.localeCompare(typeB);
    }
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
  return list;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
