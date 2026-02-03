function ensureFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number(fallback) || 0;
}

function computeLogoBoxRectMm(safeRectMm, cfg, { areaFraction = 0.45, paddingMm = 6 } = {}) {
  const safe = safeRectMm || { x: 0, y: 0, width: 0, height: 0 };

  const logoMaxWidthMm = ensureFiniteNumber(cfg?.logoMaxWidthMm, 28);
  const logoMaxHeightMm = ensureFiniteNumber(cfg?.logoMaxHeightMm, 18);

  const logoAreaWidthMm = Math.min(
    ensureFiniteNumber(safe.width, 0) * ensureFiniteNumber(areaFraction, 0.45),
    logoMaxWidthMm + ensureFiniteNumber(paddingMm, 6),
  );

  const logoArea = {
    x: ensureFiniteNumber(safe.x, 0),
    y: ensureFiniteNumber(safe.y, 0),
    width: Math.max(0, logoAreaWidthMm),
    height: Math.max(0, ensureFiniteNumber(safe.height, 0)),
  };

  const box = {
    x: logoArea.x + ensureFiniteNumber(cfg?.logoOffsetXMm, 0),
    // UI stores +Y as "down"; PDFs use +Y as "up".
    y: logoArea.y - ensureFiniteNumber(cfg?.logoOffsetYMm, 0),
    width: Math.max(0, Math.min(logoMaxWidthMm, logoArea.width)),
    height: Math.max(0, Math.min(logoMaxHeightMm, logoArea.height)),
  };

  return { logoArea, box };
}

module.exports = {
  computeLogoBoxRectMm,
};
