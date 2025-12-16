#!/usr/bin/env node
const path = require('path');
const { Command } = require('commander');
const { normalizeName } = require('../../shared/deck-utils');
const { loadCardDatabase } = require('./card-data');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'arkhamdb-json-data');
const PLAYER_FACTIONS = new Set(['guardian', 'seeker', 'rogue', 'mystic', 'survivor', 'neutral']);

async function main() {
  const program = new Command();
  program
    .name('arkham-search')
    .description('Search Arkham Horror LCG cards by faction, cost, XP, traits, text, and more')
    .option('--data-dir <dir>', 'Path to arkhamdb-json-data root', DEFAULT_DATA_DIR)
    .option('-f, --faction <codes...>', 'Filter by faction (guardian, seeker, rogue, mystic, survivor, neutral)')
    .option('-c, --class <codes...>', 'Alias for --faction')
    .option('-t, --type <types...>', 'Filter by type (asset, event, skill, investigator, treachery, enemy)')
    .option('-s, --slot <slots...>', 'Filter by slot substring (hand, accessory, ally, arcane, etc)')
    .option('--trait <traits...>', 'Require one or more traits (matches all provided)')
    .option('--text <queries...>', 'Filter by rules text substring (case-insensitive; strips HTML tags)')
    .option('--name <queries...>', 'Filter by card name substring (case-insensitive)')
    .option('--pack <codes...>', 'Filter by pack code (core, tcu, etc)')
    .option('--xp <range>', 'XP/level range, e.g. "0-2" or "3"')
    .option('--cost <range>', 'Resource cost range, e.g. "0-4" or "X" (numeric only unless X is specified)')
    .option('--unique', 'Only show unique cards', false)
    .option('--include-encounter', 'Include encounter/mythos cards (excluded by default)', false)
    .option('--exclude-weaknesses', 'Omit weaknesses/basic weaknesses', false)
    .option('--show-text', 'Print rules text for each result', false)
    .option('--sort <fields>', 'Comma-separated sort fields (faction,xp,cost,name,type,pack)', 'faction,xp,name')
    .option('--limit <n>', 'Limit the number of results (0 means no limit)', '0')
    .parse(process.argv);

  const options = program.opts();
  const dataDir = path.resolve(options.dataDir);
  const cards = await loadCardDatabase(dataDir);

  const factions = parseFactions(options.faction, options.class);
  const types = parseListOption(options.type);
  const slots = parseListOption(options.slot);
  const traits = parseListOption(options.trait);
  const textQueries = parseListOption(options.text);
  const nameQueries = parseListOption(options.name);
  const packCodes = parseListOption(options.pack).map(value => value.toLowerCase());
  const xpRange = parseRangeOption('--xp', options.xp);
  const costRange = parseCostRange(options.cost);
  const sortFields = parseSortFields(options.sort);
  const limit = parseLimit(options.limit);

  const filtered = cards.filter(card =>
    matchesPlayerCard(card, options.includeEncounter)
    && matchesWeakness(card, options.excludeWeaknesses)
    && matchesFaction(card, factions)
    && matchesType(card, types)
    && matchesSlot(card, slots)
    && matchesTraits(card, traits)
    && matchesPack(card, packCodes)
    && matchesXp(card, xpRange)
    && matchesCost(card, costRange)
    && matchesName(card, nameQueries)
    && matchesRulesText(card, textQueries)
    && matchesUnique(card, options.unique)
  );

  const sorted = filtered.sort((a, b) => compareCards(a, b, sortFields));
  const output = limit > 0 ? sorted.slice(0, limit) : sorted;

  if (!output.length) {
    console.log('No cards matched your filters.');
    return;
  }

  output.forEach(card => {
    console.log(formatCardSummary(card, options.showText));
  });

  if (limit > 0 && sorted.length > limit) {
    console.log(`\nShowing first ${output.length} of ${sorted.length} matches.`);
  } else {
    console.log(`\n${sorted.length} card${sorted.length === 1 ? '' : 's'} matched.`);
  }
}

