const fs = require('fs');
const path = require('path');

async function readDeckText(filePath) {
  if (filePath) {
    return fs.promises.readFile(path.resolve(filePath), 'utf8');
  }

  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);

    if (process.stdin.isTTY) {
      resolve('');
    }
  });
}

function parseDeckList(text, options = {}) {
  const { baseDir = process.cwd(), _includeStack = [] } = options;
  const sanitizedText = stripComments(text);
  const lines = sanitizedText.split(/\r?\n/);
  const entries = [];

  for (const line of lines) {
    const withoutLineComment = stripLineComment(line);
    const trimmed = withoutLineComment.trim();
    if (!trimmed) {
      continue;
    }

    const includeMatch = /^\[include:([^\]]+)\]$/i.exec(trimmed);
    if (includeMatch) {
      const includeTarget = includeMatch[1].trim();
      if (!includeTarget) {
        console.warn(`Skipping line "${line}" - include target is missing`);
        continue;
      }

      const includePath = resolveIncludePath(includeTarget, baseDir);
      const normalizedIncludePath = path.normalize(includePath);

      if (_includeStack.includes(normalizedIncludePath)) {
        console.warn(`Skipping include "${includeTarget}" - detected a circular reference`);
        continue;
      }

      let includeText;
      try {
        includeText = fs.readFileSync(includePath, 'utf8');
      } catch (err) {
        console.warn(`Skipping include "${includeTarget}" - ${err instanceof Error ? err.message : 'unable to read file'}`);
        continue;
      }

      const nestedEntries = parseDeckList(includeText, {
        baseDir: path.dirname(includePath),
        _includeStack: [..._includeStack, normalizedIncludePath],
      });
      entries.push(...nestedEntries);
      continue;
    }

    const match = /^(\d+)\s+(.+)$/.exec(trimmed);
    if (!match) {
      console.warn(`Skipping line "${line}" - expected format "<count> <card name>"`);
      continue;
    }

    const [, countStr, rawName] = match;
    const count = Number(countStr);
    if (!Number.isFinite(count) || count <= 0) {
      console.warn(`Skipping line "${line}" - count must be positive`);
      continue;
    }

    const { name, code, annotations } = parseNameWithCode(rawName);
    if (!name) {
      console.warn(`Skipping line "${line}" - card name is missing`);
      continue;
    }

    const entry = { count, name, code };
    if (annotations && Object.keys(annotations).length > 0) {
      entry.annotations = annotations;
    }
    entries.push(entry);
  }

  return entries;
}

function parseNameWithCode(text) {
  const bracketRegex = /\[([^\]]+)\]/g;
  const bracketTokens = [];
  let match;
  while ((match = bracketRegex.exec(text)) !== null) {
    bracketTokens.push({
      index: match.index,
      raw: match[0],
      value: match[1].trim(),
    });
  }

  const name = stripBracketTokens(text, bracketTokens);
  let code;
  let resourceTotal = 0;
  let drawTotal = 0;
  let resourcesPerTurnTotal = 0;
  let drawPerTurnTotal = 0;
  const keywordSet = new Set();

  for (const token of bracketTokens) {
    const lowered = token.value.toLowerCase();

    if (!code && isPossibleCardCode(lowered)) {
      code = token.value;
      continue;
    }

    const modifier = parseModifier(token.value);
    if (modifier) {
      if (modifier.type === 'resources') {
        resourceTotal += modifier.value;
      } else if (modifier.type === 'draw') {
        drawTotal += modifier.value;
      } else if (modifier.type === 'resourcesperturn') {
        resourcesPerTurnTotal += modifier.value;
      } else if (modifier.type === 'drawperturn') {
        drawPerTurnTotal += modifier.value;
      }
      continue;
    }

    if (lowered) {
      keywordSet.add(lowered);
    }
  }

  const annotations = {};
  if (resourceTotal !== 0) {
    annotations.resources = resourceTotal;
  }
  if (drawTotal !== 0) {
    annotations.draw = drawTotal;
  }
  if (resourcesPerTurnTotal !== 0) {
    annotations.resourcesPerTurn = resourcesPerTurnTotal;
  }
  if (drawPerTurnTotal !== 0) {
    annotations.drawPerTurn = drawPerTurnTotal;
  }
  if (keywordSet.size) {
    annotations.keywords = Array.from(keywordSet);
    if (keywordSet.has('weapon')) {
      annotations.weapon = true;
    }
    if (keywordSet.has('permanent')) {
      annotations.permanent = true;
      annotations.ignoreDeckLimit = true;
    }
    if (keywordSet.has('ignorefordecklimit')) {
      annotations.ignoreDeckLimit = true;
    }
  }
  if (keywordSet.has('skipproxy')) {
    annotations.skipProxy = true;
  }
  if (keywordSet.has('skipback')) {
    annotations.skipBack = true;
  }

  return { name, code, annotations };
}

