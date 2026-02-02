const fs = require('node:fs');

async function embedImage(pdfDoc, imagePath, cache) {
  if (cache.has(imagePath)) return cache.get(imagePath);

  const data = await fs.promises.readFile(imagePath);
  const type = sniffImageType(data);
  const embedded = type === 'jpg' ? await pdfDoc.embedJpg(data) : await pdfDoc.embedPng(data);
  cache.set(imagePath, embedded);
  return embedded;
}

function sniffImageType(buffer) {
  if (!buffer || buffer.length < 4) {
    throw new Error('Image file is empty or truncated.');
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

  throw new Error('Image file is not a PNG or JPEG.');
}

module.exports = {
  embedImage,
};

