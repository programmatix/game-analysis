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
  const lines = text.split(/\r?\n/);
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
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

    const { name, code } = parseNameWithCode(rawName);
    if (!name) {
      console.warn(`Skipping line "${line}" - card name is missing`);
      continue;
    }

    entries.push({ count, name, code });
  }

  return entries;
}

function parseNameWithCode(text) {
  const match = /^(.*?)(?:\s*\[([^\]]+)\])?$/.exec(text.trim());
  const name = match && match[1] ? match[1].trim() : '';
  const code = match && match[2] ? match[2].trim() : undefined;
  return { name, code };
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

module.exports = {
  readDeckText,
  parseDeckList,
  normalizeName,
  sanitizeFileName,
  resolveNameAndOutput,
};
