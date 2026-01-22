const fs = require('fs');
const path = require('path');
const { resolveFileUrl } = require('./mediawiki-files');

class MissingCardImageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MissingCardImageError';
  }
}

async function downloadToFile(url, destinationPath) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'lorcana-cli/1.0 (keyforge-adventures)',
    },
  });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.promises.writeFile(destinationPath, Buffer.from(arrayBuffer));
}

async function ensureCardImage(card, cacheDir, { refresh = false } = {}) {
  const fileName = String(card?.image || '').trim();
  if (!fileName) {
    throw new MissingCardImageError(`Card "${card?.name || 'unknown'}" is missing an image filename.`);
  }

  const filePath = path.join(cacheDir, fileName);
  if (!refresh) {
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      return filePath;
    } catch {
      // continue
    }
  }

  const url = await resolveFileUrl(fileName);
  await downloadToFile(url, filePath);
  return filePath;
}

async function embedImage(pdfDoc, imagePath, cache) {
  const resolved = path.resolve(imagePath);
  const existing = cache.get(resolved);
  if (existing) return existing;

  const buffer = await fs.promises.readFile(resolved);
  let embedded;
  if (/\.png$/i.test(resolved)) {
    embedded = await pdfDoc.embedPng(buffer);
  } else if (/\.(jpe?g)$/i.test(resolved)) {
    embedded = await pdfDoc.embedJpg(buffer);
  } else {
    throw new Error(`Unsupported image type: ${path.basename(resolved)}`);
  }
  cache.set(resolved, embedded);
  return embedded;
}

module.exports = {
  MissingCardImageError,
  ensureCardImage,
  embedImage,
};

