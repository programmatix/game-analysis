#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { normalizeName } = require('../../shared/deck-utils');
const { loadCardDatabase } = require('./card-data');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'arkhamdb-json-data');

async function main() {
  const program = new Command();
  program
    .name('arkham-scenario')
    .description('Emit a deck list for an Arkham Horror LCG scenario/encounter set')
    .option('-s, --scenario <code-or-name>', 'Scenario/encounter code or name (case-insensitive)')
    .option('--data-dir <dir>', 'Path to arkhamdb-json-data root', DEFAULT_DATA_DIR)
    .option('--list', 'List available encounter codes and names', false)
    .parse(process.argv);

  const options = program.opts();
  const dataDir = path.resolve(options.dataDir);
  const encounterMeta = await loadEncounterMetadata(dataDir);

  if (options.list) {
    printEncounterList(encounterMeta);
    return;
  }

  const scenarioInput = options.scenario || program.args[0];
  if (!scenarioInput) {
    throw new Error('Provide --scenario <code-or-name> to choose which encounter set to export (try --list).');
  }

  const cards = await loadCardDatabase(dataDir);
  const encounterCode = resolveEncounterCode(scenarioInput, encounterMeta, cards);
  const deckEntries = buildEncounterDecklist(cards, encounterCode);

  if (!deckEntries.length) {
    throw new Error(`No cards found for encounter code "${encounterCode}".`);
  }

  const displayName = findEncounterName(encounterMeta, encounterCode);
  console.log(`// Scenario: ${displayName || encounterCode} [${encounterCode}]`);
  deckEntries.forEach(line => console.log(line));
}

