const ANNOTATION_PREFIX = '//? ';

function buildCardComment(card) {
  const parts = [];

  const tag = formatCodeTag(card);
  if (tag) parts.push(tag);

  const type = formatType(card);
  const sphere = formatSphere(card);
  if (type || sphere) {
    const clause = [type, sphere].filter(Boolean).join(' — ');
    if (clause) parts.push(`${clause}.`);
  }

  const cost = formatCost(card);
  if (cost !== null) parts.push(`Cost ${cost}.`);

  const threat = formatThreat(card);
  if (threat !== null) parts.push(`Threat ${threat}.`);

  const stats = formatStats(card);
  if (stats) parts.push(`${stats}.`);

  const traits = formatTraits(card);
  if (traits) parts.push(`${traits}.`);

  const text = formatRulesText(card);
  if (text) parts.push(text);

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function formatCodeTag(card) {
  const code = card?.code != null ? String(card.code).trim() : '';
  if (!code) return '';
  return `[${code}]`;
}

function formatType(card) {
  const raw = typeof card?.type === 'string' ? card.type.trim() : '';
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatSphere(card) {
  const raw = typeof card?.sphere === 'string' ? card.sphere.trim() : '';
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatCost(card) {
  if (Number.isFinite(card?.cost)) return card.cost;
  if (card?.cost === 0) return 0;
  return null;
}

function formatThreat(card) {
  if (Number.isFinite(card?.threat)) return card.threat;
  if (card?.threat === 0) return 0;
  return null;
}

function formatStats(card) {
  const parts = [];
  if (Number.isFinite(card?.willpower)) parts.push(`WP ${card.willpower}`);
  if (Number.isFinite(card?.attack)) parts.push(`ATK ${card.attack}`);
  if (Number.isFinite(card?.defense)) parts.push(`DEF ${card.defense}`);
  if (Number.isFinite(card?.health)) parts.push(`HP ${card.health}`);
  return parts.length ? parts.join(', ') : '';
}

function formatTraits(card) {
  const traits = Array.isArray(card?.traits) ? card.traits : [];
  const rendered = traits.map(value => String(value || '').trim()).filter(Boolean);
  if (!rendered.length) return '';
  return rendered.join(', ');
}

function formatRulesText(card) {
  const front = typeof card?.textFront === 'string' ? card.textFront.trim() : '';
  if (!front) return '';
  return front.replace(/\s+/g, ' ').trim();
}

function isAnnotationLine(line) {
  return /^\s*\/\/\?\s/.test(line);
}

module.exports = {
  ANNOTATION_PREFIX,
  buildCardComment,
  isAnnotationLine,
};

