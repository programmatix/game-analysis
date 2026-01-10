#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { readDeckText, countDeckEntries, hasCardEntries } = require('../../shared/deck-utils');
const { parseCliOptions } = require('./options');
const { parseSwuDeckList } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveDeckCards } = require('./card-data');
const { buildPdf } = require('./pdf-builder');

async function main() {
  const options = parseCliOptions();

  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const deckEntries = parseSwuDeckList(deckText, {
    baseDir: deckBaseDir,
    sourcePath: options.input ? path.resolve(options.input) : '<stdin>',
  });
  if (!hasCardEntries(deckEntries)) {
    throw new Error('No valid deck entries were found.');
  }

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

  const cards = await loadCardDatabase({ dataFile: options.dataFile });
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

  const proxyCards = deckCards.map(item => {
    if (item?.proxyPageBreak) return { proxyPageBreak: true };
    const { card, entry } = item;
    return { card, skipBack: shouldSkipBack(entry) };
  });

  if (!proxyCards.some(entry => entry && entry.card)) {
    throw new Error('Nothing to proxy after applying filters.');
  }

  await fs.promises.mkdir(options.cacheDir, { recursive: true });

  const pdfBytes = await buildPdf({
    cards: proxyCards,
    cacheDir: options.cacheDir,
    cardWidthPt: options.cardWidthPt,
    cardHeightPt: options.cardHeightPt,
    cutMarkLengthPt: options.cutMarkLengthPt,
    gridSize: options.gridSize,
    scaleFactor: options.scaleFactor,
    deckName: options.deckName,
    includeBacks: options.includeBacks,
  });

  await fs.promises.writeFile(options.outputPath, pdfBytes);
  console.log(`Created ${options.outputPath}`);
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

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