function parseFactions(factionOption, classOption) {
  const raw = [...parseListOption(factionOption), ...parseListOption(classOption)];
  const normalized = raw
    .map(value => normalizeFaction(value))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function parseListOption(raw) {
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .flatMap(value => String(value).split(','))
    .map(value => value.trim())
    .filter(Boolean);
}

function parseRangeOption(flag, raw) {
  if (!raw && raw !== 0) return null;
  const text = String(raw).trim();
  if (!text) return null;

  if (text.toLowerCase() === 'x') {
    return { allowX: true };
  }

  const match = /^(-?\d+(?:\.\d+)?)(?:\s*-\s*(-?\d+(?:\.\d+)?))?$/.exec(text);
  if (!match) {
    throw new Error(`${flag} must be a number or range like "0-3"`);
  }

  const [, minText, maxText] = match;
  const min = Number(minText);
  const max = maxText ? Number(maxText) : min;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error(`${flag} must contain valid numbers`);
  }
  if (max < min) {
    throw new Error(`${flag} maximum must be greater than or equal to minimum`);
  }

  return { min, max };
}

function parseCostRange(raw) {
  if (!raw && raw !== 0) return null;
  const text = String(raw).trim();
  if (!text) return null;

  if (/^x$/i.test(text)) {
    return { allowX: true };
  }

  const range = parseRangeOption('--cost', text);
  if (range) {
    range.allowX = /\bx\b/i.test(text);
  }
  return range;
}

function parseSortFields(raw) {
  if (!raw) return ['faction', 'xp', 'name'];
  return raw
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
}

function parseLimit(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('--limit must be a non-negative integer');
  }
  return value;
}

function matchesPlayerCard(card, includeEncounter) {
  if (includeEncounter) return true;
  const faction = String(card?.faction_code || '').toLowerCase();
  return faction && PLAYER_FACTIONS.has(faction);
}

function matchesWeakness(card, excludeWeaknesses) {
  if (!excludeWeaknesses) return true;
  const subtype = String(card?.subtype_code || '').toLowerCase();
  if (subtype.includes('weakness')) return false;
  const traits = (card?.traits || '').toLowerCase();
  return !traits.includes('weakness');
}

function matchesFaction(card, factions) {
  if (!factions.length) return true;
  const cardFactions = collectCardFactions(card);
  return factions.some(faction => cardFactions.has(faction));
}

function matchesType(card, types) {
  if (!types.length) return true;
  const type = String(card?.type_code || card?.type || '').toLowerCase();
  return types.some(expected => type === expected.toLowerCase());
}

function matchesSlot(card, slots) {
  if (!slots.length) return true;
  const slot = String(card?.slot || '').toLowerCase();
  if (!slot) return false;
  return slots.every(expected => slot.includes(expected.toLowerCase()));
}

function matchesTraits(card, traits) {
  if (!traits.length) return true;
  const traitSet = buildTraitSet(card?.traits);
  if (!traitSet.size) return false;
  return traits.every(trait => traitSet.has(trait.toLowerCase()));
}

function matchesPack(card, packCodes) {
  if (!packCodes.length) return true;
  const pack = String(card?.pack_code || '').toLowerCase();
  if (!pack) return false;
  return packCodes.includes(pack);
}

function matchesXp(card, range) {
  if (!range) return true;
  if (range.allowX && String(card?.xp).toLowerCase() === 'x') {
    return true;
  }
  const xp = Number(card?.xp);
  if (!Number.isFinite(xp)) return false;
  return xp >= range.min && xp <= range.max;
}

function matchesCost(card, range) {
  if (!range) return true;
  if (range.allowX && isXCost(card?.cost)) {
    return true;
  }
  const cost = Number(card?.cost);
  if (!Number.isFinite(cost)) return false;
  return cost >= range.min && cost <= range.max;
}

function matchesName(card, queries) {
  if (!queries.length) return true;
  const name = formatName(card).toLowerCase();
  if (!name) return false;
  return queries.every(query => name.includes(query.toLowerCase()));
}

function matchesRulesText(card, queries) {
  if (!queries.length) return true;
  const text = stripHtml(card?.text || '');
  if (!text) return false;
  const normalized = text.toLowerCase();
  return queries.every(query => normalized.includes(query.toLowerCase()));
}

function matchesUnique(card, requireUnique) {
  if (!requireUnique) return true;
  return Boolean(card?.is_unique);
}

function normalizeFaction(raw) {
  const value = normalizeName(raw);
  if (!value) return '';
  switch (value) {
    case 'g':
    case 'guard':
    case 'guardian':
      return 'guardian';
    case 's':
    case 'seek':
    case 'seeker':
      return 'seeker';
    case 'r':
    case 'rogue':
      return 'rogue';
    case 'm':
    case 'mystic':
      return 'mystic';
    case 'u':
    case 'surv':
    case 'survivor':
      return 'survivor';
    case 'n':
    case 'neutral':
      return 'neutral';
    default:
      return '';
  }
}

