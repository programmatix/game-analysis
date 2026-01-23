#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList, hasCardEntries } = require('../../shared/deck-utils');
const { normalizeAshesDeckEntries } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');
const { ensureCardImage, DEFAULT_CDN_BASE_URL, formatCardLabel } = require('./image-utils');
const { formatReleaseList, pickRelease } = require('./pack-utils');

async function main() {
  const program = new Command();
  program
    .name('ashes-download')
    .description('Download Ashes.live data and card images into the local cache')
    .option('--data-cache <file>', 'Where to cache Ashes.live cards JSON', path.join('.cache', 'asheslive-cards.json'))
    .option('--refresh-data', 'Re-download the Ashes.live cards JSON into the cache', false)
    .option('--api-base-url <url>', 'Base URL for Ashes.live API', 'https://api.ashes.live')
    .option('--show-legacy', 'Include legacy cards (and legacy releases when using --release)', false)
    .option('--cache-dir <dir>', 'Cache directory for downloaded card images', path.join('.cache', 'ashes-card-art'))
    .option('--cdn-base-url <url>', 'Base URL for Ashes CDN images', DEFAULT_CDN_BASE_URL)
    .option('-i, --input <file>', 'Deck list file to download images for (defaults to none)')
    .option('--release <release>', 'Release name or stub to download images for')
    .option('--list-releases', 'List releases and exit', false)
    .parse(process.argv);

  const options = program.opts();
  const apiBaseUrl = String(options.apiBaseUrl || 'https://api.ashes.live').trim();
  const cdnBaseUrl = String(options.cdnBaseUrl || DEFAULT_CDN_BASE_URL).trim();
  const cacheDir = path.resolve(options.cacheDir);

  await fs.promises.mkdir(path.dirname(path.resolve(options.dataCache)), { recursive: true });
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const releases = await fetchReleases(apiBaseUrl);
  const filteredReleases = Boolean(options.showLegacy) ? releases : releases.filter(r => !r?.is_legacy);

  if (options.listReleases) {
    process.stdout.write(`${formatReleaseList(filteredReleases)}\n`);
    return;
  }

  const cardDb = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: Boolean(options.refreshData),
    baseUrl: apiBaseUrl,
    showLegacy: Boolean(options.showLegacy),
  });
  const { lookup, cardIndex } = buildCardLookup(cardDb);

  const cardsToDownload = [];

  if (options.release) {
    const releaseQuery = String(options.release || '').trim();
    if (!releaseQuery) throw new Error('--release cannot be empty');

    const { release, matches } = pickRelease(filteredReleases, releaseQuery);
    if (!release) {
      if (!matches.length) {
        throw new Error(`No releases matched "${releaseQuery}". Try:\n${formatReleaseList(filteredReleases)}`);
      }
      throw new Error(`Multiple releases matched "${releaseQuery}"; be more specific:\n${formatReleaseList(matches)}`);
    }

    const releaseCards = await fetchCardsForRelease(apiBaseUrl, release.stub, { showLegacy: Boolean(options.showLegacy) });
    cardsToDownload.push(...releaseCards.map(card => ({ card })));
  }

  if (options.input) {
    const deckText = await readDeckText(options.input);
    if (!deckText.trim()) throw new Error('Deck list is empty.');

    const deckBaseDir = path.dirname(path.resolve(options.input));
    const parsedEntries = parseDeckList(deckText, {
      baseDir: deckBaseDir,
      sourcePath: path.resolve(options.input),
    });
    if (!hasCardEntries(parsedEntries)) {
      throw new Error('No valid deck entries were found.');
    }
    const deckEntries = normalizeAshesDeckEntries(parsedEntries);

    for (const entry of deckEntries) {
      if (!entry || entry.proxyPageBreak) continue;
      if (shouldSkipProxy(entry)) continue;
      const card = resolveCard(entry, lookup, cardIndex);
      cardsToDownload.push({ card });
    }
  }

  if (!cardsToDownload.length) {
    process.stdout.write('Downloaded card database cache.\n');
    process.stdout.write('Nothing else to do (pass --input and/or --release to download images).\n');
    return;
  }

  const failures = [];
  let downloaded = 0;

  for (const entry of cardsToDownload) {
    const card = entry?.card;
    if (!card) continue;
    try {
      await ensureCardImage({ card }, cacheDir, { cdnBaseUrl });
      downloaded += 1;
    } catch (err) {
      const label = formatCardLabel(card);
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`- ${label}: ${message}`);
    }
  }

  process.stdout.write(`Ensured images for ${downloaded} card${downloaded === 1 ? '' : 's'} in ${cacheDir}\n`);
  if (failures.length) {
    throw new Error(`Failed to download ${failures.length} image${failures.length === 1 ? '' : 's'}:\n${failures.join('\n')}`);
  }
}

function shouldSkipProxy(entry) {
  if (!entry?.annotations) return false;
  if (entry.annotations.skipProxy) return true;
  if (!Array.isArray(entry.annotations.keywords)) return false;
  return entry.annotations.keywords.some(k => String(k).toLowerCase() === 'skipproxy');
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

  return dedupeByStub(out);
}

function dedupeByStub(cards) {
  const seen = new Set();
  const out = [];
  for (const card of Array.isArray(cards) ? cards : []) {
    const stub = card?.stub ? String(card.stub).trim() : '';
    if (!stub || seen.has(stub)) continue;
    seen.add(stub);
    out.push(card);
  }
  return out;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
