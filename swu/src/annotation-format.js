const ANNOTATION_PREFIX = '//? ';

function buildCardComment(card) {
  const parts = [];

  const tags = formatSetTag(card);
  if (tags) parts.push(tags);

  const type = formatType(card);
  const aspects = formatAspects(card);
  const arena = formatArena(card);

  const typeParts = [];
  if (type) typeParts.push(type);
  if (aspects) typeParts.push(aspects);
  if (arena) typeParts.push(arena);
  if (typeParts.length) parts.push(`${typeParts.join(' — ')}.`);

  const cost = formatCost(card);
  if (cost !== null) parts.push(`Cost ${cost}.`);

  const stats = formatStats(card);
  if (stats) parts.push(`${stats}.`);

  const traits = formatTraits(card);
  if (traits) parts.push(`${traits}.`);

  const text = formatRulesText(card);
  if (text) parts.push(text);

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function formatSetTag(card) {
  const set = typeof card?.set === 'string' ? card.set.trim().toUpperCase() : '';
  const number = Number.isInteger(card?.number) ? String(card.number).padStart(3, '0') : '';
  if (!set || !number) return '';
  return `[${set}-${number}]`;
}

function formatType(card) {
  const type = typeof card?.type === 'string' ? card.type.trim() : '';
  if (!type) return '';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatAspects(card) {
  const aspects = Array.isArray(card?.aspects) ? card.aspects : [];
  const rendered = aspects
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .map(value => value.charAt(0).toUpperCase() + value.slice(1));
  if (!rendered.length) return '';
  return rendered.join('/');
}

function formatArena(card) {
  const arena = typeof card?.arena === 'string' ? card.arena.trim().toLowerCase() : '';
  if (!arena) return '';
  if (arena === 'ground') return 'Ground';
  if (arena === 'space') return 'Space';
  return arena.charAt(0).toUpperCase() + arena.slice(1);
}

function formatCost(card) {
  if (Number.isFinite(card?.cost)) return card.cost;
  if (card?.cost === 0) return 0;
  return null;
}

function formatStats(card) {
  const parts = [];
  if (Number.isFinite(card?.power)) parts.push(`POW ${card.power}`);
  if (Number.isFinite(card?.hp)) parts.push(`HP ${card.hp}`);
  return parts.length ? parts.join(', ') : '';
}

function formatTraits(card) {
  const traits = Array.isArray(card?.traits) ? card.traits : [];
  const rendered = traits.map(value => String(value || '').trim()).filter(Boolean);
  if (!rendered.length) return '';
  return rendered.join(', ');
}

function formatRulesText(card) {
  const pieces = [];
  const front = typeof card?.textFront === 'string' ? card.textFront.trim() : '';
  if (front) pieces.push(front);
  const back = typeof card?.textBack === 'string' ? card.textBack.trim() : '';
  if (back) pieces.push(`Back: ${back}`);
  return pieces
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/[.;]\s*Back:\s*/g, '. Back: ')
    .trim();
}

function isAnnotationLine(line) {
  return /^\s*\/\/\?\s/.test(line);
}

module.exports = {
  ANNOTATION_PREFIX,
  buildCardComment,
  isAnnotationLine,
};
