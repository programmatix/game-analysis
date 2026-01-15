const fs = require('fs');
const path = require('path');
const https = require('https');
const { normalizeName } = require('../../shared/deck-utils');

class AmbiguousCardError extends Error {
  constructor(entry, candidates) {
    const name = entry?.name || '(unknown)';
    const exampleCode = candidates?.[0]?.code ? String(candidates[0].code) : '';
    const details = Array.isArray(candidates)
      ? candidates.map(card => `- ${card.code || '(no code)'} — ${card.fullName || card.name || '(no name)'} (${card.set || 'unknown set'})`).join('\n')
      : '';

    super(
      `Card "${name}" is ambiguous. Add a code like "[${exampleCode || 'SOR-001'}]" to disambiguate.${details ? `\n${details}` : ''}`,
    );
    this.name = 'AmbiguousCardError';
    this.entry = entry || null;
    this.candidates = Array.isArray(candidates) ? candidates : [];
    Error.captureStackTrace?.(this, AmbiguousCardError);
  }
}

async function loadCardDatabase(options = {}) {
  const {
    dataFile = null,
    includeSets = null,
    cacheDir = DEFAULT_DB_CACHE_DIR,
    maxAgeMs = resolveDefaultMaxAgeMs(),
  } = options;

  const baseCards = await loadFromRemoteDatabase(includeSets, { cacheDir, maxAgeMs });
  const extraCards = dataFile ? await loadFromFile(dataFile) : [];
  return normalizeCards([...baseCards, ...extraCards]);
}

const DEFAULT_DB_CACHE_DIR = path.resolve(__dirname, '..', '.cache', 'swu-card-db');
const DEFAULT_DB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const SWU_JSON_SET_SOURCES = [
  {
    set: 'SOR',
    url: 'https://raw.githubusercontent.com/erlloyd/star-wars-unlimited-json/main/sets/Spark%20of%20Rebellion.json',
  },
  {
    set: 'SHD',
    url: 'https://raw.githubusercontent.com/erlloyd/star-wars-unlimited-json/main/sets/Shadows%20of%20the%20Galaxy.json',
  },
  {
    set: 'JTL',
    url: 'https://raw.githubusercontent.com/erlloyd/star-wars-unlimited-json/main/sets/Jump%20to%20Lightspeed.json',
  },
  {
    set: 'TWI',
    url: 'https://raw.githubusercontent.com/erlloyd/star-wars-unlimited-json/main/sets/Twilight%20of%20the%20Republic.json',
  },
];

function resolveDefaultMaxAgeMs() {
  if (isTruthyEnv('SWU_DB_REFRESH')) return 0;

  const rawDays = process.env.SWU_DB_MAX_AGE_DAYS;
  if (rawDays !== undefined) {
    const days = Number(rawDays);
    if (Number.isFinite(days) && days >= 0) return days * 24 * 60 * 60 * 1000;
  }

  return DEFAULT_DB_MAX_AGE_MS;
}

function isTruthyEnv(name) {
  const raw = process.env[name];
  if (raw === undefined) return false;
  const normalized = String(raw).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y';
}

async function loadFromRemoteDatabase(includeSets, { cacheDir, maxAgeMs }) {
  const requested = Array.isArray(includeSets) && includeSets.length
    ? new Set(includeSets.map(value => String(value || '').trim().toUpperCase()).filter(Boolean))
    : null;

  const sources = requested
    ? SWU_JSON_SET_SOURCES.filter(source => requested.has(source.set))
    : SWU_JSON_SET_SOURCES;

  if (!sources.length) {
    throw new Error(
      requested
        ? `No SWU card data sources matched the requested set(s): ${Array.from(requested).join(', ')}`
        : 'No SWU card data sources are configured.'
    );
  }

  await fs.promises.mkdir(cacheDir, { recursive: true });
  const out = [];

  for (const source of sources) {
    const cachePath = path.join(cacheDir, `${source.set}.json`);
    const jsonText = await readCachedOrDownload({
      url: source.url,
      cachePath,
      maxAgeMs,
      label: source.set,
    });

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      throw new Error(`Unable to parse cached SWU card data for ${source.set} (${cachePath}). Delete it and retry.`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`Unexpected SWU card data shape for ${source.set}; expected a JSON array (${cachePath}).`);
    }

    out.push(...parsed);
  }

  return out;
}

