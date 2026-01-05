function normalizeForSearch(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  normalizeForSearch,
};
