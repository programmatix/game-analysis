const fs = require('fs');
const path = require('path');
const { normalizeName, parseNameWithCode, stripLineComment } = require('../../shared/deck-utils');

function normalizeLotrDeckName(name) {
  const raw = typeof name === 'string' ? name : '';
  if (!raw.trim()) return '';
  return splitLotrDeckSuffix(raw).name;
}

function normalizeCardKey(text) {
  return normalizeName(normalizeLotrDeckName(text));
}

function parseLotrDeckList(text, options = {}) {
  const { baseDir = process.cwd(), sourcePath = null, initialSection = 'deck', _includeStack = [] } = options;

  const sanitizedText = stripBlockComments(text || '');
  const lines = sanitizedText.split(/\r?\n/);
  const entries = [];
  let section = initialSection || 'deck';

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const sourceLine = lineIndex + 1;
    const withoutLineComment = stripLineComment(line);
    const trimmed = withoutLineComment.trim();
    if (!trimmed) continue;

    if (/^\[proxypagebreak\]$/i.test(trimmed)) {
      entries.push({ proxyPageBreak: true });
      continue;
    }

    const includeMatch = /^\[include:([^\]]+)\]$/i.exec(trimmed);
    if (includeMatch) {
      const includeTarget = includeMatch[1].trim();
      if (!includeTarget) continue;

      const includePath = resolveIncludePath(includeTarget, baseDir);
      const normalizedIncludePath = path.normalize(includePath);
      if (_includeStack.includes(normalizedIncludePath)) continue;

      let includeText;
      try {
        includeText = fs.readFileSync(includePath, 'utf8');
      } catch (_) {
        continue;
      }

      const nestedEntries = parseLotrDeckList(includeText, {
        baseDir: path.dirname(includePath),
        sourcePath: includePath,
        initialSection: section,
        _includeStack: [..._includeStack, normalizedIncludePath],
      });
      entries.push(...nestedEntries);
      continue;
    }

    const detected = detectSectionHeader(trimmed);
    if (detected) {
      section = detected;
      continue;
    }

    const entry = parseLotrDeckLine(trimmed, { section });
    if (!entry) continue;

    const split = splitLotrDeckSuffix(entry.name);
    entries.push({
      ...entry,
      name: split.name,
      ringsdb: split.hint || undefined,
      section,
      source: { file: sourcePath, line: sourceLine, text: line },
    });
  }

  return entries;
}

function parseLotrDeckLine(text, options = {}) {
  const section = options.section || 'deck';
  const match = /^(\d+)\s*(?:x|×)\s*(.+)$/.exec(text) || /^(\d+)\s+(.+)$/.exec(text);

  if (match) {
    const [, countStr, rawName] = match;
    const count = Number(countStr);
    if (!Number.isFinite(count) || count <= 0) return null;

    const { name, code, annotations } = parseNameWithCode(rawName);
    if (!name) return null;

    const entry = { count, name, code };
    if (annotations && Object.keys(annotations).length > 0) entry.annotations = annotations;
    return entry;
  }

  if (section === 'heroes') {
    const { name, code, annotations } = parseNameWithCode(text);
    if (!name) return null;
    const entry = { count: 1, name, code };
    if (annotations && Object.keys(annotations).length > 0) entry.annotations = annotations;
    return entry;
  }

  return null;
}

function formatResolvedDeckEntries(entries, options = {}) {
  const includeCodes = options.includeCodes !== false;
  const lines = [];
  let currentSection = null;
  let needsBlankLine = false;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry) continue;

    if (entry.proxyPageBreak) {
      lines.push('[proxypagebreak]');
      needsBlankLine = false;
      continue;
    }

    const section = entry.section || 'deck';
    if (section && section !== currentSection) {
      if (needsBlankLine) lines.push('');
      lines.push(`${titleCase(section)}:`);
      currentSection = section;
      needsBlankLine = false;
    }

    const count = Number(entry.count) || 0;
    const base = `${count} ${entry.name || ''}`.trim();
    const code = includeCodes && entry.code ? String(entry.code).trim() : '';
    lines.push(code ? `${base} [${code}]` : base);
    needsBlankLine = true;
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function splitLotrDeckSuffix(rawName) {
  const raw = typeof rawName === 'string' ? rawName : '';
  if (!raw.trim()) return { name: '', hint: null };

  // RingsDB "download text" exports often append pack/position in parentheses, e.g.:
  // "Gandalf (Core Set, 73)". Strip trailing parentheticals containing any digit.
  const match = /\s*\(([^)]*\d[^)]*)\)\s*$/.exec(raw);
  if (!match) {
    return { name: raw.trim(), hint: null };
  }

  const suffix = match[1].trim();
  const name = raw.slice(0, match.index).trim();
  const hint = parsePackPositionHint(suffix);
  return { name: name || raw.trim(), hint };
}

function parsePackPositionHint(suffix) {
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
    raw,
  };
}

function detectSectionHeader(trimmedLine) {
  const normalized = trimmedLine.replace(/\s+/g, ' ').trim().toLowerCase();
  const withoutColon = normalized.endsWith(':') ? normalized.slice(0, -1).trim() : normalized;
  const withoutCountSuffix = withoutColon.replace(/\(\s*\d+\s*\)\s*$/g, '').trim();

  if (withoutCountSuffix === 'heroes' || withoutCountSuffix === 'hero') return 'heroes';
  if (withoutCountSuffix === 'allies' || withoutCountSuffix === 'ally') return 'allies';
  if (withoutCountSuffix === 'attachments' || withoutCountSuffix === 'attachment') return 'attachments';
  if (withoutCountSuffix === 'events' || withoutCountSuffix === 'event') return 'events';
  if (withoutCountSuffix === 'side quests' || withoutCountSuffix === 'side quest' || withoutCountSuffix === 'sidequests') return 'side_quests';
  if (withoutCountSuffix === 'contracts' || withoutCountSuffix === 'contract') return 'contracts';
  if (withoutCountSuffix === 'deck' || withoutCountSuffix === 'main deck' || withoutCountSuffix === 'player deck') return 'deck';
  if (withoutCountSuffix === 'sideboard') return 'sideboard';
  return null;
}

function resolveIncludePath(target, baseDir) {
  const hasExtension = Boolean(path.extname(target));
  const fileName = hasExtension ? target : `${target}.txt`;
  return path.resolve(baseDir || process.cwd(), fileName);
}

function stripBlockComments(text) {
  return String(text || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function titleCase(value) {
  const raw = String(value || '').trim().replace(/_/g, ' ');
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
}

module.exports = {
  normalizeLotrDeckName,
  normalizeCardKey,
  parseLotrDeckList,
  parseLotrDeckLine,
  splitLotrDeckSuffix,
  formatResolvedDeckEntries,
};