async function loadFromFile(filePath) {
  const resolved = path.resolve(String(filePath));
  const raw = await fs.promises.readFile(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.cards)) return parsed.cards;
  throw new Error(`--data-file must contain an array of cards (or {"cards":[...]}): ${resolved}`);
}

function normalizeCards(rawCards) {
  const out = [];
  for (const raw of Array.isArray(rawCards) ? rawCards : []) {
    const normalized = normalizeRawCard(raw);
    if (!normalized) continue;
    out.push(normalized);
  }
  return out;
}

function normalizeRawCard(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const set = normalizeSetCode(raw.Set || raw.set);
  const number = normalizeCardNumber(raw['#'] ?? raw.Number ?? raw.number ?? raw.no);
  const name = stringOrEmpty(raw['Card Name'] ?? raw.Name ?? raw.name);
  const title = stringOrEmpty(raw.Title ?? raw.Subtitle ?? raw.title);
  const type = normalizeType(raw.Type ?? raw.type ?? raw.cardType);

  if (!set || number === null || (!name && !title)) {
    return null;
  }

  const fullName = buildFullName(name, title);

  const aspects = normalizeAspects(raw);

  const traits = normalizeTraits(raw);
  const rarity = stringOrEmpty(raw.Rarity ?? raw.rarity).toUpperCase();
  const arena = normalizeArena(raw.Arena ?? raw.Arenas ?? raw.arena);

  const images = {
    front: stringOrEmpty(raw['Image Url Front'] ?? raw.FrontArt ?? raw.imageUrlFront ?? raw.image_front ?? raw.image?.url),
    back: stringOrEmpty(
      raw['Image Url back']
        ?? raw['Image Url Back']
        ?? raw.BackArt
        ?? raw.imageUrlBack
        ?? raw.image_back
        ?? raw.imageBackside?.url
    ),
  };

  return {
    set,
    number,
    code: formatCardCode(set, number),
    name,
    title,
    fullName,
    type,
    rarity: rarity || null,
    arena,
    unique: raw.Unique === true || raw.unique === true || normalizeName(raw.Unique) === 'true',
    aspects,
    cost: normalizeNumber(raw.Cost ?? raw.cost),
    power: normalizeNumber(raw.Power ?? raw.power),
    hp: normalizeNumber(raw.HP ?? raw.hp),
    traits,
    textFront: formatRulesText(raw),
    textBack: stringOrEmpty(raw['Back Text'] ?? raw.BackText ?? raw.textBack ?? raw.back_text ?? raw.backText),
    doubleSided: raw.DoubleSided === true || raw.doubleSided === true || normalizeName(raw.DoubleSided) === 'true',
    images,
    landscape: {
      front: raw['Front Landscape'] === true
        || normalizeName(raw['Front Landscape']) === 'true'
        || raw.image?.horizontal === true,
      back: raw['Back Landscape'] === true
        || normalizeName(raw['Back Landscape']) === 'true'
        || raw.imageBackside?.horizontal === true,
    },
    raw,
  };
}

function formatRulesText(raw) {
  const parts = [];
  const frontText = stringOrEmpty(raw['Front Text'] ?? raw.FrontText ?? raw.textFront ?? raw.front_text ?? raw.frontText);
  if (frontText) parts.push(frontText);
  const epicAction = stringOrEmpty(raw.EpicAction ?? raw.epicAction);
  if (epicAction) parts.push(epicAction);
  return parts.join('\n').trim();
}

