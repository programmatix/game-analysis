function buildStickerSheetYamlConfig({
  pageSize,
  orientation,
  sheetMarginMm,
  gutterMm,
  stickerWidthMm,
  topStickerHeightMm,
  frontStickerHeightMm,
  stickerHeightMm,
  cornerRadiusMm,
  columns,
  count,
  sampleNumber,
  sample1Logo,
  sample1Art,
  sample1Gradient,
  sample1Yellow,
  sample1GradientWidthMm,
  sample1LogoOffsetXMm,
  sample1LogoOffsetYMm,
  sample1LogoMaxWidthMm,
  sample1LogoMaxHeightMm,
  sample1ArtOffsetXMm,
  sample1ArtOffsetYMm,
  sample1ArtScale,
  debug,
} = {}) {
  const sample = Number(sampleNumber) || 1;
  if (sample !== 1) {
    throw new Error(`Only --yaml-sample 1 is supported right now (got ${sample}).`);
  }

  const stickerCount = clampInt(count ?? 10, { min: 1, max: 200 });

  const defaults = {
    logo: normalizePathString(sample1Logo),
    logoOffsetXMm: Number(sample1LogoOffsetXMm) || 0,
    logoOffsetYMm: Number(sample1LogoOffsetYMm) || 0,
    logoMaxWidthMm: Number(sample1LogoMaxWidthMm) || 28,
    logoMaxHeightMm: Number(sample1LogoMaxHeightMm) || 18,
    logoScale: 1,
    gradient: String((sample1Gradient ?? sample1Yellow) || '#f7d117').trim(),
    gradientWidthMm: Number(sample1GradientWidthMm) || 34,
    artScale: Number(sample1ArtScale) || 1,
  };

  const stickers = [];
  const sampleName = 'Sample';
  stickers.push({
    name: sampleName,
    kind: 'top',
    art: normalizePathString(sample1Art),
    artOffsetXMm: Number(sample1ArtOffsetXMm) || 0,
    artOffsetYMm: Number(sample1ArtOffsetYMm) || 0,
  });
  stickers.push({
    name: sampleName,
    kind: 'front',
    art: normalizePathString(sample1Art),
    artOffsetXMm: Number(sample1ArtOffsetXMm) || 0,
    artOffsetYMm: Number(sample1ArtOffsetYMm) || 0,
  });
  while (stickers.length < stickerCount) stickers.push({});

  const yamlConfig = {
    version: 2,
    sheet: {
      pageSize: String(pageSize || 'a4').trim().toLowerCase(),
      orientation: String(orientation || 'auto').trim().toLowerCase(),
      marginMm: Number(sheetMarginMm) || 8,
      gutterMm: Number(gutterMm) || 4,
      stickerWidthMm: Number(stickerWidthMm) || 70,
      topStickerHeightMm: Number(topStickerHeightMm ?? stickerHeightMm) || 25,
      frontStickerHeightMm: Number(frontStickerHeightMm) || 40,
      cornerRadiusMm: Number(cornerRadiusMm) || 2,
      cutMarginMm: 1,
      columns: clampInt(columns ?? 2, { min: 1, max: 10 }),
    },
    debug: normalizeDebug(debug),
    defaults,
    stickers,
  };

  return yamlConfig;
}

function normalizeDebug(debug) {
  const src = debug && typeof debug === 'object' ? debug : {};
  return {
    leftMm: Number(src.leftMm) || 10,
    rightFromRightMm: Number(src.rightFromRightMm) || 40,
    centerHorizontal: src.centerHorizontal !== false,
  };
}

function normalizePathString(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw;
}

function clampInt(value, { min = 1, max = 999 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  buildStickerSheetYamlConfig,
};
