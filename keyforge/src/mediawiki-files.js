const ARCHON_ARCANA_API = 'https://archonarcana.com/api.php';

function buildApiUrl(params) {
  const url = new URL(ARCHON_ARCANA_API);
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'lorcana-cli/1.0 (keyforge-adventures)',
      accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const detail = text && text.length < 500 ? `\n${text}` : '';
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})${detail}`);
  }
  return res.json();
}

async function resolveFileUrl(fileName) {
  const safeName = String(fileName || '').trim();
  if (!safeName) {
    throw new Error('resolveFileUrl requires a file name.');
  }

  const url = buildApiUrl({
    action: 'query',
    format: 'json',
    titles: `File:${safeName}`,
    prop: 'imageinfo',
    iiprop: 'url',
    iilimit: 1,
  });

  const json = await fetchJson(url);
  const pages = json?.query?.pages || {};
  const firstPage = Object.values(pages)[0];
  const imageInfo = firstPage?.imageinfo?.[0];
  const directUrl = imageInfo?.url;
  if (!directUrl) {
    const title = firstPage?.title || `File:${safeName}`;
    throw new Error(`Unable to resolve MediaWiki file URL for "${title}".`);
  }
  return directUrl;
}

module.exports = {
  resolveFileUrl,
};

