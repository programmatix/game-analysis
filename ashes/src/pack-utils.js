const { normalizeForSearch } = require('../../shared/text-utils');

function findReleasesByQuery(releases, query) {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(' ').filter(Boolean);
  return (Array.isArray(releases) ? releases : []).filter(release => {
    const haystack = normalizeForSearch(`${release?.name || ''} ${release?.stub || ''}`);
    return terms.every(term => haystack.includes(term));
  });
}

function pickRelease(releases, query) {
  const raw = String(query || '').trim();
  if (!raw) return { release: null, matches: [] };

  const exact = (Array.isArray(releases) ? releases : []).find(r => String(r?.stub || '').trim().toLowerCase() === raw.toLowerCase());
  if (exact) return { release: exact, matches: [exact] };

  const matches = findReleasesByQuery(releases, raw);
  if (matches.length === 1) return { release: matches[0], matches };
  return { release: null, matches };
}

function formatReleaseList(releases) {
  return (Array.isArray(releases) ? releases : [])
    .map(r => `- ${r?.stub || '(no stub)'} — ${r?.name || '(no name)'}${r?.is_legacy ? ' [legacy]' : ''}`)
    .join('\n');
}

module.exports = {
  findReleasesByQuery,
  pickRelease,
  formatReleaseList,
};

