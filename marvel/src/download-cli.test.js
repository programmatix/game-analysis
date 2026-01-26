const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

function startServer(routes) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const handler = routes.get(url.pathname);
    if (!handler) {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
      return;
    }
    handler(req, res, url);
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function runDownloadCli(args, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 15_000;
  const cliPath = path.resolve(__dirname, 'download-cli.js');
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

test('marvel-download: --no-hero omits hero and alter-ego', async () => {
  const deck = {
    name: 'Test Deck',
    hero_name: 'Test Hero',
    hero_code: '01001a',
    slots: {
      '01002': 2,
      '01003': 1,
      '01004': 1,
    },
  };

  const cards = [
    {
      code: '01001a',
      name: 'Test Hero',
      type_code: 'hero',
      card_set_code: 'testhero',
      linked_to_code: '01001b',
      pack_code: 'testhero',
    },
    {
      code: '01001b',
      name: 'Test Alter Ego',
      type_code: 'alter_ego',
      card_set_code: 'testhero',
      pack_code: 'testhero',
    },
    { code: '01002', name: 'Backflip', type_code: 'event' },
    { code: '01003', name: 'Some Ally', type_code: 'ally' },
    { code: '01004', name: 'Signature Ally', type_code: 'ally', card_set_code: 'testhero', pack_code: 'testhero' },
    {
      code: '01005',
      name: 'Set Aside Thing',
      type_code: 'support',
      faction_code: 'hero',
      pack_code: 'testhero',
      card_set_code: 'testhero_side',
      quantity: 1,
    },
  ];

  const routes = new Map();
  routes.set('/api/public/decklist/1', (_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(deck));
  });
  routes.set('/api/public/deck/1', (_req, res) => {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({}));
  });
  routes.set('/api/public/cards/', (_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(cards));
  });

  const { server, baseUrl } = await startServer(routes);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'marvel-download-test-'));
  const dataCache = path.join(tmpDir, 'cards.json');

  try {
    const baseline = await runDownloadCli(['1', '--base-url', baseUrl, '--data-cache', dataCache, '--no-header']);
    assert.equal(baseline.status, 0, `baseline failed: ${baseline.stderr}`);
    assert.match(baseline.stdout, /\[01001a\]/);
    assert.match(baseline.stdout, /\[01001b\]/);
    assert.match(baseline.stdout, /\[01002\]/);
    assert.match(baseline.stdout, /\[01003\]/);
    assert.match(baseline.stdout, /\[01004\]/);
    assert.match(baseline.stdout, /Set Aside Thing\[01005\]\[ignoreForDeckLimit\]/);

    const filtered = await runDownloadCli(['1', '--base-url', baseUrl, '--data-cache', dataCache, '--no-header', '--no-hero']);
    assert.equal(filtered.status, 0, `filtered failed: ${filtered.stderr}`);
    assert.doesNotMatch(filtered.stdout, /\[01001a\]/);
    assert.doesNotMatch(filtered.stdout, /\[01001b\]/);
    assert.doesNotMatch(filtered.stdout, /\[01004\]/);
    assert.doesNotMatch(filtered.stdout, /\[01005\]/);
    assert.match(filtered.stdout, /\[01002\]/);
    assert.match(filtered.stdout, /\[01003\]/);
  } finally {
    server.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
