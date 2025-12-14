const { normalizeName } = require('../../shared/deck-utils');
const { assertNoAmbiguousCards } = require('./card-data');

function expandDeck(entries, lookup) {
  assertNoAmbiguousCards(entries, lookup);
  const cards = [];
  for (const entry of entries) {
    const card = resolveDeckCard(entry, lookup);
    const annotations = normalizeAnnotations(entry.annotations);
    if (annotations.permanent) {
      continue;
    }
    const weakness = annotations.weakness || isCardWeakness(card);
    const traits = extractTraits(card?.traits);
    for (let i = 0; i < entry.count; i += 1) {
      cards.push({
        name: entry.name,
        code: entry.code,
        weapon: annotations.weapon,
        weakness,
        resources: annotations.resources,
        draw: annotations.draw,
        resourcesPerTurn: annotations.resourcesPerTurn,
        drawPerTurn: annotations.drawPerTurn,
        cost: normalizeCost(card?.cost),
        traits,
      });
    }
  }
  return cards;
}

function resolveDeckCard(entry, lookup) {
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

function normalizeCost(cost) {
  return Number.isFinite(cost) ? cost : 0;
}

function extractTraits(traitsString) {
  if (!traitsString || typeof traitsString !== 'string') {
    return [];
  }
  return traitsString
    .split('.')
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

function isCardWeakness(card) {
  const subtype = normalizeName(card?.subtype_code);
  return subtype === 'weakness' || subtype === 'basicweakness';
}

function normalizeAnnotations(annotations) {
  const keywords = Array.isArray(annotations?.keywords) ? annotations.keywords.map(k => String(k).toLowerCase()) : [];
  const keywordSet = new Set(keywords);
  const weapon = Boolean(annotations?.weapon) || keywordSet.has('weapon');
  const permanent = Boolean(annotations?.permanent) || keywordSet.has('permanent');
  const weakness = Boolean(annotations?.weakness)
    || keywordSet.has('weakness')
    || keywordSet.has('basicweakness');
  const resources = Number(annotations?.resources) || 0;
  const draw = Number(annotations?.draw) || 0;
  const resourcesPerTurn = Number(annotations?.resourcesPerTurn) || 0;
  const drawPerTurn = Number(annotations?.drawPerTurn) || 0;

  return { weapon, permanent, weakness, resources, draw, resourcesPerTurn, drawPerTurn };
}

function drawOpeningHandWithWeaknessRedraw(deck, openingHand) {
  const kept = [];
  const setAsideWeaknesses = [];
  let cursor = 0;

  while (kept.length < openingHand && cursor < deck.length) {
    const card = deck[cursor];
    cursor += 1;
    if (card.weakness) {
      setAsideWeaknesses.push(card);
    } else {
      kept.push(card);
    }
  }

  if (kept.length < openingHand) {
    throw new Error('Opening hand size cannot exceed the number of non-weakness cards in the deck.');
  }

  const remaining = deck.slice(cursor);
  const reshuffledDrawPile = shuffle([...remaining, ...setAsideWeaknesses]);
  return {
    openingHandCards: kept,
    drawPile: reshuffledDrawPile,
  };
}

function shuffle(deck) {
  const copy = deck.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

module.exports = {
  expandDeck,
  resolveDeckCard,
  dedupeByCode,
  normalizeCost,
  normalizeAnnotations,
  drawOpeningHandWithWeaknessRedraw,
  shuffle,
  extractTraits,
};
