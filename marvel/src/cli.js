#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { readDeckText, parseDeckList, countDeckEntries, hasCardEntries } = require('../../shared/deck-utils');
const { parseCliOptions } = require('./options');
const { normalizeMarvelDeckEntries } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveDeckCards } = require('./card-data');
const { buildPdf } = require('./pdf-builder');
const { DEFAULT_BASE_URL, formatCardLabel, resolveCardImageSource } = require('./image-utils');

async function main() {
  const options = parseCliOptions();

  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const parsedEntries = parseDeckList(deckText, {
    baseDir: deckBaseDir,
    sourcePath: options.input ? path.resolve(options.input) : '<stdin>',
  });
  if (!hasCardEntries(parsedEntries)) {
    throw new Error('No valid deck entries were found.');
  }
  const deckEntries = normalizeMarvelDeckEntries(parsedEntries);

  const totalCards = countDeckEntries(deckEntries);
  if (options.expectedDeckSize) {
    const diff = totalCards - options.expectedDeckSize;
    if (diff !== 0) {
      const direction = diff > 0 ? 'over' : 'under';
      console.warn(
        `Warning: deck has ${totalCards} cards (${Math.abs(diff)} ${direction} expected ${options.expectedDeckSize}).`
      );
    }
  }

  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: options.refreshData,
  });
  const { lookup, cardIndex } = buildCardLookup(cards);

  const { proxyEntries, skippedProxyCount } = splitProxyEntries(deckEntries);
  if (!proxyEntries.length) {
    throw new Error('All deck entries were marked [skipproxy]; nothing to proxy.');
  }
  if (skippedProxyCount > 0) {
    console.log(`Skipping ${skippedProxyCount} card${skippedProxyCount === 1 ? '' : 's'} marked [skipproxy].`);
  }

  const deckCards = resolveDeckCards(proxyEntries, lookup, cardIndex, {
    attachEntry: true,
    preservePageBreaks: true,
    defaultFace: options.face,
  });

  const { deckCards: filteredDeckCards, skippedCoreCount } = filterCoreSetCards(deckCards, {
    enabled: options.skipCore,
  });
  if (skippedCoreCount > 0) {
    console.log(`Skipping ${skippedCoreCount} Core Set card${skippedCoreCount === 1 ? '' : 's'} due to --skip-core.`);
  }

  const proxyCards = filteredDeckCards.map(item => {
    if (item?.proxyPageBreak) return { proxyPageBreak: true };
    const { card, entry } = item;
    return { card, skipBack: shouldSkipBack(entry) };
  });

  const missingFrontImages = await collectMissingFrontImages(proxyCards, {
    baseUrl: DEFAULT_BASE_URL,
    fallbackImageBaseUrl: options.fallbackImageBaseUrl,
  });
  if (missingFrontImages.length > 0) {
    console.warn(formatMissingImageWarning(missingFrontImages));
  }

  if (!proxyCards.some(entry => entry && entry.card)) {
    if (options.skipCore && skippedCoreCount > 0) {
      throw new Error('All resolved cards were from the Core Set and were skipped due to --skip-core; nothing to proxy.');
    }
    throw new Error('Nothing to proxy after applying filters.');
  }

  await fs.promises.mkdir(options.cacheDir, { recursive: true });

  const pdfBytes = await buildPdf({
    cards: proxyCards,
    cacheDir: options.cacheDir,
    cardWidthPt: options.cardWidthPt,
    cardHeightPt: options.cardHeightPt,
    cornerRadiusMm: options.cornerRadiusMm,
    cutMarkLengthPt: options.cutMarkLengthPt,
    gridSize: options.gridSize,
    scaleFactor: options.scaleFactor,
    deckName: options.deckName,
    includeBacks: options.includeBacks,
    baseUrl: DEFAULT_BASE_URL,
    fallbackImageBaseUrl: options.fallbackImageBaseUrl,
    cardIndex,
  });

  await fs.promises.writeFile(options.outputPath, pdfBytes);
  console.log(`Created ${options.outputPath}`);
}

async function collectMissingFrontImages(cards, options = {}) {
  const missing = [];

  for (const entry of Array.isArray(cards) ? cards : []) {
    if (entry?.proxyPageBreak) continue;
    if (!entry?.card) continue;
    const resolved = await resolveCardImageSource({ card: entry.card, face: 'front' }, options);
    if (!resolved) {
      missing.push(formatCardLabel(entry.card, 'front'));
    }
  }

  return missing;
}

function formatMissingImageWarning(labels) {
  const counts = new Map();
  for (const label of labels) {
    const key = String(label || 'unknown card').trim() || 'unknown card';
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const entries = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const total = labels.length;
  const lines = [`Warning: ${total} card${total === 1 ? '' : 's'} missing image sources; rendering placeholders:`];

  const maxLines = 50;
  for (const [label, count] of entries.slice(0, maxLines)) {
    const message = `Card image source is missing for "${label}".`;
    lines.push(`- ${message}${count > 1 ? ` (x${count})` : ''}`);
  }
  if (entries.length > maxLines) {
    lines.push(`- ...and ${entries.length - maxLines} more`);
  }

  return lines.join('\n');
}

function splitProxyEntries(entries) {
  let skippedProxyCount = 0;
  const proxyEntries = [];
  for (const entry of entries) {
    if (shouldSkipProxy(entry)) {
      skippedProxyCount += Number(entry.count) || 0;
    } else {
      proxyEntries.push(entry);
    }
  }
  return { proxyEntries, skippedProxyCount };
}

function shouldSkipProxy(entry) {
  if (!entry?.annotations) return false;
  if (entry.annotations.skipProxy) return true;

  if (Array.isArray(entry.annotations.keywords)) {
    for (const keyword of entry.annotations.keywords) {
      if (String(keyword).toLowerCase() === 'skipproxy') {
        return true;
      }
    }
  }

  return false;
}

function shouldSkipBack(entry) {
  if (!entry?.annotations) return false;
  if (entry.annotations.skipBack) return true;

  if (Array.isArray(entry.annotations.keywords)) {
    for (const keyword of entry.annotations.keywords) {
      if (String(keyword).toLowerCase() === 'skipback') {
        return true;
      }
    }
  }

  return false;
}

function filterCoreSetCards(deckCards, options = {}) {
  if (!Array.isArray(deckCards)) return { deckCards: [], skippedCoreCount: 0 };
  if (!options.enabled) return { deckCards, skippedCoreCount: 0 };

  let skippedCoreCount = 0;
  const filtered = [];

  for (const item of deckCards) {
    if (item?.proxyPageBreak) {
      filtered.push(item);
      continue;
    }

    if (!item?.card) continue;
    if (isCoreSetCard(item.card)) {
      skippedCoreCount += 1;
      continue;
    }
    filtered.push(item);
  }

  return { deckCards: filtered, skippedCoreCount };
}

function isCoreSetCard(card) {
  const packCode = String(card?.pack_code || '').trim().toLowerCase();
  if (packCode === 'core') return true;
  const packName = String(card?.pack_name || '').trim().toLowerCase();
  if (packName === 'core set') return true;
  return false;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
