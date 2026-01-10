const fs = require('fs');
const path = require('path');
const { parseNameWithCode, stripLineComment } = require('../../shared/deck-utils');

function parseSwuDeckList(text, options = {}) {
  const { baseDir = process.cwd(), sourcePath = null, initialSection = 'other', _includeStack = [] } = options;
  const sanitizedText = stripBlockComments(text || '');
  const lines = sanitizedText.split(/\r?\n/);
  const entries = [];
  let section = initialSection || 'other';

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

      const nestedEntries = parseSwuDeckList(includeText, {
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

    const entry = parseSwuDeckLine(trimmed, { section });
    if (!entry) {
      continue;
    }

    const split = splitSwuDeckSuffix(entry.name);
    entries.push({
      ...entry,
      name: split.name,
      swu: split.hint || undefined,
      section,
      source: { file: sourcePath, line: sourceLine, text: line },
    });
  }

  return entries;
}

function parseSwuDeckLine(text, options = {}) {
  const section = options.section || 'other';
  const match = /^(\d+)\s*(?:x|×)\s+(.+)$/.exec(text) || /^(\d+)\s+(.+)$/.exec(text);

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

  if (section === 'leader' || section === 'base') {
    const { name, code, annotations } = parseNameWithCode(text);
    if (!name) return null;
    const entry = { count: 1, name, code };
    if (annotations && Object.keys(annotations).length > 0) entry.annotations = annotations;
    return entry;
  }

  return null;
}

function detectSectionHeader(trimmedLine) {
  const normalized = trimmedLine.replace(/\s+/g, ' ').trim().toLowerCase();
  const withoutColon = normalized.endsWith(':') ? normalized.slice(0, -1).trim() : normalized;

  if (withoutColon === 'leader' || withoutColon === 'leaders') return 'leader';
  if (withoutColon === 'base' || withoutColon === 'bases') return 'base';
  if (withoutColon === 'deck' || withoutColon === 'main deck') return 'deck';
  if (withoutColon === 'sideboard') return 'sideboard';
  return null;
}

function splitSwuDeckSuffix(rawName) {
  const raw = typeof rawName === 'string' ? rawName : '';
  if (!raw.trim()) return { name: '', hint: null };

  const match = /\s*\(([^)]*(?:[A-Z]{2,4})[^)]*\d[^)]*)\)\s*$/.exec(raw);
  if (!match) return { name: raw.trim(), hint: null };

  const suffix = match[1].trim();
  const hint = parseSetNumberHint(suffix);
  if (!hint) {
    return { name: raw.trim(), hint: null };
  }

  const name = raw.slice(0, match.index).trim();
  return { name: name || raw.trim(), hint };
}

function parseSetNumberHint(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;

  const match = /([A-Z]{2,4})\s*[-#]?\s*(\d{1,3})/i.exec(raw);
  if (!match) return null;

  return { set: match[1].toUpperCase(), number: Number(match[2]) };
}

function stripBlockComments(text) {
  return String(text || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function resolveIncludePath(target, baseDir) {
  const hasExtension = Boolean(path.extname(target));
  const fileName = hasExtension ? target : `${target}.txt`;
  return path.resolve(baseDir || process.cwd(), fileName);
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

    const section = entry.section || 'other';
    if (section !== 'other' && section !== currentSection) {
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

function titleCase(value) {
  const raw = String(value || '').trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
}

module.exports = {
  parseSwuDeckList,
  parseSwuDeckLine,
  splitSwuDeckSuffix,
  formatResolvedDeckEntries,
};
