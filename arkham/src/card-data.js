const fs = require('fs');
const path = require('path');
const { normalizeName } = require('../../shared/deck-utils');

async function loadCardDatabase(dataDir) {
  const packRoot = path.join(dataDir, 'pack');
  const packEntries = await readDirSafe(packRoot);
  const packs = packEntries.filter(entry => entry.isDirectory()).map(entry => entry.name);
  if (!packs.length) {
    throw new Error(`No pack JSON files were found under ${packRoot}`);
  }

  const cards = [];
  for (const pack of packs) {
    const packPath = path.join(packRoot, pack);
    const files = (await readDirSafe(packPath)).filter(entry => entry.isFile()).map(entry => entry.name);
    for (const fileName of files) {
      if (!fileName.endsWith('.json')) continue;
      const filePath = path.join(packPath, fileName);
      const raw = await fs.promises.readFile(filePath, 'utf8');
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          cards.push(...parsed);
        }
      } catch (error) {
        console.warn(`Skipping ${filePath}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  return cards;
}

async function readDirSafe(dirPath) {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Unable to read ${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function buildCardLookup(cards) {
  const lookup = new Map();
  const addKey = (key, card) => {
    const normalized = normalizeName(key);
    if (!normalized) return;
    const existing = lookup.get(normalized);
    if (existing) {
      existing.push(card);
    } else {
      lookup.set(normalized, [card]);
    }
  };

  for (const card of cards) {
    addKey(card.code, card);
    addKey(card.name, card);
    if (card.name && card.subname) {
      addKey(`${card.name}: ${card.subname}`, card);
      addKey(`${card.name} — ${card.subname}`, card);
    }
    if (Number.isFinite(card.xp)) {
      addKey(`${card.name} (${card.xp})`, card);
    }
  }

  return lookup;
}

function describeAmbiguousCandidates(candidates) {
  return candidates
    .map(card => {
      const headerParts = [card.code || '(no code)', card.name || '(no name)'];
      if (Number.isFinite(card.xp)) {
        headerParts.push(`XP ${card.xp}`);
      }
      const header = headerParts.filter(Boolean).join(' — ');
      const text = typeof card.text === 'string' && card.text.trim() ? card.text.trim() : '(no description)';
      return `- ${header}: ${text}`;
    })
    .join('\n');
}

function findAmbiguousEntries(entries, lookup) {
  const ambiguous = [];
  for (const entry of entries) {
    if (entry.code) continue;

    const key = normalizeName(entry.name);
    const matches = lookup.get(key);
    if (!matches || !matches.length) continue;

    const unique = dedupeByCode(matches);
    const candidates = unique.length ? unique : matches;
    if (candidates.length > 1) {
      ambiguous.push({ entry, candidates });
    }
  }
  return ambiguous;
}

function assertNoAmbiguousCards(entries, lookup) {
  const ambiguous = findAmbiguousEntries(entries, lookup);
  if (!ambiguous.length) return;

  const details = ambiguous
    .map(({ entry, candidates }) => `Card "${entry.name}" is ambiguous. Candidates:\n${describeAmbiguousCandidates(candidates)}`)
    .join('\n\n');

  throw new Error(`Found ambiguous cards. Specify a code or XP value to disambiguate each.\n\n${details}`);
}

function resolveDeckCards(entries, lookup, options = {}) {
  const attachEntry = Boolean(options.attachEntry);
  assertNoAmbiguousCards(entries, lookup);
  const cards = [];
  for (const entry of entries) {
    const card = resolveCard(entry, lookup);
    for (let i = 0; i < entry.count; i++) {
      cards.push(attachEntry ? { card, entry } : card);
    }
  }
  return cards;
}

function resolveCard(entry, lookup) {
  if (!entry) {
    throw new Error('Cannot resolve an empty deck entry.');
  }

  if (entry.code) {
    const codeKey = normalizeName(entry.code);
    const codeMatches = lookup.get(codeKey);
    if (!codeMatches || !codeMatches.length) {
      throw new Error(`Card code "${entry.code}" was not found in arkhamdb-json-data.`);
    }
    return dedupeByCode(codeMatches)[0] || codeMatches[0];
  }

  const key = normalizeName(entry.name);
  const matches = lookup.get(key);
  if (!matches || !matches.length) {
    throw new Error(`Card "${entry.name}" was not found in arkhamdb-json-data.`);
  }

  const unique = dedupeByCode(matches);
  const candidates = unique.length ? unique : matches;
  if (candidates.length > 1) {
    const details = describeAmbiguousCandidates(candidates);
    throw new Error(`Card "${entry.name}" is ambiguous. Candidates:\n${details}`);
  }
  return candidates[0];
}

function dedupeByCode(cards) {
  const seen = new Map();
  for (const card of cards) {
    if (!card || !card.code) continue;
    if (!seen.has(card.code)) {
      seen.set(card.code, card);
    }
  }
  return Array.from(seen.values());
}

function buildCardCodeIndex(cards) {
  const map = new Map();
  for (const card of cards) {
    if (card && card.code) {
      map.set(String(card.code).trim(), card);
    }
  }
  return map;
}

module.exports = {
  buildCardLookup,
  buildCardCodeIndex,
  assertNoAmbiguousCards,
  findAmbiguousEntries,
  loadCardDatabase,
  resolveCard,
  resolveDeckCards,
};
