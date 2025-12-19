const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { sanitizeFileName } = require('../../shared/deck-utils');

async function ensureCardImage(card, cacheDir, defaultFace, options = {}) {
  const target = card && card.card ? card.card : card;
  if (!target || !target.code) {
    const label = target?.name || card?.name || 'unknown card';
    const keys = target && typeof target === 'object' ? Object.keys(target).join(',') : card && typeof card === 'object' ? Object.keys(card).join(',') : 'no data';
    console.error('Card image lookup failed. Raw card value:', card);
    throw new Error(`Card code is missing for "${label}" (${keys}). Check the deck entry and card data.`);
  }

  const imageCode = normalizeImageCode(target.code, defaultFace, options.face, target.name);
  const identifier = sanitizeFileName(target.name || imageCode);
  const fileName = `${identifier || 'card'}-${imageCode}.png`;
  const filePath = path.join(cacheDir, fileName);

  if (await fileExists(filePath)) {
    return filePath;
  }

  const url = buildImageUrl(imageCode);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image for "${card?.name || imageCode}": ${response.status} ${response.statusText}`);
  }
  const webpBuffer = Buffer.from(await response.arrayBuffer());
  const pngBuffer = await sharp(webpBuffer).png().toBuffer();
  await fs.promises.writeFile(filePath, pngBuffer);
  return filePath;
}

function normalizeImageCode(code, defaultFace, faceOverride, cardName) {
  const trimmed = (code || '').trim();
  if (!trimmed) {
    const label = cardName || 'card';
    throw new Error(`Card code is missing for "${label}". Check the deck entry and card data.`);
  }
  const normalized = trimmed.toLowerCase();

  const preferredFace = normalizeFace(faceOverride) ?? normalizeFace(defaultFace);
  if (/[a-z]$/.test(normalized)) {
    if (preferredFace) {
      return `${normalized.slice(0, -1)}${preferredFace}`;
    }
    return normalized;
  }

  const face = preferredFace || 'a';
  return `${normalized}${face}`;
}

function normalizeFace(value) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  return lower === 'b' ? 'b' : lower === 'a' ? 'a' : null;
}

function buildImageUrl(imageCode) {
  const normalized = imageCode.toLowerCase();
  const prefixMatch = /^(\d{2})/.exec(normalized);
  const prefix = prefixMatch ? prefixMatch[1] : normalized.slice(0, 2);
  return `https://dragncards-ahlcg.s3.amazonaws.com/images/card_images/${prefix}/${normalized}.webp`;
}

async function embedImage(pdfDoc, imagePath, cache) {
  if (cache.has(imagePath)) {
    return cache.get(imagePath);
  }

  const data = await fs.promises.readFile(imagePath);
  const embedded = await pdfDoc.embedPng(data);
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

module.exports = {
  buildImageUrl,
  embedImage,
  ensureCardImage,
};
