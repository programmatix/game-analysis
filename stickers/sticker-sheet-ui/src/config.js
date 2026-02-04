import YAML from 'yaml';

export const SAMPLE_YAML = `version: 2
sheet:
  pageSize: a4
  orientation: auto
  marginMm: 8
  gutterMm: 4
  stickerWidthMm: 70
  topStickerHeightMm: 25
  frontStickerHeightMm: 40
  cornerRadiusMm: 2
  cutMarginMm: 1
  columns: 2
debug:
  leftMm: 10
  rightFromRightMm: 40
  centerHorizontal: true
defaults:
  logo: assets/logo.png
  logoMaxWidthMm: 28
  logoMaxHeightMm: 18
  logoScale: 1
  gradient: "#f7d117"
  gradientWidthMm: 34
  artScale: 1
stickers:
  - name: Sample
    kind: top
    art: assets/sample/image.png
    artOffsetXMm: 0
    artOffsetYMm: 0
    artScale: 1
    gradient: "#f7d117"
  - name: Sample
    kind: front
    art: assets/sample/image.png
    artOffsetXMm: 0
    artOffsetYMm: 0
    artScale: 1
`;

export function parseYamlOrThrow(yamlText) {
  return YAML.parse(String(yamlText || ''));
}

export function stringifyYaml(config) {
  return YAML.stringify(config, { indent: 2 });
}

export function migrateYellowToGradientInPlace(config) {
  if (!config || typeof config !== 'object') return;

  config.defaults = ensureObject(config.defaults);
  if (config.defaults.gradient == null && config.defaults.yellow != null) config.defaults.gradient = config.defaults.yellow;
  if (config.defaults.yellow != null) delete config.defaults.yellow;

  const stickers = Array.isArray(config.stickers) ? config.stickers : [];
  for (const sticker of stickers) {
    if (!sticker || typeof sticker !== 'object') continue;
    if (sticker.gradient == null && sticker.yellow != null) sticker.gradient = sticker.yellow;
    if (sticker.yellow != null) delete sticker.yellow;
  }
}

export function migrateV1ToV2InPlace(config) {
  if (!config || typeof config !== 'object') return;
  const version = Number(config.version ?? 1) || 1;
  if (version >= 2) return;

  config.version = 2;
  config.sheet = ensureObject(config.sheet);
  if (config.sheet.topStickerHeightMm == null) config.sheet.topStickerHeightMm = config.sheet.stickerHeightMm ?? 25;
  if (config.sheet.frontStickerHeightMm == null) config.sheet.frontStickerHeightMm = 40;

  const stickers = Array.isArray(config.stickers) ? config.stickers : [];
  for (const sticker of stickers) {
    if (!sticker || typeof sticker !== 'object') continue;
    if (sticker.kind == null) sticker.kind = 'top';
  }
}

