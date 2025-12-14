const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { sanitizeFileName } = require('../../shared/deck-utils');

async function ensureCardImage(card, cacheDir, defaultFace) {
  const imageCode = normalizeImageCode(card?.code, defaultFace);
  const identifier = sanitizeFileName(card?.name || imageCode);
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

function normalizeImageCode(code, defaultFace) {
  const trimmed = (code || '').trim();
  if (!trimmed) {
    throw new Error('Card code is missing for an entry.');
  }
  const normalized = trimmed.toLowerCase();
  if (/[a-z]$/.test(normalized)) {
    return normalized;
  }
  const face = defaultFace === 'b' ? 'b' : 'a';
  return `${normalized}${face}`;
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