function normalizeName(text) {
  return text ? text.toLowerCase().replace(/\s+/g, ' ').trim() : '';
}

function sanitizeFileName(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

function stripComments(text) {
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlockComments;
}

function stripLineComment(line) {
  const markers = ['//', '#'];
  let cutoff = line.length;

  for (const marker of markers) {
    let searchStart = 0;
    while (searchStart < cutoff) {
      const idx = line.indexOf(marker, searchStart);
      if (idx === -1 || idx >= cutoff) break;
      const before = idx === 0 ? '' : line[idx - 1];
      if (idx === 0 || /\s/.test(before)) {
        cutoff = Math.min(cutoff, idx);
        break;
      }
      searchStart = idx + marker.length;
    }
  }

  return line.slice(0, cutoff);
}

function resolveNameAndOutput(nameOption) {
  const rawInput = nameOption && nameOption.trim() ? nameOption.trim() : 'deck';
  const hasPdfExtension = /\.pdf$/i.test(rawInput);
  const outputPath = path.resolve(hasPdfExtension ? rawInput : `${rawInput}.pdf`);
  const labelBase = path.basename(rawInput).replace(/\.pdf$/i, '');
  return {
    deckName: labelBase || 'deck',
    outputPath,
  };
}

function resolveIncludePath(target, baseDir) {
  const hasExtension = Boolean(path.extname(target));
  const fileName = hasExtension ? target : `${target}.txt`;
  return path.resolve(baseDir || process.cwd(), fileName);
}

function countDeckEntries(entries) {
  return entries.reduce((total, entry) => {
    const annotations = entry?.annotations;
    const keywords = Array.isArray(annotations?.keywords) ? annotations.keywords : [];
    const isPermanent = Boolean(annotations?.permanent)
      || keywords.some(keyword => String(keyword).toLowerCase() === 'permanent');
    const ignoreDeckLimit = Boolean(annotations?.ignoreDeckLimit)
      || keywords.some(keyword => String(keyword).toLowerCase() === 'ignorefordecklimit');

    if (isPermanent || ignoreDeckLimit) {
      return total;
    }

    return total + (Number(entry.count) || 0);
  }, 0);
}

function stripBracketTokens(text, tokens) {
  if (!tokens.length) {
    return text.trim();
  }

  let cursor = 0;
  const parts = [];
  for (const token of tokens) {
    parts.push(text.slice(cursor, token.index));
    cursor = token.index + token.raw.length;
  }
  parts.push(text.slice(cursor));
  return parts.join('').trim();
}

function isPossibleCardCode(value) {
  return /^[0-9]+[a-z]?$/i.test(value);
}

function parseModifier(value) {
  const match = /^([a-z]+)\s*:\s*(-?\d+(?:\.\d+)?)$/i.exec(value.trim());
  if (!match) return null;

  const [, key, numberText] = match;
  const normalizedKey = key.toLowerCase();
  if (normalizedKey !== 'resources' && normalizedKey !== 'draw' && normalizedKey !== 'resourcesperturn' && normalizedKey !== 'drawperturn') {
    return null;
  }

  const parsedNumber = Number(numberText);
  if (!Number.isFinite(parsedNumber)) {
    return null;
  }

  return { type: normalizedKey, value: parsedNumber };
}

module.exports = {
  readDeckText,
  parseDeckList,
  parseNameWithCode,
  normalizeName,
  sanitizeFileName,
  resolveNameAndOutput,
  countDeckEntries,
  stripLineComment,
};