export function normalizeConfigForUi(rawConfig) {
  const errors = [];
  const cfg = ensureObject(rawConfig);

  cfg.version = cfg.version ?? 1;
  cfg.sheet = ensureObject(cfg.sheet);
  cfg.debug = ensureObject(cfg.debug);
  cfg.defaults = ensureObject(cfg.defaults);
  cfg.stickers = Array.isArray(cfg.stickers) ? cfg.stickers.map(ensureObject) : [];

  migrateV1ToV2InPlace(cfg);
  migrateYellowToGradientInPlace(cfg);

  // Sheet: always fully specified so the preview has stable dimensions.
  cfg.sheet.pageSize = String(cfg.sheet.pageSize || 'a4').trim().toLowerCase();
  cfg.sheet.orientation = String(cfg.sheet.orientation || 'auto').trim().toLowerCase();
  cfg.sheet.marginMm = normalizeNumber(cfg.sheet.marginMm, 8);
  cfg.sheet.gutterMm = normalizeNumber(cfg.sheet.gutterMm, 4);
  cfg.sheet.stickerWidthMm = normalizeNumber(cfg.sheet.stickerWidthMm, 70);
  cfg.sheet.topStickerHeightMm = normalizeNumber(cfg.sheet.topStickerHeightMm, cfg.sheet.stickerHeightMm ?? 25);
  cfg.sheet.frontStickerHeightMm = normalizeNumber(cfg.sheet.frontStickerHeightMm, 40);
  cfg.sheet.cornerRadiusMm = normalizeNumber(cfg.sheet.cornerRadiusMm, 2);
  cfg.sheet.cutMarginMm = normalizeNumber(cfg.sheet.cutMarginMm, 1);
  cfg.sheet.columns = normalizeInt(cfg.sheet.columns, 2);

  // Debug: always specified (toggle controls only show/hide).
  cfg.debug.leftMm = normalizeNumber(cfg.debug.leftMm, 10);
  cfg.debug.rightFromRightMm = normalizeNumber(cfg.debug.rightFromRightMm, 40);
  cfg.debug.centerHorizontal = cfg.debug.centerHorizontal !== false;

  // Defaults: always specified (most controls edit defaults).
  cfg.defaults.logo = String(cfg.defaults.logo || '').trim();
  cfg.defaults.logoMaxWidthMm = normalizeNumber(cfg.defaults.logoMaxWidthMm, 28);
  cfg.defaults.logoMaxHeightMm = normalizeNumber(cfg.defaults.logoMaxHeightMm, 18);
  cfg.defaults.logoScale = normalizeNumber(cfg.defaults.logoScale, 1);
  cfg.defaults.gradient = normalizeHexColor(cfg.defaults.gradient || '#f7d117', errors, 'defaults.gradient', '#f7d117');
  cfg.defaults.gradientWidthMm = normalizeNumber(cfg.defaults.gradientWidthMm, 34);
  cfg.defaults.artScale = normalizeNumber(cfg.defaults.artScale, 1);

  if (cfg.stickers.length === 0) cfg.stickers.push({});
  for (const sticker of cfg.stickers) {
    sticker.name = sticker.name != null ? String(sticker.name).trim() : sticker.name;
    sticker.kind = sticker.kind != null ? String(sticker.kind).trim().toLowerCase() : sticker.kind;
    sticker.logo = sticker.logo != null ? String(sticker.logo).trim() : sticker.logo;
    sticker.art = sticker.art != null ? String(sticker.art).trim() : sticker.art;

    if (sticker.logoOffsetXMm != null) sticker.logoOffsetXMm = normalizeNumber(sticker.logoOffsetXMm, 0);
    if (sticker.logoOffsetYMm != null) sticker.logoOffsetYMm = normalizeNumber(sticker.logoOffsetYMm, 0);
    if (sticker.logoMaxWidthMm != null) sticker.logoMaxWidthMm = normalizeNumber(sticker.logoMaxWidthMm, 28);
    if (sticker.logoMaxHeightMm != null) sticker.logoMaxHeightMm = normalizeNumber(sticker.logoMaxHeightMm, 18);
    if (sticker.gradient != null) sticker.gradient = normalizeHexColor(sticker.gradient, errors, 'stickers[].gradient', cfg.defaults.gradient);
    if (sticker.gradientWidthMm != null) sticker.gradientWidthMm = normalizeNumber(sticker.gradientWidthMm, 34);
    if (sticker.artOffsetXMm != null) sticker.artOffsetXMm = normalizeNumber(sticker.artOffsetXMm, 0);
    if (sticker.artOffsetYMm != null) sticker.artOffsetYMm = normalizeNumber(sticker.artOffsetYMm, 0);
    if (sticker.artScale != null) sticker.artScale = normalizeNumber(sticker.artScale, 1);

    if (sticker.kind == null || sticker.kind === '') sticker.kind = 'top';
    if (!['top', 'front'].includes(sticker.kind)) errors.push(`stickers[].kind must be "top" or "front" (got ${String(sticker.kind)})`);

    sticker.textOverlays = Array.isArray(sticker.textOverlays) ? sticker.textOverlays.map(ensureObject) : [];
    for (const overlay of sticker.textOverlays) {
      overlay.text = overlay.text != null ? String(overlay.text) : '';
      overlay.xMm = normalizeNumber(overlay.xMm, 0);
      overlay.yMm = normalizeNumber(overlay.yMm, 0);
      overlay.font = overlay.font != null ? String(overlay.font).trim() : overlay.font;
      overlay.fontSizeMm = normalizeNumber(overlay.fontSizeMm, 3.6);
      overlay.color = normalizeHexColor(overlay.color || '#000000', errors, 'stickers[].textOverlays[].color', '#000000');
      if (overlay.background == null && overlay.backgroundColor != null) overlay.background = overlay.backgroundColor;
      overlay.background = String(overlay.background || '').trim()
        ? normalizeHexColor(overlay.background, errors, 'stickers[].textOverlays[].background', '#ffffff')
        : '';
      overlay.paddingMm = normalizeNumber(overlay.paddingMm, 1);
    }

    // UI convention: store gradient per (non-empty) sticker.
    if (sticker.gradient == null && (sticker.name || sticker.art)) sticker.gradient = cfg.defaults.gradient;
  }

  if (!['a4', 'letter'].includes(cfg.sheet.pageSize)) errors.push('sheet.pageSize must be a4 or letter');
  if (!['auto', 'portrait', 'landscape'].includes(cfg.sheet.orientation)) errors.push('sheet.orientation must be auto, portrait, or landscape');

  return { config: cfg, errors };
}

