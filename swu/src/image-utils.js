const fs = require('fs');
const path = require('path');
const { sanitizeFileName } = require('../../shared/deck-utils');

class MissingCardImageSourceError extends Error {
  constructor(label) {
    super(label ? `Card image source is missing for "${label}".` : 'Card image source is missing.');
    this.name = 'MissingCardImageSourceError';
    Error.captureStackTrace?.(this, MissingCardImageSourceError);
  }
}

function resolveImageUrl(imageSrc) {
  const raw = typeof imageSrc === 'string' ? imageSrc.trim() : '';
  if (!raw) return '';
  return raw;
}

async function resolveCardImageSource({ card, imageSrc, face }) {
  const label = formatCardLabel(card, face);
  const explicit = typeof imageSrc === 'string' ? imageSrc.trim() : '';
  if (explicit) return resolveImageUrl(explicit);

  const images = card?.images || {};
  const fallback = face === 'back' ? images.back : images.front;
  const resolved = resolveImageUrl(fallback);
  if (!resolved) {
    throw new MissingCardImageSourceError(label);
  }
  return resolved;
}

async function ensureCardImage(cardRef, cacheDir) {
  const url = await resolveCardImageSource(cardRef);
  const urlPath = new URL(url).pathname;
  const basename = path.basename(urlPath);
  const ext = (path.extname(basename) || '.png').toLowerCase();
  const key = basename.replace(new RegExp(`${escapeRegExp(ext)}$`), '') || sanitizeFileName(cardRef?.card?.code) || 'card';
  const identifier = sanitizeFileName(cardRef?.card?.fullName || cardRef?.card?.name || key);
  const face = cardRef?.face ? sanitizeFileName(cardRef.face) : '';
  const fileName = `${identifier || 'card'}-${key}${face ? `-${face}` : ''}${ext}`;
  const filePath = path.join(cacheDir, fileName);

  if (await fileExists(filePath)) {
    return filePath;
  }

  const response = await fetch(url);
  if (!response.ok) {
    const label = cardRef?.card?.fullName || cardRef?.card?.name || cardRef?.card?.code || basename || url;
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

  const name = typeof card.fullName === 'string' ? card.fullName.trim() : typeof card.name === 'string' ? card.name.trim() : '';
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
  MissingCardImageSourceError,
  resolveCardImageSource,
  ensureCardImage,
  formatCardLabel,
  embedImage,
};