function buildCardLookup(cards) {
  const cardIndex = buildCardCodeIndex(cards);
  const lookup = new Map();

  const addKey = (key, card) => {
    const normalized = normalizeCardKey(key);
    if (!normalized) return;
    const existing = lookup.get(normalized);
    if (existing) existing.push(card);
    else lookup.set(normalized, [card]);
  };

  const seenByKey = new Map(); // key -> Set(code)
  const addDeduped = (key, card) => {
    const normalized = normalizeCardKey(key);
    if (!normalized) return;
    const code = String(card?.code || '').trim();
    if (!code) return;
    const set = seenByKey.get(normalized) || new Set();
    if (set.has(code)) return;
    set.add(code);
    seenByKey.set(normalized, set);
    addKey(key, card);
  };

  for (const card of Array.isArray(cards) ? cards : []) {
    addDeduped(card.code, card);
    addDeduped(card.fullName, card);
    addDeduped(card.name, card);
    if (card.name && card.title) {
      addDeduped(`${card.name}, ${card.title}`, card);
      addDeduped(`${card.name} — ${card.title}`, card);
      addDeduped(`${card.name}: ${card.title}`, card);
      addDeduped(`${card.name} (${card.title})`, card);
    }
  }

  return { lookup, cardIndex };
}

function buildCardCodeIndex(cards) {
  const map = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    if (!card || !card.code) continue;
    const full = normalizeCode(card.code);
    if (full) map.set(full, card);

    const legacy = normalizeCode(`${card.set}${String(card.number).padStart(3, '0')}`);
    if (legacy) map.set(legacy, card);

    const numeric = normalizeNumericCode(card.number);
    if (numeric) {
      const existing = map.get(numeric);
      if (!existing) {
        map.set(numeric, card);
      } else if (existing.code !== card.code) {
        map.set(numeric, null);
      }
    }
  }
  return map;
}

function resolveCard(entry, lookup, cardIndex) {
  if (!entry) throw new Error('Cannot resolve an empty deck entry.');

  if (entry.code) {
    return resolveCardByCode(entry.code, cardIndex);
  }

  const key = normalizeCardKey(entry.name);
  const matches = lookup.get(key);
  if (!matches || !matches.length) {
    throw new Error(`Card "${entry.name}" was not found in the SWU card database.`);
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

function entryWantsAllMatches(entry) {
  const annotations = entry?.annotations;
  if (annotations?.matchAll) return true;
  const keywords = Array.isArray(annotations?.keywords) ? annotations.keywords : [];
  return keywords.some(keyword => String(keyword).trim().toLowerCase() === 'all');
}

function logMatchAllResolution(entry, candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length < 2) return;
  const maxCandidates = Number.isInteger(options.maxCandidates) ? options.maxCandidates : 50;

  const name = entry?.name || '(unknown)';
  const sourceLabel = formatDeckEntrySource(entry?.source);
  const countLabel = Number(entry?.count) > 0 ? ` (x${Number(entry.count)})` : '';
  const sectionLabel = entry?.section ? ` [${entry.section}]` : '';
  const header = `[All] "${name}"${countLabel}${sectionLabel}${sourceLabel ? ` — ${sourceLabel}` : ''} matched ${candidates.length} cards:`;

  const lines = [header];
  for (const card of candidates.slice(0, maxCandidates)) {
    lines.push(`- ${card?.code || '(no code)'} — ${card?.fullName || card?.name || '(no name)'} (${card?.set || 'unknown set'})`);
  }
  if (candidates.length > maxCandidates) {
    lines.push(`- ...and ${candidates.length - maxCandidates} more`);
  }
  console.warn(lines.join('\n'));
}

function resolveCards(entry, lookup, cardIndex) {
  if (!entry) throw new Error('Cannot resolve an empty deck entry.');

  if (entry.code) {
    return [resolveCardByCode(entry.code, cardIndex)];
  }

  const key = normalizeCardKey(entry.name);
  const matches = lookup.get(key);
  if (!matches || !matches.length) {
    throw new Error(`Card "${entry.name}" was not found in the SWU card database.`);
  }

  const unique = dedupeByCode(matches);
  const candidates = unique.length ? unique : matches;
  if (candidates.length > 1) {
    if (entryWantsAllMatches(entry)) {
      logMatchAllResolution(entry, candidates);
      return candidates;
    }

    const disambiguated = disambiguateByHint(entry, candidates);
    if (disambiguated) return [disambiguated];
    throw new AmbiguousCardError(entry, candidates);
  }

  return [candidates[0]];
}

function resolveCardByCode(code, cardIndex) {
  const raw = typeof code === 'string' ? code.trim() : '';
  if (!raw) throw new Error('Card code is missing.');

  const normalized = normalizeCode(raw);
  const direct = cardIndex.get(normalized);
  if (direct) return direct;
  if (direct === null) {
    throw new Error(`Card code "${raw}" is ambiguous across multiple sets; use a full code like "SOR-001".`);
  }

  const numeric = normalizeNumericCode(raw);
  if (numeric) {
    const byNumber = cardIndex.get(numeric);
    if (byNumber) return byNumber;
    if (byNumber === null) {
      throw new Error(`Card number "${raw}" is ambiguous across multiple sets; use a full code like "SOR-001".`);
    }
  }

  throw new Error(`Card code "${raw}" was not found in the SWU card database.`);
}

function resolveDeckCards(entries, lookup, cardIndex, options = {}) {
  const { attachEntry = false, preservePageBreaks = false } = options;
  const cards = [];
  const ambiguities = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.proxyPageBreak) {
      if (preservePageBreaks) cards.push({ proxyPageBreak: true });
      continue;
    }
    if (!entry) continue;

    let resolvedCards;
    try {
      resolvedCards = resolveCards(entry, lookup, cardIndex);
    } catch (err) {
      if (err instanceof AmbiguousCardError) {
        ambiguities.push(err);
        continue;
      }
      throw err;
    }

    for (const card of resolvedCards) {
      for (let i = 0; i < (Number(entry.count) || 0); i += 1) {
        cards.push(attachEntry ? { card, entry } : card);
      }
    }
  }

  if (ambiguities.length) {
    throw new Error(formatAmbiguousDeckError(ambiguities));
  }

  return cards;
}

