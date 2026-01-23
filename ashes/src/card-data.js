const fs = require('fs');
const path = require('path');
const { normalizeCardKey } = require('./decklist');

const DEFAULT_API_BASE_URL = 'https://api.ashes.live';

class AmbiguousCardError extends Error {
  constructor(entry, candidates) {
    const name = entry?.name || '(unknown)';
    const exampleCode = candidates?.[0]?.stub ? String(candidates[0].stub) : '';
    const details = Array.isArray(candidates)
      ? candidates
          .map(card => `- ${card.stub || '(no stub)'} — ${card.name || '(no name)'} (${card.release?.name || card.release?.stub || 'unknown release'})`)
          .join('\n')
      : '';

    super(
      `Card "${name}" is ambiguous. Add a stub like "[stub:${exampleCode || 'some-card'}]" to disambiguate.${details ? `\n${details}` : ''}`,
    );
    this.name = 'AmbiguousCardError';
    this.entry = entry || null;
    this.candidates = Array.isArray(candidates) ? candidates : [];
    Error.captureStackTrace?.(this, AmbiguousCardError);
  }
}

async function loadCardDatabase(options = {}) {
  const {
    cachePath = path.join(__dirname, '..', '.cache', 'asheslive-cards.json'),
    refresh = false,
    baseUrl = DEFAULT_API_BASE_URL,
    showLegacy = false,
  } = options;

  const resolvedCachePath = path.resolve(cachePath);
  if (!refresh) {
    const cached = await readJsonIfExists(resolvedCachePath);
    if (cached) return cached;
  }

  await fs.promises.mkdir(path.dirname(resolvedCachePath), { recursive: true });
  const cards = await downloadAllCards({ baseUrl, showLegacy });
  await fs.promises.writeFile(resolvedCachePath, JSON.stringify(cards, null, 2));
  return cards;
}

async function downloadAllCards({ baseUrl, showLegacy }) {
  const out = [];
  const limit = 200;
  let nextUrl = new URL('/v2/cards', baseUrl);
  nextUrl.searchParams.set('limit', String(limit));
  nextUrl.searchParams.set('offset', '0');
  if (showLegacy) nextUrl.searchParams.set('show_legacy', 'true');

  for (;;) {
    const response = await fetch(nextUrl.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch Ashes.live cards: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) {
      throw new Error('Ashes.live returned an unexpected payload (expected { results: [] }).');
    }

    out.push(...payload.results);

    const next = typeof payload.next === 'string' ? payload.next.trim() : '';
    if (!next) break;
    nextUrl = new URL(next);
  }

  return out;
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
    const stub = card?.stub ? String(card.stub).trim() : '';
    if (!stub) continue;
    const key = stub.toLowerCase();
    if (!map.has(key)) map.set(key, card);
  }
  return map;
}

function buildCardLookup(cards) {
  const cardIndex = buildCardCodeIndex(cards);
  const lookup = new Map();

  const add = (key, card) => {
    const normalized = normalizeCardKey(key);
    if (!normalized) return;
    const existing = lookup.get(normalized);
    if (existing) existing.push(card);
    else lookup.set(normalized, [card]);
  };

  const seenByKey = new Map(); // key -> Set(stub)

  const addDeduped = (key, card) => {
    const normalized = normalizeCardKey(key);
    if (!normalized) return;
    const stub = String(card?.stub || '').trim();
    if (!stub) return;
    const set = seenByKey.get(normalized) || new Set();
    if (set.has(stub)) return;
    set.add(stub);
    seenByKey.set(normalized, set);
    add(key, card);
  };

  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card) continue;
    if (card.stub) addDeduped(card.stub, card);
    if (card.name) addDeduped(card.name, card);
  }

  return { lookup, cardIndex };
}

function resolveCardByStub(stub, cardIndex) {
  const raw = typeof stub === 'string' ? stub.trim() : '';
  if (!raw) throw new Error('Card stub is missing.');

  const direct = cardIndex.get(raw.toLowerCase());
  if (direct) return direct;

  throw new Error(`Card stub "${raw}" was not found in the Ashes.live card database.`);
}

function disambiguateByHint(entry, candidates) {
  if (!entry || !Array.isArray(candidates) || candidates.length < 2) return null;

  const hint = entry.ashes && typeof entry.ashes === 'object' ? entry.ashes : null;
  const releaseStub = hint?.releaseStub ? String(hint.releaseStub).trim().toLowerCase() : '';
  const typeHint = hint?.type ? String(hint.type).trim().toLowerCase() : '';

  let filtered = candidates.slice();
  if (releaseStub) {
    filtered = filtered.filter(card => String(card?.release?.stub || '').trim().toLowerCase() === releaseStub);
  }
  if (typeHint) {
    filtered = filtered.filter(card => String(card?.type || '').trim().toLowerCase().includes(typeHint));
  }

  return filtered.length === 1 ? filtered[0] : null;
}

