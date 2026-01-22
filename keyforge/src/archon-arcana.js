const ARCHON_ARCANA_API = 'https://archonarcana.com/api.php';

function buildApiUrl(params) {
  const url = new URL(ARCHON_ARCANA_API);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'lorcana-cli/1.0 (keyforge-adventures)',
      accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = text && text.length < 500 ? `\n${text}` : '';
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})${detail}`);
  }
  return res.json();
}

async function cargoQuery({ tables, fields, where, orderBy, limit = 500 }) {
  const url = buildApiUrl({
    action: 'cargoquery',
    format: 'json',
    limit,
    tables,
    fields,
    where,
    order_by: orderBy,
  });

  const json = await fetchJson(url);
  if (json?.error) {
    throw new Error(json?.error?.info || 'Cargo query failed.');
  }
  return (json?.cargoquery || []).map(row => row.title || {});
}

function normalizeQuery(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function deriveImagePrefixFromSetNumber(setNumber) {
  const raw = String(setNumber || '').trim();
  const match = /^KFA0*([0-9]+)$/i.exec(raw);
  if (!match) {
    throw new Error(`Unable to derive card-image prefix from SetNumber "${raw}". Expected e.g. "KFA001".`);
  }

  const numeric = Number(match[1]);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`Unable to derive card-image prefix from SetNumber "${raw}".`);
  }

  const suffix = String(numeric).padStart(2, '0');
  return `KFA${suffix}-`;
}

async function listAdventures() {
  const rows = await cargoQuery({
    tables: 'SetInfo',
    fields: 'SetName,ShortName,SetNumber,ReleaseYear,ReleaseMonth',
    where: 'IsAdventure=1',
    orderBy: 'ReleaseYear,ReleaseMonth,SetName',
    limit: 500,
  });

  return rows.map(row => ({
    setName: row.SetName,
    shortName: row.ShortName,
    setNumber: row.SetNumber,
    releaseYear: row.ReleaseYear ? Number(row.ReleaseYear) : null,
    releaseMonth: row.ReleaseMonth ? Number(row.ReleaseMonth) : null,
  }));
}

function resolveAdventure(adventures, query) {
  const input = String(query || '').trim();
  if (!input) return null;

  const normalized = normalizeQuery(input);

  const exact = [];
  const partial = [];

  for (const adventure of Array.isArray(adventures) ? adventures : []) {
    const setName = String(adventure.setName || '');
    const shortName = String(adventure.shortName || '');
    const setNumber = String(adventure.setNumber || '');

    const candidates = [setName, shortName, setNumber].filter(Boolean);
    if (candidates.some(candidate => normalizeQuery(candidate) === normalized)) {
      exact.push(adventure);
      continue;
    }

    const setNameNormalized = normalizeQuery(setName);
    if (setNameNormalized.includes(normalized) || normalizeQuery(shortName).includes(normalized)) {
      partial.push(adventure);
    }
  }

  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return { ambiguous: true, matches: exact };

  if (partial.length === 1) return partial[0];
  if (partial.length > 1) return { ambiguous: true, matches: partial };

  return null;
}

async function listAdventureCards(adventure) {
  const setNumber = String(adventure?.setNumber || '').trim();
  const setName = String(adventure?.setName || '').trim();
  if (!setNumber || !setName) {
    throw new Error('Adventure is missing SetNumber or SetName.');
  }

  const prefix = deriveImagePrefixFromSetNumber(setNumber);
  const rows = await cargoQuery({
    tables: 'CardData',
    fields: 'Name,Image,Type,House,Rarity',
    where: `Image LIKE "${prefix}%"`,
    orderBy: 'Image',
    limit: 5000,
  });

  return rows
    .map(row => ({
      name: row.Name,
      image: row.Image,
      type: row.Type,
      house: row.House,
      rarity: row.Rarity,
      setName,
      setNumber,
    }))
    .filter(card => card.image && String(card.image).trim());
}

module.exports = {
  ARCHON_ARCANA_API,
  listAdventures,
  resolveAdventure,
  listAdventureCards,
  deriveImagePrefixFromSetNumber,
};

