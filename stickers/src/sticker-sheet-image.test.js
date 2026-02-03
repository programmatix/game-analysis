const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { renderStickerSheetPng } = require('./sticker-sheet-image');

function hasChrome() {
  const candidates = ['google-chrome', 'chromium', 'chromium-browser', 'chrome'].filter(Boolean);
  for (const exe of candidates) {
    const res = spawnSync(exe, ['--version'], { stdio: 'ignore' });
    if (res.status === 0) return true;
  }
  return false;
}

test('renderStickerSheetPng: renders a page image', { skip: !hasChrome() }, async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sticker-sheet-image-'));
  try {
    const out = path.join(dir, 'sheet.png');
    const config = {
      sheet: {
        pageWidthMm: 210,
        pageHeightMm: 297,
        orientation: 'portrait',
        columns: 2,
        marginMm: 8,
        gutterMm: 4,
        stickerWidthMm: 70,
        topStickerHeightMm: 25,
        frontStickerHeightMm: 40,
        cornerRadiusMm: 2,
      },
      debug: { leftMm: 10, rightFromRightMm: 40, centerHorizontal: true },
      defaults: {},
      stickers: [
        {
          kind: 'top',
          gradient: '#f7d117',
          gradientWidthMm: 34,
          logoMaxWidthMm: 28,
          logoMaxHeightMm: 18,
          logoScale: 1,
          logoOffsetXMm: 0,
          logoOffsetYMm: 0,
          artScale: 1,
          artOffsetXMm: 0,
          artOffsetYMm: 0,
          textOverlays: [{ text: 'Test', xMm: 42, yMm: 3, font: 'Helvetica', fontSizeMm: 3.6, color: '#000000' }],
        },
      ],
    };

    const result = await renderStickerSheetPng(config, { outputPath: out, pxPerMm: 12, debug: config.debug });
    assert.equal(result.outputs.length, 1);
    const stat = await fs.promises.stat(result.outputs[0]);
    assert.ok(stat.size > 10_000, `expected output PNG to be non-trivial (got ${stat.size} bytes)`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

