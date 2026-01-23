#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList, hasCardEntries } = require('../../shared/deck-utils');
const { normalizeAshesDeckEntries } = require('./decklist');

async function main() {
  const program = new Command();
  program
    .name('ashes-parse')
    .description('Parse Ashes Reborn decklists into JSON')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .parse(process.argv);

  const options = program.opts();
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

  const entries = normalizeAshesDeckEntries(parsedEntries);
  process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