async function loadEncounterMetadata(dataDir) {
  const encountersPath = path.join(dataDir, 'encounters.json');
  let raw;
  try {
    raw = await fs.promises.readFile(encountersPath, 'utf8');
  } catch (err) {
    console.warn(`Unable to read encounters.json at ${encountersPath}: ${err instanceof Error ? err.message : err}`);
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(item => item && item.code) : [];
  } catch (err) {
    console.warn(`encounters.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

function resolveEncounterCode(input, encounterMeta, cards) {
  const normalizedInput = normalizeEncounterKey(input);
  if (!normalizedInput) {
    throw new Error('Encounter code/name cannot be empty.');
  }

  const lookup = buildEncounterLookup(encounterMeta, cards);
  const matched = lookup.get(normalizedInput);
  if (matched) {
    return matched;
  }

  const suggestions = suggestEncounters(normalizedInput, encounterMeta, lookup);
  const suggestionText = suggestions.length ? ` Did you mean: ${suggestions.slice(0, 5).join(', ')}?` : '';
  throw new Error(`Encounter "${input}" was not found.${suggestionText}`);
}

function buildEncounterLookup(encounterMeta, cards) {
  const lookup = new Map();
  for (const meta of encounterMeta) {
    const code = normalizeEncounterCode(meta.code);
    if (!code) continue;
    const codeKey = normalizeEncounterKey(meta.code);
    const nameKey = normalizeEncounterKey(meta.name);
    if (codeKey) {
      lookup.set(codeKey, code);
    }
    if (nameKey) {
      lookup.set(nameKey, code);
    }
  }

  const encounterCodes = collectEncounterCodes(cards);
  for (const code of encounterCodes) {
    const key = normalizeEncounterKey(code);
    if (key && !lookup.has(key)) {
      lookup.set(key, code);
    }
  }

  return lookup;
}

function buildEncounterDecklist(cards, encounterCode) {
  const normalizedCode = normalizeEncounterCode(encounterCode);
  const entries = new Map();

  for (const card of cards) {
    const code = normalizeEncounterCode(card?.encounter_code || card?.encounterCode);
    if (!code || code !== normalizedCode) continue;

    const key = String(card?.code || card?.name || `${card?.pack_code || ''}-${card?.position || ''}`);
    const quantity = parseQuantity(card?.quantity);
    const encounterPosition = parseIndex(card?.encounter_position);
    const position = parseIndex(card?.position);

    const existing = entries.get(key);
    if (existing) {
      existing.count += quantity;
      existing.encounterPosition = Math.min(existing.encounterPosition, encounterPosition);
      existing.position = Math.min(existing.position, position);
    } else {
      entries.set(key, {
        card,
        count: quantity,
        encounterPosition,
        position,
      });
    }
  }

  const sorted = Array.from(entries.values()).sort((a, b) => {
    if (a.encounterPosition !== b.encounterPosition) {
      return a.encounterPosition - b.encounterPosition;
    }
    if (a.position !== b.position) {
      return a.position - b.position;
    }
    const nameA = formatCardName(a.card);
    const nameB = formatCardName(b.card);
    if (nameA !== nameB) {
      return nameA.localeCompare(nameB);
    }
    return String(a.card.code || '').localeCompare(String(b.card.code || ''));
  });

  return sorted.map(entry => formatDeckLine(entry.card, entry.count));
}

function collectEncounterCodes(cards) {
  const codes = new Set();
  for (const card of cards) {
    const code = normalizeEncounterCode(card?.encounter_code || card?.encounterCode);
    if (code) {
      codes.add(code);
    }
  }
  return Array.from(codes.values());
}

function suggestEncounters(normalizedInput, encounterMeta, lookup) {
  const suggestions = [];
  const seen = new Set();

  for (const meta of encounterMeta) {
    const code = normalizeEncounterCode(meta.code);
    const nameKey = normalizeEncounterKey(meta.name);
    if (!code || seen.has(code)) continue;

    if (normalizedInput.includes(code) || code.includes(normalizedInput) || (nameKey && nameKey.includes(normalizedInput))) {
      suggestions.push(formatEncounterLabel(meta));
      seen.add(code);
    }
  }

  if (suggestions.length) {
    return suggestions;
  }

  for (const [key, code] of lookup.entries()) {
    if (seen.has(code)) continue;
    if (key.includes(normalizedInput) || normalizedInput.includes(key)) {
      suggestions.push(code);
      seen.add(code);
    }
  }

  return suggestions.sort((a, b) => a.localeCompare(b));
}

function formatEncounterLabel(meta) {
  if (!meta || !meta.code) return '(unknown encounter)';
  const name = meta.name ? ` — ${meta.name}` : '';
  return `${meta.code}${name}`;
}

function normalizeEncounterKey(value) {
  return normalizeName(String(value || '').replace(/[_-]+/g, ' '));
}

function normalizeEncounterCode(value) {
  return String(value || '').trim().toLowerCase();
}

function parseQuantity(raw) {
  const number = Number(raw);
  if (Number.isInteger(number) && number > 0) {
    return number;
  }
  return 1;
}

function parseIndex(raw) {
  const number = Number(raw);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function formatCardName(card) {
  if (!card) return '(unknown card)';
  if (card.name) return String(card.name);
  if (card.subname) return String(card.subname);
  if (card.code) return String(card.code);
  return '(unknown card)';
}

function formatDeckLine(card, count) {
  const name = formatCardName(card);
  const code = card?.code ? `[${card.code}]` : '';
  return `${count} ${name}${code}`;
}

function printEncounterList(encounterMeta) {
  if (!encounterMeta.length) {
    console.log('No encounter metadata found in encounters.json.');
    return;
  }

  console.log('Available encounters/scenarios:');
  encounterMeta
    .slice()
    .sort((a, b) => {
      if (a.name && b.name && a.name !== b.name) {
        return a.name.localeCompare(b.name);
      }
      return a.code.localeCompare(b.code);
    })
    .forEach(meta => {
      console.log(`- ${formatEncounterLabel(meta)}`);
    });
}

function findEncounterName(encounterMeta, encounterCode) {
  const normalizedCode = normalizeEncounterCode(encounterCode);
  const match = encounterMeta.find(meta => normalizeEncounterCode(meta.code) === normalizedCode);
  return match ? match.name : null;
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
