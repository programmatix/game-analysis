#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { DEFAULT_BASE_URL, loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

const DEFAULT_DATA_CACHE = path.join(__dirname, '..', '.cache', 'ringsdb-cards.json');

async function main() {
  const program = new Command();
  program
    .name('lotr-download')
    .description('Download a RingsDB decklist and output it in this repo’s decklist format')
    .argument('<deck>', 'RingsDB decklist id or URL (e.g. 1 or https://ringsdb.com/decklist/view/1/...)')
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .option('--base-url <url>', 'RingsDB base URL', DEFAULT_BASE_URL)
    .option('--data-cache <file>', 'Where to cache RingsDB cards JSON', DEFAULT_DATA_CACHE)
    .option('--refresh-data', 'Re-download the RingsDB cards JSON into the cache', false)
    .option('--no-header', 'Do not include source header comments')
    .parse(process.argv);

  const options = program.opts();
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const { id, sourceUrl } = parseRingsDbDeckRef(program.args[0], baseUrl);

  const deck = await fetchRingsDbDeck(id, baseUrl);
  const cards = await loadCardDatabase({
    cachePath: options.dataCache ? path.resolve(options.dataCache) : DEFAULT_DATA_CACHE,
    refresh: Boolean(options.refreshData),
    baseUrl,
  });
  const { lookup, cardIndex } = buildCardLookup(cards);

  const { lines, warnings } = buildDecklistLines(deck, lookup, cardIndex, {
    sourceUrl,
    includeHeader: Boolean(options.header),
  });

  const outputText = `${lines.join('\n')}\n`;

  if (options.output) {
    const outPath = path.resolve(options.output);
    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
    await fs.promises.writeFile(outPath, outputText);
    console.log(`Wrote decklist to ${outPath}`);
  } else {
    process.stdout.write(outputText);
  }

  for (const warning of warnings) {
    console.warn(warning);
  }
}

function parseRingsDbDeckRef(input, baseUrl) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) {
    throw new Error('Deck reference is missing.');
  }

  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    return { id, sourceUrl: new URL(`/decklist/view/${id}`, baseUrl).toString() };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(raw);
  } catch (err) {
    throw new Error(`Expected a numeric id or URL, got "${raw}".`);
  }

  const match =
    /\/decklist\/view\/(\d+)/i.exec(parsedUrl.pathname)
    || /\/deck\/view\/(\d+)/i.exec(parsedUrl.pathname)
    || /\/api\/public\/decklist\/(\d+)/i.exec(parsedUrl.pathname)
    || /\/api\/public\/deck\/(\d+)/i.exec(parsedUrl.pathname);

  if (!match) {
    throw new Error(`Could not extract a deck id from URL path "${parsedUrl.pathname}".`);
  }

  const id = Number(match[1]);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`Invalid deck id "${match[1]}".`);
  }

  const canonicalSource = /\/deck\/view\//i.test(parsedUrl.pathname)
    ? new URL(`/deck/view/${id}`, parsedUrl.origin).toString()
    : new URL(`/decklist/view/${id}`, parsedUrl.origin).toString();

  return { id, sourceUrl: canonicalSource };
}

async function fetchRingsDbDeck(id, baseUrl) {
  const endpoints = [`/api/public/decklist/${id}`, `/api/public/deck/${id}`];
  const errors = [];

  for (const endpoint of endpoints) {
    const url = new URL(endpoint, baseUrl);
    const response = await fetch(url.toString());
    if (response.ok) {
      const json = await response.json();
      if (!json || typeof json !== 'object') {
        throw new Error('RingsDB returned an unexpected payload (expected an object).');
      }
      return json;
    }

    if (response.status === 404) {
      continue;
    }

    errors.push(`${endpoint}: ${response.status} ${response.statusText}`);
  }

  const extra = errors.length ? ` (${errors.join(', ')})` : '';
  throw new Error(`RingsDB deck "${id}" was not found${extra}.`);
}

function buildDecklistLines(deck, lookup, cardIndex, options = {}) {
  const includeHeader = Boolean(options.includeHeader);
  const sourceUrl = typeof options.sourceUrl === 'string' ? options.sourceUrl : null;

  const warnings = [];
  const lines = [];

  if (includeHeader) {
    if (deck?.name) lines.push(`# ${deck.name}`);
    if (Number.isFinite(deck?.starting_threat)) lines.push(`# Starting threat: ${deck.starting_threat}`);
    if (sourceUrl) lines.push(`# Source: ${sourceUrl}`);
    if (lines.length) lines.push('');
  }

  const entries = collectDeckEntries(deck);
  const sorted = entries.sort(compareEntriesByCode);

  let currentSection = null;
  for (const entry of sorted) {
    if (entry.section !== currentSection) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      lines.push(`${titleCase(entry.section)}:`);
      currentSection = entry.section;
    }

    let card;
    try {
      card = resolveCard({ code: entry.code }, lookup, cardIndex);
    } catch (err) {
      warnings.push(
        `Warning: Could not resolve card code "${entry.code}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const name = card?.fullName || card?.name || `<Unknown card ${entry.code}>`;
    lines.push(`${entry.count} ${name} [${entry.code}]`);
  }

  return { lines, warnings };
}

function collectDeckEntries(deck) {
  const out = [];
  const heroCodes = new Set();

  const addSlots = (section, slots, options = {}) => {
    if (!slots || typeof slots !== 'object') return;
    for (const [code, countRaw] of Object.entries(slots)) {
      const count = Number(countRaw);
      if (!Number.isFinite(count) || count <= 0) continue;
      const normalizedCode = String(code || '').trim();
      if (!normalizedCode) continue;
      if (options.skipCodes && options.skipCodes.has(normalizedCode)) continue;
      out.push({ section, code: normalizedCode, count });
    }
  };

  if (deck?.heroes && typeof deck.heroes === 'object') {
    for (const code of Object.keys(deck.heroes)) {
      const normalized = String(code || '').trim();
      if (normalized) heroCodes.add(normalized);
    }
  }

  addSlots('heroes', deck?.heroes);
  addSlots('deck', deck?.slots, { skipCodes: heroCodes });
  addSlots('sideboard', deck?.sideslots);

  return dedupeEntries(out);
}

function dedupeEntries(entries) {
  const merged = new Map(); // section::code -> { section, code, count }
  for (const entry of Array.isArray(entries) ? entries : []) {
    const section = String(entry?.section || '').trim() || 'deck';
    const code = String(entry?.code || '').trim();
    const count = Number(entry?.count) || 0;
    if (!code || count <= 0) continue;
    const key = `${section}::${code}`;
    const existing = merged.get(key);
    if (existing) existing.count += count;
    else merged.set(key, { section, code, count });
  }
  return Array.from(merged.values());
}

function compareEntriesByCode(a, b) {
  const sectionA = String(a?.section || '');
  const sectionB = String(b?.section || '');
  if (sectionA !== sectionB) {
    const order = ['heroes', 'deck', 'sideboard'];
    const indexA = order.indexOf(sectionA);
    const indexB = order.indexOf(sectionB);
    const rankA = indexA === -1 ? 999 : indexA;
    const rankB = indexB === -1 ? 999 : indexB;
    if (rankA !== rankB) return rankA - rankB;
    return sectionA.localeCompare(sectionB);
  }

  return String(a?.code || '').localeCompare(String(b?.code || ''), 'en', { numeric: true });
}

function titleCase(value) {
  const raw = String(value || '').trim().replace(/_/g, ' ');
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
