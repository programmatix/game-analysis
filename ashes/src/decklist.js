const { normalizeForSearch } = require('../../shared/text-utils');

function normalizeCardKey(text) {
  return normalizeForSearch(text);
}

function normalizeAshesDeckEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries.map(entry => {
    if (!entry || entry.proxyPageBreak) return entry;

    const annotations = entry.annotations && typeof entry.annotations === 'object' ? entry.annotations : null;
    const keywords = Array.isArray(annotations?.keywords) ? annotations.keywords.slice() : [];

    let code = entry.code ? String(entry.code).trim() : '';
    let releaseStub = '';
    let typeHint = '';

    const remainingKeywords = [];
    for (const rawKeyword of keywords) {
      const keyword = String(rawKeyword || '').trim();
      const lower = keyword.toLowerCase();

      const stubMatch = /^(?:stub|ashes)\s*:\s*([a-z0-9-]+)$/i.exec(keyword);
      if (!code && stubMatch) {
        code = stubMatch[1];
        continue;
      }

      const releaseMatch = /^(?:release|r)\s*:\s*([a-z0-9-]+)$/i.exec(keyword);
      if (!releaseStub && releaseMatch) {
        releaseStub = releaseMatch[1];
        continue;
      }

      const typeMatch = /^type\s*:\s*(.+)$/i.exec(keyword);
      if (!typeHint && typeMatch) {
        typeHint = typeMatch[1].trim();
        continue;
      }

      // Preserve other deck keywords (skipproxy, etc.)
      remainingKeywords.push(lower || keyword);
    }

    const updatedAnnotations = annotations
      ? { ...annotations, keywords: remainingKeywords.length ? remainingKeywords : undefined }
      : undefined;

    const ashesHint = releaseStub || typeHint
      ? {
          releaseStub: releaseStub || undefined,
          type: typeHint || undefined,
        }
      : undefined;

    return {
      ...entry,
      code: code || undefined,
      annotations: updatedAnnotations,
      ashes: ashesHint,
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
      if (entry.code) return `${base} [stub:${entry.code}]`;
      return base;
    })
    .filter(Boolean)
    .join('\n');
}

module.exports = {
  normalizeCardKey,
  normalizeAshesDeckEntries,
  formatResolvedDeckEntries,
};
