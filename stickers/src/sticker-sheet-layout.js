function clampInt(value, { min = 1, max = 999 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function computePackedStickerPagesMm(config, { pageWidthMm, pageHeightMm, stickerWidthMm, topStickerHeightMm, frontStickerHeightMm }) {
  const sheet = config.sheet;
  const columns = clampInt(sheet.columns ?? 2, { min: 1, max: 20 });
  const marginMm = Number(sheet.marginMm) || 0;
  const gutterMm = Number(sheet.gutterMm) || 0;

  const usableW = pageWidthMm - marginMm * 2;
  const usableH = pageHeightMm - marginMm * 2;

  const gridW = stickerWidthMm * columns + gutterMm * (columns - 1);
  const originX = marginMm + (usableW - gridW) / 2;
  const xByCol = Array.from({ length: columns }, (_, c) => originX + c * (stickerWidthMm + gutterMm));

  function heightForSticker(sticker) {
    const kind = String(sticker?.kind || 'top').trim().toLowerCase();
    return kind === 'front' ? frontStickerHeightMm : topStickerHeightMm;
  }

  function shouldRenderSticker(sticker) {
    if (!sticker || typeof sticker !== 'object') return false;
    if (sticker.logo || sticker.art) return true;
    if (Array.isArray(sticker.textOverlays) && sticker.textOverlays.some(o => o && typeof o === 'object' && String(o.text || '').trim())) return true;
    return false;
  }

  const stickers = Array.isArray(config.stickers) ? config.stickers : [];
  const pages = [];

  let current = [];
  let yCursorTop = Array(columns).fill(pageHeightMm - marginMm);

  function startNewPage() {
    if (current.length) pages.push({ stickers: current });
    current = [];
    yCursorTop = Array(columns).fill(pageHeightMm - marginMm);
  }

  for (const sticker of stickers) {
    if (!shouldRenderSticker(sticker)) continue;

    const h = heightForSticker(sticker);
    if (h > usableH + 1e-6) {
      throw new Error(`Sticker height ${h}mm is too tall for the page's usable height (${usableH}mm).`);
    }

    let bestCol = -1;
    let bestRemaining = Infinity;
    for (let col = 0; col < columns; col++) {
      const yTop = yCursorTop[col];
      const y = yTop - h;
      const remaining = y - marginMm;
      if (remaining < -1e-6) continue;
      if (remaining < bestRemaining) {
        bestRemaining = remaining;
        bestCol = col;
      }
    }

    if (bestCol === -1) {
      startNewPage();

      // Always fits after new page (we already checked h <= usableH).
      const yTop = yCursorTop[0];
      const y = yTop - h;
      current.push({
        rectMm: { x: xByCol[0], y, width: stickerWidthMm, height: h },
        sticker,
      });
      yCursorTop[0] = y - gutterMm;
      continue;
    }

    const yTop = yCursorTop[bestCol];
    const y = yTop - h;
    current.push({
      rectMm: { x: xByCol[bestCol], y, width: stickerWidthMm, height: h },
      sticker,
    });
    yCursorTop[bestCol] = y - gutterMm;
  }

  if (current.length) pages.push({ stickers: current });
  if (pages.length === 0) pages.push({ stickers: [] });

  return pages;
}

module.exports = {
  computePackedStickerPagesMm,
};

