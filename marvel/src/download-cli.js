#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Command } = require('commander');
const { loadCardDatabase, buildCardLookup, resolveCard } = require('./card-data');

const DEFAULT_BASE_URL = 'https://marvelcdb.com';

async function main() {
  const program = new Command();
  program
    .name('marvel-download')
    .description('Download a MarvelCDB decklist and output it in this repo’s decklist format')
    .argument('<deck>', 'MarvelCDB decklist id or URL (e.g. 1 or https://marvelcdb.com/decklist/view/1/...)')
    .option('-o, --output <file>', 'Write output to a file instead of stdout')
    .option('--base-url <url>', 'MarvelCDB base URL', DEFAULT_BASE_URL)
    .option('--data-cache <file>', 'Where to cache MarvelCDB cards JSON', path.join('.cache', 'marvelcdb-cards.json'))
    .option('--refresh-data', 'Re-download the MarvelCDB cards JSON into the cache', false)
    .option('--face <a|b>', 'Default face for numeric codes like [01001]', 'a')
    .option('--no-hero-encounter', 'Do not include the hero’s obligation/nemesis encounter cards')
    .option('--only-hero-encounter', 'Only output the hero’s obligation/nemesis encounter cards')
    .option('--no-header', 'Do not include source header comments')
    .parse(process.argv);

  const options = program.opts();
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;
  const { id, sourceUrl } = parseMarvelCdbDeckRef(program.args[0], baseUrl);

  const deck = await fetchMarvelCdbDeck(id, baseUrl);
  const cards = await loadCardDatabase({
    cachePath: options.dataCache,
    refresh: Boolean(options.refreshData),
    baseUrl,
  });
  const { lookup, cardIndex } = buildCardLookup(cards);

  const defaultFace = String(options.face || 'a').toLowerCase() === 'b' ? 'b' : 'a';
  const onlyHeroEncounter = Boolean(options.onlyHeroEncounter);
  const includeHeroEncounter = onlyHeroEncounter || Boolean(options.heroEncounter);
  const { lines, warnings } = buildDecklistLines(deck, lookup, cardIndex, {
    defaultFace,
    sourceUrl,
    includeHeader: Boolean(options.header),
    includeHeroEncounter,
    onlyHeroEncounter,
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

function parseMarvelCdbDeckRef(input, baseUrl) {
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

async function fetchMarvelCdbDeck(id, baseUrl) {
  const endpoints = [`/api/public/decklist/${id}`, `/api/public/deck/${id}`];
  const errors = [];

  for (const endpoint of endpoints) {
    const url = new URL(endpoint, baseUrl);
    const response = await fetch(url.toString());
    if (response.ok) {
      const json = await response.json();
      if (!json || typeof json !== 'object') {
        throw new Error('MarvelCDB returned an unexpected payload (expected an object).');
      }
      return json;
    }

    if (response.status === 404) {
      continue;
    }

    errors.push(`${endpoint}: ${response.status} ${response.statusText}`);
  }

  const extra = errors.length ? ` (${errors.join(', ')})` : '';
  throw new Error(`MarvelCDB deck "${id}" was not found${extra}.`);
}

function buildDecklistLines(deck, lookup, cardIndex, options = {}) {
  const defaultFace = options.defaultFace || 'a';
  const includeHeader = Boolean(options.includeHeader);
  const includeHeroEncounter = Boolean(options.includeHeroEncounter);
  const onlyHeroEncounter = Boolean(options.onlyHeroEncounter);
  const sourceUrl = typeof options.sourceUrl === 'string' ? options.sourceUrl : null;

  const warnings = [];
  const lines = [];

  if (includeHeader) {
    if (deck?.name) lines.push(`# ${deck.name}`);
    if (deck?.hero_name) lines.push(`# Hero: ${deck.hero_name}`);
    if (sourceUrl) lines.push(`# Source: ${sourceUrl}`);
    if (lines.length) lines.push('');
  }

  const entries = onlyHeroEncounter ? [] : collectDeckEntries(deck);
  if (!onlyHeroEncounter) {
    appendLinkedEntries(entries, lookup, cardIndex, { defaultFace, warnings });
  }
  if (includeHeroEncounter) {
    appendHeroEncounterEntries(entries, deck, lookup, cardIndex, { defaultFace, warnings });
  }
  const sorted = entries.sort(compareEntriesByCode);

  for (const entry of sorted) {
    const { code, count, ignoreForDeckLimit } = entry;

    let card;
    try {
      card = resolveCard({ code }, lookup, cardIndex, { defaultFace });
    } catch (err) {
      warnings.push(
        `Warning: Could not resolve card code "${code}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const name = card?.name || card?.real_name || `<Unknown card ${code}>`;
    const keywords = ignoreForDeckLimit ? '[ignoreForDeckLimit]' : '';
    lines.push(`${count} ${name}[${code}]${keywords}`);
  }

  return { lines, warnings };
}

function collectDeckEntries(deck) {
  const out = [];

  const addSlots = (slots, extra = {}) => {
    if (!slots || typeof slots !== 'object') return;
    for (const [code, countRaw] of Object.entries(slots)) {
      const count = Number(countRaw);
      if (!Number.isFinite(count) || count <= 0) continue;
      const normalizedCode = String(code || '').trim();
      if (!normalizedCode) continue;
      out.push({ code: normalizedCode, count, ...extra });
    }
  };

  addSlots(deck?.slots);
  addSlots(deck?.ignoreDeckLimitSlots, { ignoreForDeckLimit: true });

  const heroCode = deck?.hero_code ? String(deck.hero_code).trim() : '';
  if (heroCode) {
    out.push({ code: heroCode, count: 1, ignoreForDeckLimit: true });
  }

  return dedupeEntries(out);
}

function appendLinkedEntries(entries, lookup, cardIndex, options = {}) {
  const defaultFace = options.defaultFace || 'a';
  const toAdd = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const code = String(entry?.code || '').trim();
    if (!code) continue;

    let card;
    try {
      card = resolveCard({ code }, lookup, cardIndex, { defaultFace });
    } catch (err) {
      continue;
    }

    const linkedCode = card?.linked_to_code ? String(card.linked_to_code).trim() : '';
    if (!linkedCode) continue;

    toAdd.push({
      code: linkedCode,
      count: 1,
      ignoreForDeckLimit: Boolean(entry.ignoreForDeckLimit),
    });
  }

  const merged = dedupeEntries([...(Array.isArray(entries) ? entries : []), ...toAdd]);
  entries.length = 0;
  entries.push(...merged);
}

function appendHeroEncounterEntries(entries, deck, lookup, cardIndex, options = {}) {
  const defaultFace = options.defaultFace || 'a';
  const warnings = Array.isArray(options.warnings) ? options.warnings : [];

  const heroCode = deck?.hero_code ? String(deck.hero_code).trim() : '';
  if (!heroCode) {
    warnings.push('Warning: Deck has no hero_code, so obligation/nemesis cards could not be added.');
    return;
  }

  let heroCard;
  try {
    heroCard = resolveCard({ code: heroCode }, lookup, cardIndex, { defaultFace });
  } catch (err) {
    warnings.push(
      `Warning: Could not resolve hero code "${heroCode}" to find obligation/nemesis cards: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }

  const heroSetCode = heroCard?.card_set_code ? String(heroCard.card_set_code).trim() : '';
  if (!heroSetCode) {
    warnings.push(`Warning: Hero "${heroCard?.name || heroCode}" has no card_set_code; cannot find obligation/nemesis cards.`);
    return;
  }

  const existingCounts = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const code = String(entry?.code || '').trim();
    if (!code) continue;
    const count = Number(entry?.count) || 0;
    existingCounts.set(code, (existingCounts.get(code) || 0) + count);
  }

  const toAdd = [];

  const obligation = collectSetCardsWithCounts(cardIndex, {
    cardSetCode: heroSetCode,
    typeCodes: ['obligation'],
  });
  if (!obligation.length) {
    warnings.push(`Warning: No obligation found for hero set "${heroSetCode}".`);
  } else {
    for (const { code, count } of obligation) {
      const already = existingCounts.get(code) || 0;
      const needed = Math.max(0, (Number(count) || 0) - already);
      if (needed <= 0) continue;
      toAdd.push({ code, count: needed });
    }
  }

  const nemesisSetCode = `${heroSetCode}_nemesis`;
  const nemesisCards = collectSetCardsWithCounts(cardIndex, {
    cardSetCode: nemesisSetCode,
    cardSetTypeCode: 'nemesis',
  });
  if (!nemesisCards.length) {
    warnings.push(`Warning: No nemesis cards found for hero set "${heroSetCode}" (expected card_set_code "${nemesisSetCode}").`);
  } else {
    for (const { code, count } of nemesisCards) {
      const already = existingCounts.get(code) || 0;
      const needed = Math.max(0, (Number(count) || 0) - already);
      if (needed <= 0) continue;
      toAdd.push({ code, count: needed });
    }
  }

  const merged = dedupeEntries([...(Array.isArray(entries) ? entries : []), ...toAdd]);
  entries.length = 0;
  entries.push(...merged);
}

function collectSetCardsWithCounts(cardIndex, options = {}) {
  const cardSetCode = typeof options.cardSetCode === 'string' ? options.cardSetCode.trim() : '';
  if (!cardSetCode) return [];

  const cardSetTypeCode = typeof options.cardSetTypeCode === 'string' ? options.cardSetTypeCode.trim() : '';
  const typeCodes = Array.isArray(options.typeCodes) ? options.typeCodes.map(v => String(v).toLowerCase()) : null;

  const codes = new Map(); // code -> count
  for (const card of cardIndex instanceof Map ? cardIndex.values() : []) {
    if (!card?.code) continue;
    if (String(card.card_set_code || '').trim() !== cardSetCode) continue;
    if (cardSetTypeCode && String(card.card_set_type_name_code || '').trim() !== cardSetTypeCode) continue;
    if (typeCodes && typeCodes.length) {
      const type = String(card.type_code || '').toLowerCase();
      if (!typeCodes.includes(type)) continue;
    }
    const code = String(card.code).trim();
    if (!code) continue;
    const quantityRaw = Number(card.quantity);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.floor(quantityRaw) : 1;
    codes.set(code, Math.max(codes.get(code) || 0, quantity));
  }
  return Array.from(codes.entries()).map(([code, count]) => ({ code, count }));
}

function dedupeEntries(entries) {
  const merged = new Map(); // code -> { code, count, ignoreForDeckLimit }
  for (const entry of Array.isArray(entries) ? entries : []) {
    const code = String(entry?.code || '').trim();
    if (!code) continue;
    const count = Number(entry.count) || 0;
    const ignoreForDeckLimit = Boolean(entry.ignoreForDeckLimit);

    const existing = merged.get(code);
    if (existing) {
      existing.count += count;
      existing.ignoreForDeckLimit = existing.ignoreForDeckLimit || ignoreForDeckLimit;
    } else {
      merged.set(code, { code, count, ignoreForDeckLimit });
    }
  }
  return Array.from(merged.values()).filter(entry => entry.count > 0);
}

function compareEntriesByCode(a, b) {
  const pa = parseSortableCode(a?.code);
  const pb = parseSortableCode(b?.code);
  if (pa.num !== pb.num) return pa.num - pb.num;
  if (pa.suffix !== pb.suffix) return pa.suffix.localeCompare(pb.suffix);
  return 0;
}

function parseSortableCode(code) {
  const raw = typeof code === 'string' ? code.trim() : '';
  const match = /^(\d+)([a-z]*)$/i.exec(raw);
  if (!match) return { num: Number.MAX_SAFE_INTEGER, suffix: raw.toLowerCase() };
  return { num: Number(match[1]), suffix: (match[2] || '').toLowerCase() };
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