function formatAmbiguousDeckError(ambiguities) {
  const items = (Array.isArray(ambiguities) ? ambiguities : []).map(err => ({
    name: err?.entry?.name || '(unknown)',
    count: Number(err?.entry?.count) || 0,
    source: err?.entry?.source || null,
    candidates: Array.isArray(err?.candidates) ? err.candidates : [],
  }));

  items.sort((a, b) => {
    const fileA = typeof a.source?.file === 'string' ? a.source.file : '';
    const fileB = typeof b.source?.file === 'string' ? b.source.file : '';
    if (fileA !== fileB) return fileA.localeCompare(fileB);
    const lineA = Number(a.source?.line) || 0;
    const lineB = Number(b.source?.line) || 0;
    if (lineA !== lineB) return lineA - lineB;
    return String(a.name).localeCompare(String(b.name));
  });

  const lines = [
    `Found ${items.length} ambiguous card reference${items.length === 1 ? '' : 's'}; add a code like "[SOR-001]" to disambiguate:`,
  ];

  for (const item of items) {
    const sourceLabel = formatDeckEntrySource(item.source);
    const countLabel = item.count > 0 ? ` (x${item.count})` : '';
    lines.push(`- ${item.name}${countLabel}${sourceLabel ? ` — ${sourceLabel}` : ''}`);
    for (const card of item.candidates) {
      lines.push(`  - ${card.code || '(no code)'} — ${card.fullName || card.name || '(no name)'} (${card.set || 'unknown set'})`);
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

function disambiguateByHint(entry, candidates) {
  const hint = entry?.swu;
  if (!hint || !Array.isArray(candidates) || candidates.length < 2) return null;
  const set = hint.set ? String(hint.set).trim().toUpperCase() : '';
  const number = Number.isInteger(hint.number) ? hint.number : null;

  let filtered = candidates.slice();
  if (set) filtered = filtered.filter(card => String(card?.set || '').toUpperCase() === set);
  if (number !== null) filtered = filtered.filter(card => Number(card?.number) === number);
  if (filtered.length === 1) return filtered[0];
  return null;
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

function normalizeCardKey(text) {
  const raw = typeof text === 'string' ? text : '';
  if (!raw.trim()) return '';
  return normalizeName(raw.replace(/\s*[—–-]\s*/g, ' ').replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim());
}

function normalizeCode(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const upper = raw.toUpperCase().replace(/\s+/g, '');
  const match = /^([A-Z]{2,4})-?(\d{1,3})$/.exec(upper);
  if (match) {
    return `${match[1]}-${match[2].padStart(3, '0')}`;
  }
  return upper;
}

function normalizeNumericCode(value) {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (!/^\d{1,3}$/.test(raw)) return '';
  return raw.padStart(3, '0');
}

function normalizeSetCode(value) {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!raw) return '';
  return /^[A-Z0-9]{2,5}$/.test(raw) ? raw : raw.replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

function normalizeCardNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(raw)) return null;
  const num = Math.floor(raw);
  if (num <= 0 || num > 999) return null;
  return num;
}

function normalizeType(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  return raw;
}

function normalizeArena(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = normalizeArena(item);
      if (normalized) return normalized;
    }
    return null;
  }

  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return null;
  return raw;
}

