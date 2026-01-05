#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { readDeckText, parseDeckList, parseNameWithCode, stripLineComment, hasCardEntries } = require('../../shared/deck-utils');
const { splitMarvelCdbSuffix } = require('./decklist');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

const ANNOTATION_PREFIX = '//? ';

async function main() {
  const program = new Command();
  program
    .name('marvel-annotate')
    .description('Annotate Marvel Champions deck lists with per-card comments')
    .option('-i, --input <file>', 'Deck list file (defaults to stdin)')
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
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
  const parsedEntries = parseDeckList(deckText, { baseDir: deckBaseDir });
  if (!hasCardEntries(parsedEntries)) {
    throw new Error('No valid deck entries were found.');
  }

  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: Boolean(options.refreshData),
  });
  const { lookup, cardIndex } = buildCardLookup(cards);

  const annotated = annotateDeckText(deckText, lookup, cardIndex, { defaultFace: options.face });
  if (options.output) {
    const outPath = path.resolve(options.output);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, annotated);
    console.log(`Wrote annotated deck to ${outPath}`);
  } else {
    process.stdout.write(annotated);
  }
}

function annotateDeckText(deckText, lookup, cardIndex, options = {}) {
  const lines = deckText.split(/\r?\n/);
  const output = [];
  let inBlockComment = false;
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

  const joined = output.join('\n');
  return hasTrailingNewline ? `${joined}\n` : joined;
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

function buildCardComment(card) {
  const parts = [];

  const type = formatType(card);
  const faction = formatFaction(card);
  if (type && faction) {
    parts.push(`${type} — ${faction}.`);
  } else if (type) {
    parts.push(`${type}.`);
  } else if (faction) {
    parts.push(`${faction}.`);
  }

  const cost = formatCost(card);
  if (cost !== null) {
    parts.push(`Cost ${cost}.`);
  }

  const stats = formatStats(card);
  if (stats) {
    parts.push(`${stats}.`);
  }

  const traits = formatTraits(card);
  if (traits) {
    parts.push(`${traits}.`);
  }

  const text = formatRulesText(card);
  if (text) {
    parts.push(text);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function formatType(card) {
  const type = card?.type_name || card?.type_code;
  if (!type) return '';
  return String(type).charAt(0).toUpperCase() + String(type).slice(1);
}

function formatFaction(card) {
  const name = card?.faction_name || card?.faction_code;
  if (!name) return '';
  return String(name).trim();
}

function formatCost(card) {
  if (Number.isFinite(card?.cost)) return card.cost;
  if (card?.cost === 0) return 0;
  if (typeof card?.cost === 'string' && card.cost.trim()) return card.cost.trim();
  return null;
}

function formatStats(card) {
  const stats = [];

  const add = (label, value, starFlag) => {
    const rendered = renderStatValue(value, starFlag);
    if (rendered === null) return;
    stats.push(`${label} ${rendered}`);
  };

  add('THW', card?.thwart, card?.thwart_star);
  add('ATK', card?.attack, card?.attack_star);
  add('DEF', card?.defense, card?.defense_star);
  add('REC', card?.recover, card?.recover_star);
  add('HP', card?.health, card?.health_star);

  if (Number.isFinite(card?.hand_size)) {
    stats.push(`HAND ${card.hand_size}`);
  }

  return stats.length ? stats.join(', ') : '';
}

function renderStatValue(value, starFlag) {
  if (starFlag) return '*';
  if (Number.isFinite(value)) return value;
  if (value === 0) return 0;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function formatTraits(card) {
  if (!card?.traits) return '';
  const normalized = String(card.traits).replace(/\s+/g, ' ').trim().replace(/[.;,]+$/g, '');
  if (!normalized) return '';
  const parts = normalized
    .split(/[.;]/)
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  return parts.join(', ');
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
