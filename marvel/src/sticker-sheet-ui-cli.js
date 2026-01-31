#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const { Command } = require('commander');

async function main() {
  const program = new Command();
  program
    .name('marvel-sticker-sheet-ui')
    .description('Interactive UI for editing marvel-sticker-sheet YAML configs')
    .option('--yaml <file>', 'YAML config path to load on startup', '')
    .option('--host <host>', 'Host to bind (default: 127.0.0.1)', '127.0.0.1')
    .option('--port <number>', 'Port to bind', '5173')
    .option('--no-open', 'Do not open a browser tab')
    .parse(process.argv);

  const opts = program.opts();
  const host = String(opts.host || '127.0.0.1').trim() || '127.0.0.1';
  const port = clampPort(opts.port, 5173);

  const yamlPath = String(opts.yaml || '').trim() ? path.resolve(String(opts.yaml).trim()) : '';
  if (yamlPath) {
    try {
      await fs.promises.access(yamlPath);
    } catch (err) {
      throw new Error(`YAML file does not exist or is not readable: ${yamlPath}`);
    }
  }

  const marvelRoot = path.resolve(__dirname, '..');
  process.chdir(marvelRoot);

  const uiRoot = path.resolve(marvelRoot, 'sticker-sheet-ui');
  const { createServer } = await import('vite');
  const open = (await import('open')).default;

  const server = await createServer({
    root: uiRoot,
    configFile: path.resolve(uiRoot, 'vite.config.js'),
    plugins: [fsApiPlugin({ yamlPath })],
    server: {
      host,
      port,
      strictPort: true,
    },
  });

  await server.listen();

  const url = new URL(server.resolvedUrls?.local?.[0] || `http://${host}:${port}/`);
  if (yamlPath) url.searchParams.set('yamlPath', yamlPath);

  console.log(`Sticker Sheet UI: ${url.toString()}`);
  if (opts.open) await open(url.toString());

  let closed = false;
  async function closeAndExit(code) {
    if (closed) return;
    closed = true;
    try {
      await server.close();
    } finally {
      process.exit(code);
    }
  }
  process.on('SIGINT', () => void closeAndExit(0));
  process.on('SIGTERM', () => void closeAndExit(0));

  await new Promise(() => {});
}

function fsApiPlugin({ yamlPath }) {
  return {
    name: 'marvel-sticker-sheet-ui-fs-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url || '/', 'http://localhost');
          if (url.pathname === '/api/yaml') return await handleYamlRequest(url, res);
          if (url.pathname === '/api/file') return await handleFileRequest(url, res);
          if (url.pathname === '/api/info') return await handleInfoRequest(url, res, { yamlPath });
          return next();
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end(err instanceof Error ? err.message : String(err));
        }
      });
    },
  };
}

async function handleInfoRequest(url, res, { yamlPath }) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ yamlPath: yamlPath || '' }));
}

async function handleYamlRequest(url, res) {
  const filePath = resolveQueryPath(url, { key: 'path', baseKey: 'base' });
  if (!filePath) {
    res.statusCode = 400;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Missing query param: path');
    return;
  }

  let text = '';
  try {
    text = await fs.promises.readFile(filePath, 'utf8');
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(`File not found: ${filePath}`);
      return;
    }
    throw err;
  }
  res.statusCode = 200;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(text);
}

async function handleFileRequest(url, res) {
  const filePath = resolveQueryPath(url, { key: 'path', baseKey: 'base' });
  if (!filePath) {
    res.statusCode = 400;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Missing query param: path');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    res.statusCode = 415;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('Unsupported file type (only png/jpg/jpeg/webp are allowed)');
    return;
  }

  let data;
  try {
    data = await fs.promises.readFile(filePath);
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(`File not found: ${filePath}`);
      return;
    }
    throw err;
  }
  res.statusCode = 200;
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', contentTypeForExtension(ext));
  res.end(data);
}

function resolveQueryPath(url, { key, baseKey }) {
  const raw = String(url.searchParams.get(key) || '').trim();
  if (!raw) return '';
  const base = String(url.searchParams.get(baseKey) || '').trim();
  if (path.isAbsolute(raw)) return raw;
  if (base) return path.resolve(base, raw);
  return path.resolve(raw);
}

function contentTypeForExtension(ext) {
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function clampPort(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < 1 || i > 65535) return fallback;
  return i;
}

main().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
