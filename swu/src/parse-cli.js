#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, hasCardEntries } = require('../../shared/deck-utils');
const { parseSwuDeckList, formatResolvedDeckEntries } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

async function main() {
  const program = new Command();
  program
    .name('swu-parse')
    .description('Parse Star Wars: Unlimited deck lists and resolve them against the card database')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .option('--data-file <file>', 'Additional card data JSON file to merge into the built-in database')
    .option('--json', 'Output JSON instead of a normalized text list', false)
    .parse(process.argv);

  const options = program.opts();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const parsedEntries = parseSwuDeckList(deckText, {
    baseDir: deckBaseDir,
    sourcePath: options.input ? path.resolve(options.input) : '<stdin>',
  });
  if (!hasCardEntries(parsedEntries)) {
    throw new Error('No valid deck entries were found.');
  }

  const cards = await loadCardDatabase({ dataFile: options.dataFile ? path.resolve(options.dataFile) : null });
  const { lookup, cardIndex } = buildCardLookup(cards);

  const resolvedEntries = parsedEntries.map(entry => {
    if (!entry || entry.proxyPageBreak) return entry;
    const card = resolveCard(entry, lookup, cardIndex);
    return { ...entry, code: card.code, name: card.fullName || card.name || entry.name };
  });

  const outputText = Boolean(options.json)
    ? JSON.stringify(resolvedEntries, null, 2)
    : `${formatResolvedDeckEntries(resolvedEntries)}\n`;

  if (options.output) {
    const outPath = path.resolve(options.output);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, outputText);
    console.log(`Wrote resolved deck to ${outPath}`);
    return;
  }

  process.stdout.write(outputText);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

