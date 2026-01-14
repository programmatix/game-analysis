#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, stripLineComment, hasCardEntries } = require('../../shared/deck-utils');
const { parseLotrDeckList, parseLotrDeckLine, splitLotrDeckSuffix } = require('./decklist');
const { DEFAULT_BASE_URL, loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');
const { ANNOTATION_PREFIX, buildCardComment, isAnnotationLine } = require('./annotation-format');

const DEFAULT_DATA_CACHE = path.join(__dirname, '..', '.cache', 'ringsdb-cards.json');

async function main() {
  const program = new Command();
  program
    .name('lotr-annotate')
    .description('Annotate LOTR LCG deck lists with per-card comments')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('-o, --output <file>', 'Write output to a file (defaults to overwriting --input; otherwise stdout)')
    .option('--base-url <url>', 'RingsDB base URL', DEFAULT_BASE_URL)
    .option('--data-cache <file>', 'Where to cache RingsDB cards JSON', DEFAULT_DATA_CACHE)
    .option('--refresh-data', 'Re-download the RingsDB cards JSON into the cache', false)
    .parse(process.argv);

  const options = program.opts();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const parsedEntries = parseLotrDeckList(deckText, {
    baseDir: deckBaseDir,
    sourcePath: options.input ? path.resolve(options.input) : '<stdin>',
  });
  if (!hasCardEntries(parsedEntries)) {
    throw new Error('No valid deck entries were found.');
  }

  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const cards = await loadCardDatabase({
    cachePath: options.dataCache ? path.resolve(options.dataCache) : DEFAULT_DATA_CACHE,
    refresh: Boolean(options.refreshData),
    baseUrl,
  });
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
  let section = 'deck';
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

    const entry = parseLotrDeckLine(parseCandidate, { section });
    if (!entry) {
      output.push(line);
      continue;
    }

    const split = splitLotrDeckSuffix(entry.name);
    const resolvedEntry = { ...entry, name: split.name, ringsdb: split.hint || undefined };

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
  let section = 'deck';

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

    const entry = parseLotrDeckLine(parseCandidate, { section });
    if (!entry) continue;

    const split = splitLotrDeckSuffix(entry.name);
    const resolvedEntry = { ...entry, name: split.name, ringsdb: split.hint || undefined };

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
  const withoutCountSuffix = withoutColon.replace(/\(\s*\d+\s*\)\s*$/g, '').trim();

  if (withoutCountSuffix === 'heroes' || withoutCountSuffix === 'hero') return 'heroes';
  if (withoutCountSuffix === 'allies' || withoutCountSuffix === 'ally') return 'allies';
  if (withoutCountSuffix === 'attachments' || withoutCountSuffix === 'attachment') return 'attachments';
  if (withoutCountSuffix === 'events' || withoutCountSuffix === 'event') return 'events';
  if (withoutCountSuffix === 'side quests' || withoutCountSuffix === 'side quest' || withoutCountSuffix === 'sidequests') return 'side_quests';
  if (withoutCountSuffix === 'contracts' || withoutCountSuffix === 'contract') return 'contracts';
  if (withoutCountSuffix === 'deck' || withoutCountSuffix === 'main deck' || withoutCountSuffix === 'player deck') return 'deck';
  if (withoutCountSuffix === 'sideboard') return 'sideboard';
  return null;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
