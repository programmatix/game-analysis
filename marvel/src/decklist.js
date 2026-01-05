const { normalizeName } = require('../../shared/deck-utils');

function normalizeMarvelDeckName(name) {
  const raw = typeof name === 'string' ? name : '';
  if (!raw.trim()) return '';

  return splitMarvelCdbSuffix(raw).name;
}

function normalizeMarvelDeckEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map(entry => {
    if (!entry || entry.proxyPageBreak) return entry;
    const split = splitMarvelCdbSuffix(entry.name);
    return {
      ...entry,
      name: split.name,
      marvelcdb: split.hint || undefined,
    };
  });
}

function formatResolvedDeckEntries(entries) {
  if (!Array.isArray(entries)) return '';
  return entries
    .map(entry => {
      if (!entry) return '';
      if (entry.proxyPageBreak) return '[proxypagebreak]';

      const count = Number(entry.count) || 0;
      const base = `${count} ${entry.name || ''}`.trim();
      if (entry.code) return `${base}[${entry.code}]`;
      return base;
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeCardKey(text) {
  return normalizeName(normalizeMarvelDeckName(text));
}

function splitMarvelCdbSuffix(rawName) {
  const raw = typeof rawName === 'string' ? rawName : '';
  if (!raw.trim()) return { name: '', hint: null };

  // MarvelCDB "download text" exports often append pack/position in parentheses, e.g.:
  // "Maria Hill (core, 12)" or "Backflip (Core Set, 3)".
  // Strip trailing parentheticals that contain any digit; keep subnames like "(Peter Parker)".
  const match = /\s*\(([^)]*\d[^)]*)\)\s*$/.exec(raw);
  if (!match) {
    return { name: raw.trim(), hint: null };
  }

  const suffix = match[1].trim();
  const name = raw.slice(0, match.index).trim();
  const hint = parseMarvelCdbPackPositionHint(suffix);
  return { name: name || raw.trim(), hint };
}

function parseMarvelCdbPackPositionHint(suffix) {
  const raw = typeof suffix === 'string' ? suffix.trim() : '';
  if (!raw) return null;

  let packPart = '';
  let positionPart = '';

  const commaSplit = raw.split(',');
  if (commaSplit.length >= 2) {
    packPart = commaSplit[0].trim();
    positionPart = commaSplit.slice(1).join(',').trim();
  } else {
    const tokens = raw.split(/\s+/).filter(Boolean);
    const last = tokens[tokens.length - 1] || '';
    if (/^\d+$/.test(last)) {
      positionPart = last;
      packPart = tokens.slice(0, -1).join(' ').trim();
    } else {
      packPart = raw;
    }
  }

  const position = /^\d+$/.test(positionPart) ? Number(positionPart) : null;
  const normalizedPack = packPart.toLowerCase().trim();
  const isPackCode = normalizedPack && /^[a-z0-9]+$/.test(normalizedPack);

  return {
    packCode: isPackCode ? normalizedPack : null,
    packName: isPackCode ? null : (packPart || null),
    position,
    raw: raw,
  };
}

module.exports = {
  normalizeMarvelDeckName,
  normalizeMarvelDeckEntries,
  formatResolvedDeckEntries,
  normalizeCardKey,
  splitMarvelCdbSuffix,
};
