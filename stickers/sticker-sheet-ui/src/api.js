export async function fetchYamlFromPath(yamlPath) {
  const res = await fetch(`/api/yaml?path=${encodeURIComponent(yamlPath)}`);
  if (!res.ok) throw new Error(await res.text());
  return await res.text();
}

export function fileUrlForPath(filePath, { basePath } = {}) {
  if (!filePath) return '';
  const url = new URL('/api/file', window.location.origin);
  url.searchParams.set('path', filePath);
  if (basePath) url.searchParams.set('base', basePath);
  return url.toString();
}

export async function fetchServerInfo() {
  const res = await fetch('/api/info');
  if (!res.ok) return { yamlPath: '' };
  return await res.json();
}

