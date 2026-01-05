#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList, parseNameWithCode, stripLineComment, hasCardEntries } = require('../../shared/deck-utils');
const { loadCardDatabase, buildCardLookup, assertNoAmbiguousCards, resolveCard } = require('./card-data');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'arkhamdb-json-data');

const ANNOTATION_PREFIX = '//? ';

async function main() {
  const program = new Command();
  program
    .name('arkham-annotate')
    .description('Annotate Arkham Horror deck lists with per-card comments')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('-o, --output <file>', 'Write output to a file (defaults to overwriting --input; otherwise stdout)')
    .option('--data-dir <dir>', 'Path to arkhamdb-json-data root', DEFAULT_DATA_DIR)
    .parse(process.argv);

  const options = program.opts();
  const deckText = await readDeckText(options.input);
  if (!deckText.trim()) {
    throw new Error('Deck list is empty. Provide --input or pipe data to stdin.');
  }

  const dataDir = path.resolve(options.dataDir);
  const deckBaseDir = options.input ? path.dirname(path.resolve(options.input)) : process.cwd();
  const parsedEntries = parseDeckList(deckText, { baseDir: deckBaseDir });
  if (!hasCardEntries(parsedEntries)) {
    throw new Error('No valid deck entries were found.');
  }

  const cards = await loadCardDatabase(dataDir);
  const lookup = buildCardLookup(cards);
  assertNoAmbiguousCards(parsedEntries, lookup);

  const annotated = annotateDeckText(deckText, lookup);
  const outPath = options.output ? path.resolve(options.output) : options.input ? path.resolve(options.input) : null;
  if (!outPath) return process.stdout.write(annotated);

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await fs.promises.writeFile(outPath, annotated);
  console.log(`Wrote annotated deck to ${outPath}`);
}

function annotateDeckText(deckText, lookup) {
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
      const entry = parseDeckLine(parseCandidate);
      if (entry) {
        try {
          const card = resolveCard(entry, lookup);
          const comment = buildCardComment(card);
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

function parseDeckLine(text) {
  const match = /^(\d+)\s+(.+)$/.exec(text);
  if (!match) return null;

  const [, countStr, rawName] = match;
  const count = Number(countStr);
  if (!Number.isFinite(count) || count <= 0) return null;

  const { name, code } = parseNameWithCode(rawName);
  if (!name) return null;

  return { count, name, code };
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

function buildCardComment(card) {
  const parts = [];
  parts.push(`${formatXp(card)} XP.`);
  parts.push(`${formatCost(card)} cost.`);

  const type = formatType(card);
  if (type) {
    parts.push(`${type}.`);
  }

  const traits = formatTraits(card);
  if (traits) {
    parts.push(`${traits}.`);
  }

  const slot = formatSlot(card);
  if (slot) {
    parts.push(`${slot} slot.`);
  }

  const text = formatRulesText(card);
  if (text) {
    parts.push(text);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function formatXp(card) {
  if (Number.isFinite(card?.xp)) {
    return card.xp;
  }
  return 0;
}

function formatCost(card) {
  if (Number.isFinite(card?.cost)) {
    return card.cost;
  }
  if (card?.cost === 0) return 0;
  if (typeof card?.cost === 'string' && card.cost.trim()) {
    return card.cost.trim();
  }
  return 0;
}

function formatType(card) {
  const type = card?.type_name || card?.type_code;
  if (!type) return '';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatTraits(card) {
  if (!card?.traits) return '';
  const normalized = card.traits.replace(/\s+/g, ' ').trim().replace(/[.;,]+$/g, '');
  if (!normalized) return '';
  const parts = normalized
    .split(/[.;]/)
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  return parts.join(', ');
}

function formatSlot(card) {
  if (!card?.slot) return '';
  const slot = card.slot.replace(/\s+/g, ' ').trim();
  return slot;
}

function formatRulesText(card) {
  const raw = typeof card?.text === 'string' ? card.text : '';
  if (!raw.trim()) return '';
  const withoutTags = raw.replace(/<\/?[^>]+>/g, '');
  return withoutTags.replace(/\s+/g, ' ').trim();
}

function isAnnotationLine(line) {
  return /^\s*\/\/\?\s/.test(line);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
