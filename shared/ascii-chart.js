function renderAsciiBarChart(items, options = {}) {
  const {
    width = 20,
    barChar = '#',
    labelPadding = 1,
    showCounts = true,
  } = options;

  const rows = Array.isArray(items)
    ? items
        .map(item => ({
          label: String(item?.label ?? '').trim(),
          count: Number(item?.count) || 0,
        }))
        .filter(row => row.label)
    : [];

  const maxCount = rows.reduce((max, row) => Math.max(max, row.count), 0);
  const maxLabelLen = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  const safeWidth = Number.isFinite(width) && width > 0 ? Math.floor(width) : 20;

  const barFor = count => {
    if (count <= 0 || maxCount <= 0) return '';
    const scaled = Math.round((count / maxCount) * safeWidth);
    const clamped = Math.max(1, Math.min(safeWidth, scaled));
    return barChar.repeat(clamped);
  };

  return rows
    .map(row => {
      const label = row.label.padEnd(maxLabelLen + labelPadding);
      const bar = barFor(row.count);
      const suffix = showCounts ? ` (${row.count})` : '';
      return `${label}| ${bar}${suffix}`.trimEnd();
    })
    .join('\n');
}

module.exports = {
  renderAsciiBarChart,
};