export function getEffectiveSticker(config, stickerIndex) {
  const cfg = ensureObject(config);
  const defaults = ensureObject(cfg.defaults);
  const sticker = ensureObject(Array.isArray(cfg.stickers) ? cfg.stickers[stickerIndex] : {});

  return {
    name: String(sticker.name || '').trim(),
    kind: String(sticker.kind || 'top').trim().toLowerCase() || 'top',
    logo: String(sticker.logo ?? defaults.logo ?? '').trim(),
    art: String(sticker.art || '').trim(),
    logoOffsetXMm: Number(sticker.logoOffsetXMm ?? 0) || 0,
    logoOffsetYMm: Number(sticker.logoOffsetYMm ?? 0) || 0,
    logoMaxWidthMm: Number(sticker.logoMaxWidthMm ?? defaults.logoMaxWidthMm ?? 28) || 28,
    logoMaxHeightMm: Number(sticker.logoMaxHeightMm ?? defaults.logoMaxHeightMm ?? 18) || 18,
    logoScale: Number(sticker.logoScale ?? defaults.logoScale ?? 1) || 1,
    gradient: String(sticker.gradient ?? defaults.gradient ?? '#f7d117').trim() || '#f7d117',
    gradientWidthMm: Number(sticker.gradientWidthMm ?? defaults.gradientWidthMm ?? 34) || 34,
    artOffsetXMm: Number(sticker.artOffsetXMm ?? 0) || 0,
    artOffsetYMm: Number(sticker.artOffsetYMm ?? 0) || 0,
    artScale: Number(sticker.artScale ?? defaults.artScale ?? 1) || 1,
    textOverlays: Array.isArray(sticker.textOverlays) ? sticker.textOverlays : [],
  };
}

export function updateSticker(config, stickerIndex, patch) {
  const next = structuredClone(config);
  next.stickers = Array.isArray(next.stickers) ? next.stickers : [];
  while (next.stickers.length <= stickerIndex) next.stickers.push({});
  next.stickers[stickerIndex] = applyPatch(ensureObject(next.stickers[stickerIndex]), patch);
  return next;
}

export function updateDefaults(config, patch) {
  const next = structuredClone(config);
  next.defaults = applyPatch(ensureObject(next.defaults), patch);
  return next;
}

export function dirnameFromPath(p) {
  const raw = String(p || '').trim();
  if (!raw) return '';
  const normalized = raw.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '';
  return normalized.slice(0, idx);
}

export function roundMm(value, stepMm = 0.1) {
  const step = Number(stepMm) || 0.1;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n / step) * step;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function applyPatch(target, patch) {
  const out = { ...target };
  const src = ensureObject(patch);
  for (const [key, value] of Object.entries(src)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}

function normalizeNumber(value, fallback) {
  if (value == null || value === '') return Number(fallback) || 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number(fallback) || 0;
}

function normalizeInt(value, fallback) {
  const n = normalizeNumber(value, fallback);
  return Number.isFinite(n) ? Math.round(n) : Number(fallback) || 0;
}

function normalizeHexColor(value, errors, label, fallback) {
  const raw = String(value || '').trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!match) {
    errors.push(`${label} must be a 6-digit hex color like #f7d117`);
    return String(fallback || '#f7d117');
  }
  return `#${match[1].toLowerCase()}`;
}
