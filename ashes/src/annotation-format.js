const ANNOTATION_PREFIX = '//? ';

function buildCardComment(card) {
  const parts = [];
  const type = typeof card?.type === 'string' ? card.type.trim() : '';
  const release = typeof card?.release?.name === 'string' ? card.release.name.trim() : '';
  const placement = typeof card?.placement === 'string' ? card.placement.trim() : '';
  const costParts = Array.isArray(card?.cost) ? card.cost.map(x => String(x || '').trim()).filter(Boolean) : [];
  const diceParts = Array.isArray(card?.dice) ? card.dice.map(x => String(x || '').trim()).filter(Boolean) : [];
  const chained = Boolean(card?.chained);

  if (type) parts.push(type);
  if (release) parts.push(`Release: ${release}`);
  if (placement) parts.push(`Placement: ${placement}`);
  if (costParts.length) parts.push(`Cost: ${costParts.join(', ')}`);
  if (diceParts.length) parts.push(`Dice: ${diceParts.join(', ')}`);
  if (chained) parts.push('Chained');

  return parts.join(' | ');
}

module.exports = {
  ANNOTATION_PREFIX,
  buildCardComment,
};