function normalizeAspect(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  return raw;
}

function normalizeAspects(raw) {
  const fromSwuJson = Array.isArray(raw?.Aspects) ? raw.Aspects : null;
  if (fromSwuJson) {
    return fromSwuJson.map(value => normalizeAspect(value)).filter(Boolean);
  }

  const fromArray = Array.isArray(raw?.aspects) ? raw.aspects : null;
  if (fromArray) {
    return fromArray.map(value => normalizeAspect(value)).filter(Boolean);
  }

  return [
    normalizeAspect(raw.Aspect1 ?? raw.aspect1),
    normalizeAspect(raw.Aspect2 ?? raw.aspect2),
  ].filter(Boolean);
}

function normalizeTraits(raw) {
  if (Array.isArray(raw?.Traits)) {
    return raw.Traits.map(value => stringOrEmpty(value)).filter(Boolean);
  }
  if (Array.isArray(raw?.traits)) {
    return raw.traits.map(value => stringOrEmpty(value)).filter(Boolean);
  }
  return collectTraits(raw);
}

function normalizeNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function stringOrEmpty(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function buildFullName(name, title) {
  const a = String(name || '').trim();
  const b = String(title || '').trim();
  if (a && b) return `${a}, ${b}`;
  return a || b;
}

function formatCardCode(set, number) {
  return `${String(set).toUpperCase()}-${String(number).padStart(3, '0')}`;
}

function collectTraits(raw) {
  const traits = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!/^trait\d+$/i.test(String(key))) continue;
    const trait = stringOrEmpty(value);
    if (trait) traits.push(trait);
  }
  return traits;
}

async function readCachedOrDownload({ url, cachePath, maxAgeMs, label }) {
  const maxAge = Number.isFinite(maxAgeMs) && maxAgeMs >= 0 ? maxAgeMs : DEFAULT_DB_MAX_AGE_MS;
  const cached = await readCacheFile(cachePath, maxAge);
  if (cached !== null) return cached;

  try {
    const fetched = await fetchText(url);
    await writeCacheFile(cachePath, fetched);
    return fetched;
  } catch (err) {
    const fallback = await readCacheFile(cachePath, Number.POSITIVE_INFINITY);
    if (fallback !== null) {
      console.warn(`Warning: unable to refresh SWU card data for ${label}; using cached copy (${cachePath}).`);
      return fallback;
    }
    throw new Error(`Unable to download SWU card data for ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function readCacheFile(cachePath, maxAgeMs) {
  try {
    const stat = await fs.promises.stat(cachePath);
    if (Number.isFinite(maxAgeMs) && maxAgeMs !== Number.POSITIVE_INFINITY) {
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > maxAgeMs) return null;
    }
    return await fs.promises.readFile(cachePath, 'utf8');
  } catch (_) {
    return null;
  }
}

async function writeCacheFile(cachePath, text) {
  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmpPath, text);
  await fs.promises.rename(tmpPath, cachePath);
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': 'lorcana-swu-tools' } },
      response => {
        const status = response.statusCode || 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          const redirect = new URL(location, url).toString();
          response.resume();
          fetchText(redirect).then(resolve, reject);
          return;
        }

        if (status !== 200) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }

        response.setEncoding('utf8');
        let data = '';
        response.on('data', chunk => {
          data += chunk;
        });
        response.on('end', () => resolve(data));
      }
    );
    request.on('error', reject);
  });
}

module.exports = {
  AmbiguousCardError,
  loadCardDatabase,
  buildCardLookup,
  buildCardCodeIndex,
  resolveCard,
  resolveCards,
  resolveDeckCards,
};