function collectCardFactions(card) {
  const set = new Set();
  const add = value => {
    const normalized = normalizeFaction(value);
    if (normalized) {
      set.add(normalized);
    }
  };
  add(card?.faction_code);
  add(card?.faction2_code);
  add(card?.faction3_code);
  return set;
}

function buildTraitSet(traitsText) {
  if (!traitsText) return new Set();
  const tokens = traitsText
    .split(/[.;]/)
    .map(token => token.trim())
    .filter(Boolean);
  return new Set(tokens.map(token => token.toLowerCase()));
}

function isXCost(cost) {
  if (typeof cost === 'string') {
    return cost.trim().toLowerCase() === 'x';
  }
  return false;
}

function compareCards(a, b, fields) {
  for (const field of fields) {
    const key = field.toLowerCase();
    const diff = compareField(a, b, key);
    if (diff !== 0) return diff;
  }
  return formatName(a).localeCompare(formatName(b));
}

function compareField(a, b, field) {
  switch (field) {
    case 'xp':
      return compareNumbers(a?.xp, b?.xp);
    case 'cost':
      return compareNumbers(a?.cost, b?.cost);
    case 'name':
      return formatName(a).localeCompare(formatName(b));
    case 'type':
      return String(a?.type_code || '').localeCompare(String(b?.type_code || ''));
    case 'pack':
      return String(a?.pack_code || '').localeCompare(String(b?.pack_code || ''));
    case 'faction': {
      const aFaction = primaryFaction(a);
      const bFaction = primaryFaction(b);
      const factionDiff = aFaction.localeCompare(bFaction);
      if (factionDiff !== 0) return factionDiff;
      return formatName(a).localeCompare(formatName(b));
    }
    default:
      return 0;
  }
}

function compareNumbers(a, b) {
  const aNum = Number(a);
  const bNum = Number(b);
  const aValid = Number.isFinite(aNum);
  const bValid = Number.isFinite(bNum);
  if (aValid && bValid) return aNum - bNum;
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

function primaryFaction(card) {
  const factions = collectCardFactions(card);
  if (factions.size === 0) return '';
  return Array.from(factions.values())[0];
}

function formatCardSummary(card, includeText) {
  const name = formatName(card);
  const faction = formatFactions(card);
  const xp = formatXp(card);
  const cost = formatCost(card);
  const type = formatType(card);
  const traits = formatTraits(card);
  const slot = formatSlot(card);
  const pack = String(card?.pack_code || '').toUpperCase();

  const parts = [`${name} [${faction}]`, `XP ${xp}`, `Cost ${cost}`, type];
  if (traits) {
    parts.push(traits);
  }
  if (slot) {
    parts.push(`${slot} slot`);
  }
  if (card?.code) {
    parts.push(`#${card.code}`);
  }
  if (pack) {
    parts.push(pack);
  }

  const header = parts.filter(Boolean).join(' — ');
  if (!includeText) return header;

  const rulesText = stripHtml(card?.text || '');
  if (!rulesText) return header;

  const wrappedText = rulesText
    .replace(/\s+/g, ' ')
    .trim();

  return `${header}\n  ${wrappedText}`;
}

function formatName(card) {
  if (!card) return '';
  const parts = [card.name || '(no name)'];
  if (card.subname) {
    parts.push(card.subname);
  }
  return parts.join(' — ');
}

function formatXp(card) {
  if (Number.isFinite(card?.xp)) return card.xp;
  if (isXCost(card?.xp)) return 'X';
  return '—';
}

function formatCost(card) {
  if (Number.isFinite(card?.cost)) return card.cost;
  if (isXCost(card?.cost)) return 'X';
  if (card?.cost === 0) return 0;
  if (typeof card?.cost === 'string' && card.cost.trim()) {
    return card.cost.trim();
  }
  return '—';
}

function formatType(card) {
  return card?.type_name || card?.type_code || '';
}

function formatTraits(card) {
  const traits = card?.traits;
  if (!traits) return '';
  const normalized = traits
    .split(/[.;]/)
    .map(part => part.trim())
    .filter(Boolean);
  return normalized.join(', ');
}

function formatSlot(card) {
  return typeof card?.slot === 'string' ? card.slot.trim() : '';
}

function formatFactions(card) {
  const factions = Array.from(collectCardFactions(card));
  if (!factions.length) return 'unknown';
  return factions.join('/');
}

function stripHtml(text) {
  if (!text) return '';
  return text.replace(/<\/?[^>]+>/g, '');
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
