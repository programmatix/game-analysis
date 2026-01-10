#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, stripLineComment, hasCardEntries } = require('../../shared/deck-utils');
const { parseSwuDeckList, parseSwuDeckLine, splitSwuDeckSuffix } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');
const { ANNOTATION_PREFIX, buildCardComment, isAnnotationLine } = require('./annotation-format');

async function main() {
  const program = new Command();
  program
    .name('swu-annotate')
    .description('Annotate Star Wars: Unlimited deck lists with per-card comments')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('-o, --output <file>', 'Write output to a file (defaults to overwriting --input; otherwise stdout)')
    .option('--data-file <file>', 'Additional card data JSON file to merge into the built-in database')
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

  const failures = collectResolutionFailures(deckText, lookup, cardIndex);
  if (failures.length) {
    const joined = failures.join('\n\n');
    throw new Error(`Found ${failures.length} parsing failure${failures.length === 1 ? '' : 's'}:\n\n${joined}`);
  }

  const annotated = annotateDeckText(deckText, lookup, cardIndex);
  const outPath = options.output ? path.resolve(options.output) : options.input ? path.resolve(options.input) : null;
  if (!outPath) return process.stdout.write(annotated);

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, annotated);
  console.log(`Wrote annotated deck to ${outPath}`);
}

function annotateDeckText(deckText, lookup, cardIndex) {
  const lines = deckText.split(/\r?\n/);
  const output = [];
  let inBlockComment = false;
  let section = 'other';
  const lineEnding = deckText.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingNewline = deckText.endsWith('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const { text, nextInBlock } = stripBlockCommentsFromLine(line, inBlockComment);
    inBlockComment = nextInBlock;

    const parseCandidate = stripLineComment(text).trim();
    const indent = /^(\s*)/.exec(line)?.[1] ?? '';

    if (!parseCandidate || inBlockComment) {
      output.push(line);
      continue;
    }

    if (isAnnotationLine(parseCandidate)) {
      output.push(line);
      continue;
    }

    const detected = detectSectionHeader(parseCandidate);
    if (detected) {
      section = detected;
      output.push(line);
      continue;
    }

    if (/^\[proxypagebreak\]$/i.test(parseCandidate) || /^\[include:[^\]]+\]$/i.test(parseCandidate)) {
      output.push(line);
      continue;
    }

    const entry = parseSwuDeckLine(parseCandidate, { section });
    if (!entry) {
      output.push(line);
      continue;
    }

    const split = splitSwuDeckSuffix(entry.name);
    const resolvedEntry = { ...entry, name: split.name, swu: split.hint || undefined };

    try {
      const card = resolveCard(resolvedEntry, lookup, cardIndex);
      const comment = buildCardComment(card);
      const annotationLine = `${indent}${ANNOTATION_PREFIX}${comment}`;
      output.push(line);

      const nextLine = lines[index + 1];
      if (nextLine && isAnnotationLine(nextLine)) {
        index += 1;
      }

      output.push(annotationLine);
    } catch (err) {
      const prefix = `Line ${index + 1}: ${line.trim()}`;
      throw new Error(`${prefix}\n${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const joined = output.join(lineEnding);
  return hasTrailingNewline ? `${joined}${lineEnding}` : joined;
}

function collectResolutionFailures(deckText, lookup, cardIndex) {
  const failures = [];
  const lines = deckText.split(/\r?\n/);
  let inBlockComment = false;
  let section = 'other';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const { text, nextInBlock } = stripBlockCommentsFromLine(line, inBlockComment);
    inBlockComment = nextInBlock;

    const parseCandidate = stripLineComment(text).trim();
    if (!parseCandidate || inBlockComment) continue;
    if (isAnnotationLine(parseCandidate)) continue;

    const detected = detectSectionHeader(parseCandidate);
    if (detected) {
      section = detected;
      continue;
    }

    if (/^\[proxypagebreak\]$/i.test(parseCandidate) || /^\[include:[^\]]+\]$/i.test(parseCandidate)) {
      continue;
    }

    const entry = parseSwuDeckLine(parseCandidate, { section });
    if (!entry) continue;

    const split = splitSwuDeckSuffix(entry.name);
    const resolvedEntry = { ...entry, name: split.name, swu: split.hint || undefined };

    try {
      resolveCard(resolvedEntry, lookup, cardIndex);
    } catch (err) {
      const prefix = `Line ${index + 1}: ${line.trim()}`;
      failures.push(`${prefix}\n${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return failures;
}

function stripBlockCommentsFromLine(line, inBlockComment) {
  let cursor = 0;
  let output = '';
  let insideBlock = inBlockComment;

  while (cursor < line.length) {
    if (insideBlock) {
      const endIdx = line.indexOf('*/', cursor);
      if (endIdx === -1) {
        return { text: output, nextInBlock: true };
      }
      cursor = endIdx + 2;
      insideBlock = false;
      continue;
    }

    const startIdx = line.indexOf('/*', cursor);
    if (startIdx === -1) {
      output += line.slice(cursor);
      break;
    }

    output += line.slice(cursor, startIdx);
    cursor = startIdx + 2;
    const endIdx = line.indexOf('*/', cursor);
    if (endIdx === -1) {
      insideBlock = true;
      break;
    }
    cursor = endIdx + 2;
  }

  return { text: output, nextInBlock: insideBlock };
}

function detectSectionHeader(trimmedLine) {
  const normalized = trimmedLine.replace(/\s+/g, ' ').trim().toLowerCase();
  const withoutColon = normalized.endsWith(':') ? normalized.slice(0, -1).trim() : normalized;

  if (withoutColon === 'leader' || withoutColon === 'leaders') return 'leader';
  if (withoutColon === 'base' || withoutColon === 'bases') return 'base';
  if (withoutColon === 'deck' || withoutColon === 'main deck') return 'deck';
  if (withoutColon === 'sideboard') return 'sideboard';
  return null;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