function resolveCard(entry, lookup, cardIndex) {
  if (!entry) throw new Error('Cannot resolve an empty deck entry.');

  if (entry.code) {
    return resolveCardByStub(entry.code, cardIndex);
  }

  const key = normalizeCardKey(entry.name);
  const matches = lookup.get(key);
  if (!matches || !matches.length) {
    throw new Error(`Card "${entry.name}" was not found in the Ashes.live card database.`);
  }

  const candidates = matches;
  if (candidates.length > 1) {
    const disambiguated = disambiguateByHint(entry, candidates);
    if (disambiguated) return disambiguated;
    throw new AmbiguousCardError(entry, candidates);
  }

  return candidates[0];
}

function resolveDeckCards(entries, lookup, cardIndex, options = {}) {
  const { attachEntry = false, preservePageBreaks = false } = options;
  const cards = [];
  const ambiguities = [];
  const missing = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.proxyPageBreak) {
      if (preservePageBreaks) cards.push({ proxyPageBreak: true });
      continue;
    }
    if (!entry) continue;

    let resolved;
    try {
      resolved = resolveCard(entry, lookup, cardIndex);
    } catch (err) {
      if (err instanceof AmbiguousCardError) {
        ambiguities.push(err);
      } else {
        missing.push({ entry, err });
      }
      continue;
    }

    for (let i = 0; i < (Number(entry.count) || 0); i += 1) {
      cards.push(attachEntry ? { card: resolved, entry } : resolved);
    }
  }

  if (ambiguities.length || missing.length) {
    throw new Error(formatDeckResolutionError({ ambiguities, missing }));
  }

  return cards;
}

function formatDeckResolutionError({ ambiguities, missing }) {
  const lines = [];

  if (Array.isArray(missing) && missing.length) {
    lines.push(`Found ${missing.length} missing card reference${missing.length === 1 ? '' : 's'}:`);
    for (const item of missing) {
      const name = item?.entry?.name || '(unknown)';
      const sourceLabel = formatDeckEntrySource(item?.entry?.source);
      const countLabel = Number(item?.entry?.count) > 0 ? ` (x${Number(item.entry.count)})` : '';
      const message = item?.err instanceof Error ? item.err.message : String(item?.err || 'Unknown error');
      lines.push(`- ${name}${countLabel}${sourceLabel ? ` — ${sourceLabel}` : ''}: ${message}`);
    }
  }

  if (Array.isArray(ambiguities) && ambiguities.length) {
    if (lines.length) lines.push('');
    lines.push(
      `Found ${ambiguities.length} ambiguous card reference${ambiguities.length === 1 ? '' : 's'}; add a stub like "[stub:some-card]" to disambiguate:`,
    );
    for (const err of ambiguities) {
      const entry = err?.entry;
      const name = entry?.name || '(unknown)';
      const sourceLabel = formatDeckEntrySource(entry?.source);
      const countLabel = Number(entry?.count) > 0 ? ` (x${Number(entry.count)})` : '';
      lines.push(`- ${name}${countLabel}${sourceLabel ? ` — ${sourceLabel}` : ''}`);
      for (const card of Array.isArray(err?.candidates) ? err.candidates : []) {
        lines.push(`  - ${card?.stub || '(no stub)'} — ${card?.name || '(no name)'} (${card?.release?.name || card?.release?.stub || 'unknown release'})`);
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

function isMissingCardDatabaseError(err) {
  if (!(err instanceof Error)) return false;
  const message = String(err.message || '');
  return message.includes('was not found in the Ashes.live card database');
}

async function withCardDatabase(options, fn, config = {}) {
  if (typeof fn !== 'function') {
    throw new Error('withCardDatabase requires a callback function.');
  }

  const { onRefresh } = config || {};

  const cards = await loadCardDatabase(options);
  const { lookup, cardIndex } = buildCardLookup(cards);

  try {
    return await fn({ cards, lookup, cardIndex });
  } catch (err) {
    const refresh = Boolean(options?.refresh);
    if (!refresh && isMissingCardDatabaseError(err)) {
      if (typeof onRefresh === 'function') onRefresh(err);
      const refreshedCards = await loadCardDatabase({ ...(options || {}), refresh: true });
      const refreshedLookup = buildCardLookup(refreshedCards);
      return await fn({ cards: refreshedCards, lookup: refreshedLookup.lookup, cardIndex: refreshedLookup.cardIndex });
    }
    throw err;
  }
}

module.exports = {
  DEFAULT_API_BASE_URL,
  AmbiguousCardError,
  loadCardDatabase,
  buildCardCodeIndex,
  buildCardLookup,
  withCardDatabase,
  resolveCard,
  resolveDeckCards,
};
