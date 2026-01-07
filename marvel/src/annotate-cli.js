#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList, parseNameWithCode, stripLineComment, hasCardEntries } = require('../../shared/deck-utils');
const { splitMarvelCdbSuffix } = require('./decklist');
const { loadCardDatabase, buildCardLookup, buildCanonicalPackCodes, resolveCard } = require('./card-data');
const { ANNOTATION_PREFIX, buildCardComment, isAnnotationLine } = require('./annotation-format');

async function main() {
  const program = new Command();
  program
    .name('marvel-annotate')
    .description('Annotate Marvel Champions deck lists with per-card comments')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('-o, --output <file>', 'Write output to a file (defaults to overwriting --input; otherwise stdout)')
    .option('--data-cache <file>', 'Where to cache MarvelCDB cards JSON', path.join('.cache', 'marvelcdb-cards.json'))
    .option('--refresh-data', 'Re-download the MarvelCDB cards JSON into the cache', false)
    .option('--face <a|b>', 'Default face for numeric codes like [01001]', 'a')
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

  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: Boolean(options.refreshData),
  });
  const { lookup, cardIndex } = buildCardLookup(cards);
  const canonicalPackCodes = buildCanonicalPackCodes(cards, { cardIndex });

  const failures = collectResolutionFailures(deckText, lookup, cardIndex, { defaultFace: options.face });
  if (failures.length) {
    const joined = failures.join('\n\n');
    throw new Error(`Found ${failures.length} parsing failure${failures.length === 1 ? '' : 's'}:\n\n${joined}`);
  }

  const annotated = annotateDeckText(deckText, lookup, cardIndex, {
    defaultFace: options.face,
    canonicalPackCodes,
  });
  const outPath = options.output ? path.resolve(options.output) : options.input ? path.resolve(options.input) : null;
  if (!outPath) return process.stdout.write(annotated);

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, annotated);
  console.log(`Wrote annotated deck to ${outPath}`);
}

function annotateDeckText(deckText, lookup, cardIndex, options = {}) {
  const lines = deckText.split(/\r?\n/);
  const output = [];
  let inBlockComment = false;
  const lineEnding = deckText.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingNewline = deckText.endsWith('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const { text, nextInBlock } = stripBlockCommentsFromLine(line, inBlockComment);
    inBlockComment = nextInBlock;

    const parseCandidate = stripLineComment(text).trim();
    const indent = /^(\s*)/.exec(line)?.[1] ?? '';

    if (parseCandidate && !inBlockComment) {
      if (/^\[proxypagebreak\]$/i.test(parseCandidate) || /^\[include:[^\]]+\]$/i.test(parseCandidate)) {
        output.push(line);
        continue;
      }

      const entry = parseDeckLine(parseCandidate);
      if (entry) {
        try {
          const card = resolveCard(entry, lookup, cardIndex, { defaultFace: options.defaultFace });
          const comment = buildCardComment(card, { canonicalPackCodes: options.canonicalPackCodes, cardIndex });
          const annotationLine = `${indent}${ANNOTATION_PREFIX}${comment}`;
          output.push(line);

          const nextLine = lines[index + 1];
          if (nextLine && isAnnotationLine(nextLine)) {
            index += 1; // Replace existing annotation with the new one.
          }

          output.push(annotationLine);
          continue;
        } catch (err) {
          const prefix = `Line ${index + 1}: ${line.trim()}`;
          throw new Error(`${prefix}\n${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    output.push(line);
  }

  const joined = output.join(lineEnding);
  return hasTrailingNewline ? `${joined}${lineEnding}` : joined;
}

function collectResolutionFailures(deckText, lookup, cardIndex, options = {}) {
  const failures = [];
  const lines = deckText.split(/\r?\n/);
  let inBlockComment = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const { text, nextInBlock } = stripBlockCommentsFromLine(line, inBlockComment);
    inBlockComment = nextInBlock;

    const parseCandidate = stripLineComment(text).trim();
    if (!parseCandidate || inBlockComment) continue;

    if (/^\[proxypagebreak\]$/i.test(parseCandidate) || /^\[include:[^\]]+\]$/i.test(parseCandidate)) {
      continue;
    }

    const entry = parseDeckLine(parseCandidate);
    if (!entry) continue;

    try {
      resolveCard(entry, lookup, cardIndex, { defaultFace: options.defaultFace });
    } catch (err) {
      const prefix = `Line ${index + 1}: ${line.trim()}`;
      failures.push(`${prefix}\n${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return failures;
}

function parseDeckLine(text) {
  const match = /^(\d+)\s*(?:x|×)\s+(.+)$/.exec(text) || /^(\d+)\s+(.+)$/.exec(text);
  if (!match) return null;

  const [, countStr, rawName] = match;
  const count = Number(countStr);
  if (!Number.isFinite(count) || count <= 0) return null;

  const { name, code } = parseNameWithCode(rawName);
  const split = splitMarvelCdbSuffix(name);
  if (!split.name) return null;

  return { count, name: split.name, code, marvelcdb: split.hint || undefined };
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

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
