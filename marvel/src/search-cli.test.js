const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

function runSearchCli(args, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 15_000;
  const cliPath = path.resolve(__dirname, 'search-cli.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        ALL_PROXY: '',
        NO_PROXY: '127.0.0.1,localhost',
        http_proxy: '',
        https_proxy: '',
        all_proxy: '',
        no_proxy: '127.0.0.1,localhost',
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ status: null, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
  });
}

test('marvel-search: --dedupe removes duplicates across packs', async () => {
  const cards = [
    {
      code: '01001',
      name: 'Dup Card',
      type_code: 'event',
      type_name: 'Event',
      faction_code: 'justice',
      faction_name: 'Justice',
      pack_code: 'p1',
      pack_name: 'Pack One',
      position: 1,
      cost: 2,
      text: '<b>Deal 2 damage.</b>',
    },
    {
      code: '02001',
      name: 'Dup Card',
      type_code: 'event',
      type_name: 'Event',
      faction_code: 'justice',
      faction_name: 'Justice',
      pack_code: 'p2',
      pack_name: 'Pack Two',
      position: 1,
      cost: 2,
      text: 'Deal 2 damage.',
    },
    {
      code: '03001',
      name: 'Dup Card',
      type_code: 'event',
      type_name: 'Event',
      faction_code: 'justice',
      faction_name: 'Justice',
      pack_code: 'p3',
      pack_name: 'Pack Three',
      position: 1,
      cost: 3,
      text: 'Deal 2 damage.',
    },
    {
      code: '90001',
      name: 'Villain Card',
      type_code: 'villain',
      type_name: 'Villain',
      pack_code: 'enc',
      pack_name: 'Encounter Set',
      position: 1,
      cost: 0,
      text: 'Bad stuff.',
    },
  ];

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvel-search-test-'));
  const dataCache = path.join(tmpDir, 'cards.json');
  await fs.writeFile(dataCache, JSON.stringify(cards, null, 2));

  try {
    const baseline = await runSearchCli(['dup', 'card', '--data-cache', dataCache, '--limit', '0']);
    assert.equal(baseline.status, 0, `baseline failed: ${baseline.stderr}`);
    assert.match(baseline.stdout, /\b01001\b/);
    assert.match(baseline.stdout, /\b02001\b/);
    assert.match(baseline.stdout, /\b03001\b/);

    const deduped = await runSearchCli(['dup', 'card', '--data-cache', dataCache, '--limit', '0', '--dedupe']);
    assert.equal(deduped.status, 0, `deduped failed: ${deduped.stderr}`);
    assert.match(deduped.stdout, /\b01001\b/);
    assert.doesNotMatch(deduped.stdout, /\b02001\b/);
    assert.match(deduped.stdout, /\b03001\b/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

