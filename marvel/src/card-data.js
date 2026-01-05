const fs = require('fs');
const path = require('path');
const { normalizeName } = require('../../shared/deck-utils');
const { normalizeCardKey } = require('./decklist');

const DEFAULT_BASE_URL = 'https://marvelcdb.com';

async function loadCardDatabase(options = {}) {
  const {
    cachePath = path.join(__dirname, '..', '.cache', 'marvelcdb-cards.json'),
    refresh = false,
    baseUrl = DEFAULT_BASE_URL,
  } = options;

  const resolvedCachePath = path.resolve(cachePath);
  if (!refresh) {
    const cached = await readJsonIfExists(resolvedCachePath);
    if (cached) return cached;
  }

  await fs.promises.mkdir(path.dirname(resolvedCachePath), { recursive: true });

  const url = new URL('/api/public/cards/', baseUrl).toString();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch MarvelCDB cards: ${response.status} ${response.statusText}`);
  }

  const cards = await response.json();
  if (!Array.isArray(cards)) {
    throw new Error('MarvelCDB returned an unexpected payload (expected an array).');
  }

  await fs.promises.writeFile(resolvedCachePath, JSON.stringify(cards, null, 2));
  return cards;
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

function buildCardCodeIndex(cards) {
  const map = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (card && card.code) {
      map.set(String(card.code).trim(), card);
    }
  }
  return map;
}

function canonicalizeCard(card, cardIndex) {
  if (!card) return null;
  const dup = card.duplicate_of_code ? String(card.duplicate_of_code).trim() : '';
  if (!dup) return card;
  return cardIndex.get(dup) || card;
}

function buildCardLookup(cards) {
  const cardIndex = buildCardCodeIndex(cards);
  const lookup = new Map();

  const addKey = (key, card) => {
    const normalized = normalizeCardKey(key);
    if (!normalized) return;
    const existing = lookup.get(normalized);
    if (existing) {
      existing.push(card);
    } else {
      lookup.set(normalized, [card]);
    }
  };

  const seenByKey = new Map(); // key -> Set(code)

  const addDeduped = (key, card) => {
    const normalized = normalizeCardKey(key);
    if (!normalized) return;
    const code = String(card?.code || '');
    if (!code) return;
    const set = seenByKey.get(normalized) || new Set();
    if (set.has(code)) return;
    set.add(code);
    seenByKey.set(normalized, set);
    addKey(key, card);
  };

  for (const rawCard of Array.isArray(cards) ? cards : []) {
    const card = canonicalizeCard(rawCard, cardIndex);
    if (!card) continue;

    if (card.code) {
      addDeduped(card.code, card);
    }

    const name = card.name || card.real_name;
    if (name) {
      addDeduped(name, card);
    }

    if (name && card.subname) {
      addDeduped(`${name}: ${card.subname}`, card);
      addDeduped(`${name} — ${card.subname}`, card);
      addDeduped(`${name} (${card.subname})`, card);
    }
  }

  return { lookup, cardIndex };
}

function resolveCardByCode(code, cardIndex, defaultFace) {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) {
    throw new Error('Card code is missing.');
  }

  const direct = cardIndex.get(raw);
  if (direct) return direct;

  // Some Marvel Champions cards are suffixed with a/b sides (e.g. 01001a).
  // If the user provided a bare numeric code, try applying the default face.
  const hasFaceSuffix = /[a-z]$/i.test(raw);
  const face = normalizeFace(defaultFace);
  if (!hasFaceSuffix && face) {
    const withFace = `${raw}${face}`;
    const candidate = cardIndex.get(withFace);
    if (candidate) return candidate;
  }

  throw new Error(`Card code "${raw}" was not found in MarvelCDB data.`);
}

function normalizeFace(value) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  return lower === 'b' ? 'b' : lower === 'a' ? 'a' : null;
}

function resolveCard(entry, lookup, cardIndex, options = {}) {
  const defaultFace = options.defaultFace || 'a';
  if (!entry) {
    throw new Error('Cannot resolve an empty deck entry.');
  }

  if (entry.code) {
    return resolveCardByCode(entry.code, cardIndex, defaultFace);
  }

  const key = normalizeCardKey(entry.name);
  const matches = lookup.get(key);
  if (!matches || !matches.length) {
    throw new Error(`Card "${entry.name}" was not found in MarvelCDB data.`);
  }

  const unique = dedupeByCode(matches);
  const candidates = unique.length ? unique : matches;
  if (candidates.length > 1) {
    const disambiguated = disambiguateByHint(entry, candidates);
    if (disambiguated) {
      return disambiguated;
    }

    const details = candidates
      .map(card => `- ${card.code || '(no code)'} — ${card.name || '(no name)'} (${card.pack_name || card.pack_code || 'unknown pack'})`)
      .join('\n');
    throw new Error(`Card "${entry.name}" is ambiguous. Add a code like "[${candidates[0].code}]" to disambiguate.\n${details}`);
  }

  return candidates[0];
}

function disambiguateByHint(entry, candidates) {
  const hint = entry?.marvelcdb;
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

  if (filtered.length === 1) {
    return filtered[0];
  }

  return null;
}

function resolveDeckCards(entries, lookup, cardIndex, options = {}) {
  const { attachEntry = false, preservePageBreaks = false, defaultFace = 'a' } = options;
  const cards = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.proxyPageBreak) {
      if (preservePageBreaks) {
        cards.push({ proxyPageBreak: true });
      }
      continue;
    }
    if (!entry) continue;

    const card = resolveCard(entry, lookup, cardIndex, { defaultFace });
    for (let i = 0; i < (Number(entry.count) || 0); i += 1) {
      cards.push(attachEntry ? { card, entry } : card);
    }
  }

  return cards;
}

function dedupeByCode(cards) {
  const seen = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || !card.code) continue;
    if (!seen.has(card.code)) {
      seen.set(card.code, card);
    }
  }
  return Array.from(seen.values());
}

module.exports = {
  DEFAULT_BASE_URL,
  loadCardDatabase,
  buildCardLookup,
  buildCardCodeIndex,
  resolveCard,
  resolveDeckCards,
};
