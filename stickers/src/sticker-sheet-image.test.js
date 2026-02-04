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

function hasMagick() {
  const res = spawnSync('magick', ['-version'], { stdio: 'ignore' });
  return res.status === 0;
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

test('renderStickerSheetPng: does not crop long centered overlay text', { skip: !hasChrome() || !hasMagick() }, async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sticker-sheet-image-'));
  try {
    const out = path.join(dir, 'sheet.png');
    const config = {
      sheet: {
        pageWidthMm: 70,
        pageHeightMm: 25,
        orientation: 'portrait',
        columns: 1,
        marginMm: 0,
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
          textOverlays: [{ text: 'Magneto', xMm: 0, yMm: 3, font: 'Helvetica', fontSizeMm: 12, color: '#000000', align: 'center', paddingMm: 0 }],
        },
      ],
    };

    await renderStickerSheetPng(config, { outputPath: out, pxPerMm: 12, debug: config.debug });

    // Verify the overlay isn't cropped by ensuring there are black pixels near the right edge
    // of the sticker. We keep this as a lightweight image check via ImageMagick.
    const check = spawnSync('magick', [
      out,
      '-alpha',
      'off',
      '-crop',
      '220x180+620+30', // right-side region inside a 70mm sticker at 12px/mm
      '+repage',
      '-colorspace',
      'gray',
      '-format',
      '%[fx:minima]',
      'info:',
    ], { encoding: 'utf8' });
    if (check.status !== 0) {
      assert.fail(`ImageMagick check failed: ${check.stderr || check.stdout || `exit ${check.status}`}`);
    }
    const minima = Number(String(check.stdout || '').trim());
    assert.ok(Number.isFinite(minima), `expected numeric minima, got: ${check.stdout}`);
    assert.ok(minima < 0.2, `expected some dark pixels near right edge (minima=${minima})`);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
