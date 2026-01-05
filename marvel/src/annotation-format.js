const ANNOTATION_PREFIX = '//? ';

function buildCardComment(card, options = {}) {
  const parts = [];

  const core = formatCoreSetIndicator(card, options);
  if (core) {
    parts.push(core);
  }

  const type = formatType(card);
  const faction = formatFaction(card);
  if (type && faction) {
    parts.push(`${type} — ${faction}.`);
  } else if (type) {
    parts.push(`${type}.`);
  } else if (faction) {
    parts.push(`${faction}.`);
  }

  const cost = formatCost(card);
  if (cost !== null) {
    parts.push(`Cost ${cost}.`);
  }

  const stats = formatStats(card);
  if (stats) {
    parts.push(`${stats}.`);
  }

  const traits = formatTraits(card);
  if (traits) {
    parts.push(`${traits}.`);
  }

  const text = formatRulesText(card);
  if (text) {
    parts.push(text);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function formatCoreSetIndicator(card, options) {
  const membership = options?.coreSetMembership;
  if (!(membership instanceof Set)) return '';

  const inCore = cardExistsInCoreSet(card, membership, options?.cardIndex);
  return inCore ? '[Core]' : '[Not Core]';
}

function cardExistsInCoreSet(card, membership, cardIndex) {
  const canonicalCode = getCanonicalCode(card, cardIndex);
  if (!canonicalCode) return false;
  return membership.has(canonicalCode);
}

function getCanonicalCode(card, cardIndex) {
  const code = card?.code ? String(card.code).trim() : '';
  if (!code) return '';

  if (!(cardIndex instanceof Map)) return code;

  let current = card;
  const visited = new Set();
  for (let hops = 0; hops < 10; hops += 1) {
    const currentCode = current?.code ? String(current.code).trim() : '';
    if (!currentCode || visited.has(currentCode)) break;
    visited.add(currentCode);

    const dup = current?.duplicate_of_code ? String(current.duplicate_of_code).trim() : '';
    if (!dup) return currentCode;
    const next = cardIndex.get(dup);
    if (!next) return currentCode;
    current = next;
  }

  return code;
}

function formatType(card) {
  const type = card?.type_name || card?.type_code;
  if (!type) return '';
  return String(type).charAt(0).toUpperCase() + String(type).slice(1);
}

function formatFaction(card) {
  const name = card?.faction_name || card?.faction_code;
  if (!name) return '';
  return String(name).trim();
}

function formatCost(card) {
  if (Number.isFinite(card?.cost)) return card.cost;
  if (card?.cost === 0) return 0;
  if (typeof card?.cost === 'string' && card.cost.trim()) return card.cost.trim();
  return null;
}

function formatStats(card) {
  const stats = [];

  const add = (label, value, starFlag) => {
    const rendered = renderStatValue(value, starFlag);
    if (rendered === null) return;
    stats.push(`${label} ${rendered}`);
  };

  add('THW', card?.thwart, card?.thwart_star);
  add('ATK', card?.attack, card?.attack_star);
  add('DEF', card?.defense, card?.defense_star);
  add('REC', card?.recover, card?.recover_star);
  add('HP', card?.health, card?.health_star);

  if (Number.isFinite(card?.hand_size)) {
    stats.push(`HAND ${card.hand_size}`);
  }

  return stats.length ? stats.join(', ') : '';
}

function renderStatValue(value, starFlag) {
  if (starFlag) return '*';
  if (Number.isFinite(value)) return value;
  if (value === 0) return 0;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function formatTraits(card) {
  if (!card?.traits) return '';
  const normalized = String(card.traits).replace(/\s+/g, ' ').trim().replace(/[.;,]+$/g, '');
  if (!normalized) return '';
  const parts = normalized
    .split(/[.;]/)
    .map(part => part.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  return parts.join(', ');
}

function formatRulesText(card) {
  const raw = typeof card?.text === 'string' ? card.text : '';
  if (!raw.trim()) return '';
  const withoutTags = raw.replace(/<\/?[^>]+>/g, '');
  return withoutTags.replace(/\s+/g, ' ').trim();
}

function isAnnotationLine(line) {
  return /^\s*\/\/\?\s/.test(line);
}

module.exports = {
  ANNOTATION_PREFIX,
  buildCardComment,
  isAnnotationLine,
};
