const fs = require('fs');
const path = require('path');
const { sanitizeFileName } = require('../../shared/deck-utils');

const DEFAULT_CDN_BASE_URL = 'https://cdn.ashes.live';

class MissingCardImageSourceError extends Error {
  constructor(label) {
    super(label ? `Card image source is missing for "${label}".` : 'Card image source is missing.');
    this.name = 'MissingCardImageSourceError';
    Error.captureStackTrace?.(this, MissingCardImageSourceError);
  }
}

function resolveImageUrl(imageSrc, baseUrl = DEFAULT_CDN_BASE_URL, context = {}) {
  const raw = typeof imageSrc === 'string' ? imageSrc.trim() : '';
  if (!raw) {
    const label = typeof context.label === 'string' ? context.label.trim() : '';
    throw new MissingCardImageSourceError(label);
  }

  if (/^https?:\/\//i.test(raw)) return raw;
  return new URL(raw.startsWith('/') ? raw : `/${raw}`, baseUrl).toString();
}

async function resolveCardImageSource({ card, imageSrc }, options = {}) {
  const cdnBaseUrl = typeof options.cdnBaseUrl === 'string' && options.cdnBaseUrl.trim()
    ? options.cdnBaseUrl.trim()
    : DEFAULT_CDN_BASE_URL;

  const label = formatCardLabel(card);
  const explicit = typeof imageSrc === 'string' ? imageSrc.trim() : '';
  if (explicit) return resolveImageUrl(explicit, cdnBaseUrl, { label });

  const stub = card?.stub ? String(card.stub).trim() : '';
  if (!stub) return null;

  return new URL(`/images/cards/${encodeURIComponent(stub)}.jpg`, cdnBaseUrl).toString();
}

async function probeImageUrl(url) {
  let res;
  try {
    res = await fetch(url, { method: 'HEAD' });
    if (res.ok) return true;
    if (res.status === 404) return false;
  } catch (_) {
    // ignore and fall through to GET probe
  }

  try {
    res = await fetch(url, { method: 'GET', headers: { range: 'bytes=0-0' } });
    if (!res.ok) return false;
    try {
      res.body?.cancel?.();
    } catch (_) {
      // ignore
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function ensureCardImage({ card, imageSrc }, cacheDir, options = {}) {
  const url = await resolveCardImageSource({ card, imageSrc }, options);
  if (!url) {
    throw new MissingCardImageSourceError(formatCardLabel(card));
  }

  const parsedUrl = new URL(url);
  const urlPath = parsedUrl.pathname;
  const basename = path.basename(urlPath);
  const ext = (path.extname(basename) || '.jpg').toLowerCase();
  const stub = card?.stub ? String(card.stub).trim() : '';
  const identifier = sanitizeFileName(card?.name || stub || basename) || 'card';
  const source = sanitizeFileName(parsedUrl.host) || 'unknown-source';
  const key = sanitizeFileName(stub || basename.replace(new RegExp(`${escapeRegExp(ext)}$`), '')) || 'card';
  const fileName = `${identifier}-${key}-${source}${ext}`;
  const filePath = path.join(cacheDir, fileName);

  if (await fileExists(filePath)) return filePath;

  if (!(await probeImageUrl(url))) {
    throw new Error(`Image URL not found for "${formatCardLabel(card)}": ${url}`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    const label = formatCardLabel(card) || basename || url;
    throw new Error(`Failed to download image for "${label}": ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(filePath, buffer);
  return filePath;
}

async function embedImage(pdfDoc, imagePath, cache) {
  if (cache.has(imagePath)) return cache.get(imagePath);

  const data = await fs.promises.readFile(imagePath);
  const type = sniffImageType(data);
  const embedded = type === 'jpg' ? await pdfDoc.embedJpg(data) : await pdfDoc.embedPng(data);
  cache.set(imagePath, embedded);
  return embedded;
}

function formatCardLabel(card) {
  if (!card || typeof card !== 'object') return 'unknown card';

  const name = typeof card.name === 'string' ? card.name.trim() : '';
  const stub = card.stub != null ? String(card.stub).trim() : '';

  if (name && stub) return `${name} (${stub})`;
  if (name) return name;
  if (stub) return `stub ${stub}`;
  return 'unknown card';
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

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }

  throw new Error('Downloaded image file is not a PNG or JPEG (check the cache entry).');
}

module.exports = {
  DEFAULT_CDN_BASE_URL,
  MissingCardImageSourceError,
  resolveImageUrl,
  resolveCardImageSource,
  ensureCardImage,
  formatCardLabel,
  embedImage,
};

