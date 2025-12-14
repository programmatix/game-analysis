#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { readDeckText, parseDeckList, countDeckEntries } = require('../../shared/deck-utils');
const { parseCliOptions } = require('./options');
const { loadCardDatabase, buildCardLookup, resolveDeckCards } = require('./card-data');
const { buildPdf } = require('./pdf-builder');

async function main() {
  const options = parseCliOptions();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const deckEntries = parseDeckList(deckText, { baseDir: deckBaseDir });
  if (!deckEntries.length) {
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

  const cards = await loadCardDatabase(options.dataDir);
  const lookup = buildCardLookup(cards);
  const deckCards = resolveDeckCards(deckEntries, lookup);

  await fs.promises.mkdir(options.cacheDir, { recursive: true });

  const pdfBytes = await buildPdf({
    cards: deckCards,
    cacheDir: options.cacheDir,
    cardWidthPt: options.cardWidthPt,
    cardHeightPt: options.cardHeightPt,
    cutMarkLengthPt: options.cutMarkLengthPt,
    gridSize: options.gridSize,
    deckName: options.deckName,
    face: options.face,
  });

  await fs.promises.writeFile(options.outputPath, pdfBytes);
  console.log(`Created ${options.outputPath}`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
