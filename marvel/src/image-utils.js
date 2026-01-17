const fs = require('fs');
const path = require('path');
const { sanitizeFileName } = require('../../shared/deck-utils');

const DEFAULT_BASE_URL = 'https://marvelcdb.com';
const DEFAULT_FALLBACK_IMAGE_BASE_URL = 'https://db.merlindumesnil.net';

class MissingCardImageSourceError extends Error {
  constructor(label) {
    super(label ? `Card image source is missing for "${label}".` : 'Card image source is missing.');
    this.name = 'MissingCardImageSourceError';
    Error.captureStackTrace?.(this, MissingCardImageSourceError);
  }
}

function resolveImageUrl(imageSrc, baseUrl = DEFAULT_BASE_URL, context = {}) {
  const raw = typeof imageSrc === 'string' ? imageSrc.trim() : '';
  if (!raw) {
    const label = typeof context.label === 'string' ? context.label.trim() : '';
    throw new MissingCardImageSourceError(label);
  }

  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(raw.startsWith('/') ? raw : `/${raw}`, baseUrl).toString();
}

const fallbackImageCache = new Map(); // code -> absolute url (or null)

async function resolveCardImageSource({ card, imageSrc, face }, options = {}) {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const fallbackBaseUrl = options.fallbackImageBaseUrl || DEFAULT_FALLBACK_IMAGE_BASE_URL;
  const label = formatCardLabel(card, face);

  const explicit = typeof imageSrc === 'string' ? imageSrc.trim() : '';
  if (explicit) return resolveImageUrl(explicit, baseUrl, { label });

  const code = card?.code != null ? String(card.code).trim() : '';
  if (!code) return null;

  // Prefer Merlin's mirror when available; it tends to have higher-resolution images.
  if (fallbackImageCache.has(code)) {
    return fallbackImageCache.get(code);
  }

  const resolved = await resolveMerlinFallbackImageUrl(code, fallbackBaseUrl);
  fallbackImageCache.set(code, resolved);
  if (resolved) return resolved;

  const primary = typeof card?.imagesrc === 'string' ? card.imagesrc.trim() : '';
  if (primary) return resolveImageUrl(primary, baseUrl, { label });

  return null;
}

async function resolveMerlinFallbackImageUrl(code, fallbackBaseUrl) {
  const normalizedBase = typeof fallbackBaseUrl === 'string' ? fallbackBaseUrl.trim() : '';
  if (!normalizedBase) return null;

  const candidates = [
    `/bundles/cards/${code}.jpg`,
    `/bundles/cards/${code}.png`,
    `/bundles/cards/${code}.jpeg`,
  ];

  for (const pathname of candidates) {
    const url = new URL(pathname, normalizedBase).toString();
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return url;
    } catch (_) {
      // ignore and try next
    }
  }

  // Last resort: scrape the card page for an exact match.
  try {
    const pageUrl = new URL(`/card/${encodeURIComponent(code)}`, normalizedBase).toString();
    const res = await fetch(pageUrl);
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(new RegExp(`<img[^>]+src=[\"']([^\"']*/bundles/cards/${escapeRegExp(code)}\\.(?:png|jpe?g))[^\"']*[\"']`, 'i'));
    if (match?.[1]) {
      return new URL(match[1], normalizedBase).toString();
    }
  } catch (_) {
    return null;
  }

  return null;
}

async function ensureCardImage({ card, imageSrc, face }, cacheDir, options = {}) {
  const url = await resolveCardImageSource({ card, imageSrc, face }, options);
  if (!url) {
    throw new MissingCardImageSourceError(formatCardLabel(card, face));
  }
  const parsedUrl = new URL(url);
  const urlPath = parsedUrl.pathname;
  const basename = path.basename(urlPath);
  const ext = (path.extname(basename) || '.png').toLowerCase();
  const key = basename.replace(new RegExp(`${escapeRegExp(ext)}$`), '') || sanitizeFileName(card?.code) || 'card';
  const identifier = sanitizeFileName(card?.name || key);
  const source = sanitizeFileName(parsedUrl.host) || 'unknown-source';
  const fileName = `${identifier || 'card'}-${key}-${source}${ext}`;
  const filePath = path.join(cacheDir, fileName);

  if (await fileExists(filePath)) {
    return filePath;
  }

  // Backward compat: older cache keys omitted the source host.
  const legacyFileName = `${identifier || 'card'}-${key}${ext}`;
  const legacyFilePath = path.join(cacheDir, legacyFileName);
  if (await fileExists(legacyFilePath)) {
    try {
      await fs.promises.rename(legacyFilePath, filePath);
      return filePath;
    } catch (_) {
      return legacyFilePath;
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    const label = card?.name || card?.code || basename || url;
    throw new Error(`Failed to download image for "${label}": ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

function formatCardLabel(card, face) {
  if (!card || typeof card !== 'object') {
    return face ? `unknown card (${face})` : 'unknown card';
  }

  const name = typeof card.name === 'string' ? card.name.trim() : '';
  const code = card.code != null ? String(card.code).trim() : '';
  const faceSuffix = face ? ` [${face}]` : '';

  if (name && code) return `${name} (${code})${faceSuffix}`;
  if (name) return `${name}${faceSuffix}`;
  if (code) return `code ${code}${faceSuffix}`;
  return face ? `unknown card (${face})` : 'unknown card';
}

async function embedImage(pdfDoc, imagePath, cache) {
  if (cache.has(imagePath)) {
    return cache.get(imagePath);
  }

  const data = await fs.promises.readFile(imagePath);
  const type = sniffImageType(data);
  const embedded = type === 'jpg' ? await pdfDoc.embedJpg(data) : await pdfDoc.embedPng(data);
  cache.set(imagePath, embedded);
  return embedded;
}

async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sniffImageType(buffer) {
  if (!buffer || buffer.length < 4) {
    throw new Error('Downloaded image file is empty or truncated.');
  }

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG starts with FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }

  throw new Error('Downloaded image file is not a PNG or JPEG (check the cache entry).');
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_FALLBACK_IMAGE_BASE_URL,
  MissingCardImageSourceError,
  resolveImageUrl,
  resolveCardImageSource,
  ensureCardImage,
  formatCardLabel,
  embedImage,
};
