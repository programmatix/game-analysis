const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

test('sticker-sheet-cli: errors on sticker-level text typo', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckbox-stickers-'));
  const inputPath = path.join(dir, 'stickers.yaml');
  await fs.writeFile(
    inputPath,
    [
      'stickers:',
      '  - name: magneto',
      '    text: Magneto',
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    await execFileAsync('node', [path.join(__dirname, 'sticker-sheet-cli.js'), '--input', inputPath, '--output', path.join(dir, 'out.pdf')], {
      timeout: 30_000,
    });
    assert.fail('expected sticker-sheet-cli to exit non-zero');
  } catch (err) {
    const stderr = String(err && err.stderr ? err.stderr : '');
    assert.match(stderr, /stickers\[0\]\.text is not a supported field/i);
    assert.match(stderr, /use stickers\[0\]\.textOverlays/i);
  }
});
