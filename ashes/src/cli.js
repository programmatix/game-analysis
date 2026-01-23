#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { readDeckText, parseDeckList, countDeckEntries, hasCardEntries } = require('../../shared/deck-utils');
const { parseCliOptions } = require('./options');
const { normalizeAshesDeckEntries } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveDeckCards } = require('./card-data');
const { buildPdf } = require('./pdf-builder');
const { formatCardLabel, resolveCardImageSource } = require('./image-utils');

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
  const deckEntries = normalizeAshesDeckEntries(parsedEntries);

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
    baseUrl: options.apiBaseUrl,
    showLegacy: options.showLegacy,
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
  });

  const missingImages = await collectMissingImages(deckCards, { cdnBaseUrl: options.cdnBaseUrl });
  if (missingImages.length > 0) {
    console.warn(formatMissingImageWarning(missingImages));
  }

  if (!deckCards.some(entry => entry && entry.card)) {
    throw new Error('Nothing to proxy after parsing the decklist.');
  }

  await fs.promises.mkdir(options.cacheDir, { recursive: true });

  const pdfBytes = await buildPdf({
    cards: deckCards,
    cacheDir: options.cacheDir,
    cardWidthPt: options.cardWidthPt,
    cardHeightPt: options.cardHeightPt,
    cornerRadiusMm: options.cornerRadiusMm,
    cutMarkLengthPt: options.cutMarkLengthPt,
    gridSize: options.gridSize,
    scaleFactor: options.scaleFactor,
    deckName: options.deckName,
    cdnBaseUrl: options.cdnBaseUrl,
  });

  await fs.promises.writeFile(options.outputPath, pdfBytes);
  console.log(`Created ${options.outputPath}`);
}

async function collectMissingImages(entries, options = {}) {
  const missing = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.proxyPageBreak) continue;
    if (!entry?.card) continue;
    const resolved = await resolveCardImageSource({ card: entry.card }, options);
    if (!resolved) {
      missing.push(formatCardLabel(entry.card));
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
      skippedProxyCount += Number(entry?.count) || 0;
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
      if (String(keyword).toLowerCase() === 'skipproxy') return true;
    }
  }

  return false;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

