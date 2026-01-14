const fs = require('fs');
const path = require('path');
const { normalizeName } = require('../../shared/deck-utils');
const { normalizeCardKey } = require('./decklist');

const DEFAULT_BASE_URL = 'https://ringsdb.com';

class AmbiguousCardError extends Error {
  constructor(entry, candidates) {
    const name = entry?.name || '(unknown)';
    const exampleCode = candidates?.[0]?.code ? String(candidates[0].code) : '';
    const details = Array.isArray(candidates)
      ? candidates
          .map(
            card =>
              `- ${card.code || '(no code)'} — ${card.fullName || card.name || '(no name)'} (${card.pack_name || card.pack_code || 'unknown pack'})`,
          )
          .join('\n')
      : '';

    super(
      `Card "${name}" is ambiguous. Add a code like "[${exampleCode || '01001'}]" to disambiguate.${details ? `\n${details}` : ''}`,
    );
    this.name = 'AmbiguousCardError';
    this.entry = entry || null;
    this.candidates = Array.isArray(candidates) ? candidates : [];
    Error.captureStackTrace?.(this, AmbiguousCardError);
  }
}

async function loadCardDatabase(options = {}) {
  const {
    cachePath = path.join(__dirname, '..', '.cache', 'ringsdb-cards.json'),
    refresh = false,
    baseUrl = DEFAULT_BASE_URL,
  } = options;

  const resolvedCachePath = path.resolve(cachePath);
  if (!refresh) {
    const cached = await readJsonIfExists(resolvedCachePath);
    if (cached) return normalizeCards(cached);
  }

  await fs.promises.mkdir(path.dirname(resolvedCachePath), { recursive: true });

  const url = new URL('/api/public/cards/', baseUrl);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch RingsDB cards: ${response.status} ${response.statusText}`);
  }

  const cards = await response.json();
  if (!Array.isArray(cards)) {
    throw new Error('RingsDB returned an unexpected payload (expected an array).');
  }

  await fs.promises.writeFile(resolvedCachePath, JSON.stringify(cards, null, 2));
  return normalizeCards(cards);
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function normalizeCards(rawCards) {
  const out = [];
  for (const raw of Array.isArray(rawCards) ? rawCards : []) {
    const normalized = normalizeRawCard(raw);
    if (normalized) out.push(normalized);
  }
  return out;
}

function normalizeRawCard(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const code = raw.code != null ? String(raw.code).trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!code || !name) return null;

  const packCode = typeof raw.pack_code === 'string' ? raw.pack_code.trim().toLowerCase() : '';
  const packName = typeof raw.pack_name === 'string' ? raw.pack_name.trim() : '';
  const position = Number.isInteger(raw.position) ? raw.position : toInt(raw.position);

  const type = normalizeType(raw.type_code, raw.type_name);
  const sphere = normalizeSphere(raw.sphere_code, raw.sphere_name);

  const traits = parseTraits(raw.traits);
  const textFront = stripHtml(raw.text);

  return {
    code,
    name,
    fullName: name,
    pack_code: packCode || null,
    pack_name: packName || null,
    position: position !== null ? position : null,
    type,
    sphere,
    sphere_code: typeof raw.sphere_code === 'string' ? raw.sphere_code.trim().toLowerCase() : null,
    unique: raw.is_unique === true,
    cost: toNumber(raw.cost),
    threat: toNumber(raw.threat),
    willpower: toNumber(raw.willpower),
    attack: toNumber(raw.attack),
    defense: toNumber(raw.defense),
    health: toNumber(raw.health),
    deckLimit: toInt(raw.deck_limit),
    quantity: toInt(raw.quantity),
    traits,
    textFront,
    flavor: stripHtml(raw.flavor),
    images: {
      front: typeof raw.imagesrc === 'string' ? raw.imagesrc.trim() : '',
      back: '',
    },
    url: typeof raw.url === 'string' ? raw.url.trim() : '',
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isInteger(num) ? num : null;
}

function normalizeType(typeCode, typeName) {
  const preferred = typeof typeName === 'string' && typeName.trim() ? typeName.trim() : typeof typeCode === 'string' ? typeCode.trim() : '';
  const normalized = preferred.toLowerCase();
  return normalized || null;
}

function normalizeSphere(sphereCode, sphereName) {
  const preferred = typeof sphereName === 'string' && sphereName.trim() ? sphereName.trim() : typeof sphereCode === 'string' ? sphereCode.trim() : '';
  const normalized = preferred.toLowerCase();
  return normalized || null;
}

function parseTraits(rawTraits) {
  const raw = typeof rawTraits === 'string' ? rawTraits.trim() : '';
  if (!raw) return [];

  const tokens = raw
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);

  return tokens;
}

function stripHtml(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  if (!raw) return '';
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCardCodeIndex(cards) {
  const map = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (card && card.code) map.set(String(card.code).trim(), card);
  }
  return map;
}

function buildCardLookup(cards) {
  const cardIndex = buildCardCodeIndex(cards);
  const lookup = new Map();
  const seenByKey = new Map(); // normalizedKey -> Set(code)

  const addDeduped = (key, card) => {
    const normalized = normalizeCardKey(key);
    if (!normalized) return;
    const code = String(card?.code || '');
    if (!code) return;
    const set = seenByKey.get(normalized) || new Set();
    if (set.has(code)) return;
    set.add(code);
    seenByKey.set(normalized, set);

    const existing = lookup.get(normalized);
    if (existing) existing.push(card);
    else lookup.set(normalized, [card]);
  };

  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card) continue;
    if (card.code) addDeduped(card.code, card);
    if (card.name) addDeduped(card.name, card);
  }

  return { lookup, cardIndex };
}

function resolveCardByCode(code, cardIndex) {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) throw new Error('Card code is missing.');
  const direct = cardIndex.get(raw);
  if (direct) return direct;
  throw new Error(`Card code "${raw}" was not found in RingsDB data.`);
}

function resolveCard(entry, lookup, cardIndex) {
  if (!entry) {
    throw new Error('Cannot resolve an empty deck entry.');
  }

  if (entry.code) {
    return resolveCardByCode(entry.code, cardIndex);
  }

  const key = normalizeCardKey(entry.name);
  const matches = lookup.get(key);
  if (!matches || !matches.length) {
    throw new Error(`Card "${entry.name}" was not found in RingsDB data.`);
  }

  const unique = dedupeByCode(matches);
  const candidates = unique.length ? unique : matches;
  if (candidates.length > 1) {
    const disambiguated = disambiguateByHint(entry, candidates);
    if (disambiguated) return disambiguated;
    throw new AmbiguousCardError(entry, candidates);
  }

  return candidates[0];
}

function disambiguateByHint(entry, candidates) {
  const hint = entry?.ringsdb;
  if (!hint || !Array.isArray(candidates) || candidates.length < 2) return null;

  const packCode = hint.packCode ? normalizeName(hint.packCode) : '';
  const packName = hint.packName ? normalizeName(hint.packName) : '';
  const position = Number.isInteger(hint.position) ? hint.position : null;

  let filtered = candidates.slice();

  if (packCode) {
    filtered = filtered.filter(card => normalizeName(card?.pack_code) === packCode);
  } else if (packName) {
    filtered = filtered.filter(card => normalizeName(card?.pack_name) === packName);
  }

  if (position !== null) {
    filtered = filtered.filter(card => Number(card?.position) === position);
  }

  if (filtered.length === 1) return filtered[0];
  return null;
}

function resolveDeckCards(entries, lookup, cardIndex, options = {}) {
  const { attachEntry = false, preservePageBreaks = false } = options;
  const cards = [];
  const failures = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.proxyPageBreak) {
      if (preservePageBreaks) cards.push({ proxyPageBreak: true });
      continue;
    }
    if (!entry) continue;

    let card;
    try {
      card = resolveCard(entry, lookup, cardIndex);
    } catch (err) {
      failures.push({ entry, error: err });
      continue;
    }

    for (let i = 0; i < (Number(entry.count) || 0); i += 1) {
      cards.push(attachEntry ? { card, entry } : card);
    }
  }

  if (failures.length) {
    throw new Error(formatDeckResolutionError(failures));
  }

  return cards;
}

function formatDeckResolutionError(failures) {
  const items = (Array.isArray(failures) ? failures : []).map(item => {
    const entry = item?.entry || null;
    const err = item?.error;
    const message = err instanceof Error ? err.message : String(err);
    return {
      entry,
      message,
      isAmbiguous: err instanceof AmbiguousCardError,
      candidates: err instanceof AmbiguousCardError ? err.candidates : [],
    };
  });

  items.sort((a, b) => {
    const fileA = typeof a.entry?.source?.file === 'string' ? a.entry.source.file : '';
    const fileB = typeof b.entry?.source?.file === 'string' ? b.entry.source.file : '';
    if (fileA !== fileB) return fileA.localeCompare(fileB);
    const lineA = Number(a.entry?.source?.line) || 0;
    const lineB = Number(b.entry?.source?.line) || 0;
    if (lineA !== lineB) return lineA - lineB;
    return String(a.entry?.name || '').localeCompare(String(b.entry?.name || ''));
  });

  const lines = [
    `Failed to resolve ${items.length} deck entr${items.length === 1 ? 'y' : 'ies'}:`,
  ];

  for (const item of items) {
    const entry = item.entry || {};
    const sourceLabel = formatDeckEntrySource(entry.source);
    const countLabel = Number(entry.count) > 0 ? ` (x${Number(entry.count)})` : '';
    const sectionLabel = entry.section ? ` [${entry.section}]` : '';
    lines.push(`- ${entry.name || '(unknown)'}${countLabel}${sectionLabel}${sourceLabel ? ` — ${sourceLabel}` : ''}`);
    lines.push(`  - ${item.message}`);

    if (item.isAmbiguous && Array.isArray(item.candidates)) {
      for (const card of item.candidates) {
        lines.push(
          `  - candidate: ${card.code || '(no code)'} — ${card.fullName || card.name || '(no name)'} (${card.pack_name || card.pack_code || 'unknown pack'})`,
        );
      }
    }
  }

  return lines.join('\n');
}

function formatDeckEntrySource(source) {
  if (!source || typeof source !== 'object') return '';
  const file = typeof source.file === 'string' ? source.file : '';
  const line = Number.isInteger(source.line) ? source.line : null;
  if (!file && line === null) return '';

  let displayFile = file;
  if (file) {
    const relative = path.relative(process.cwd(), file);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      displayFile = relative;
    }
  }

  if (displayFile && line !== null) return `${displayFile}:${line}`;
  if (displayFile) return displayFile;
  if (line !== null) return `line ${line}`;
  return '';
}

function dedupeByCode(cards) {
  const seen = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || !card.code) continue;
    if (!seen.has(card.code)) seen.set(card.code, card);
  }
  return Array.from(seen.values());
}

module.exports = {
  DEFAULT_BASE_URL,
  AmbiguousCardError,
  loadCardDatabase,
  buildCardLookup,
  buildCardCodeIndex,
  resolveCard,
  resolveDeckCards,
};

