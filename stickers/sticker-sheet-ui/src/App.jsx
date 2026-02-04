import React, { useEffect, useMemo, useState } from 'react';
import StickerPreview from './StickerPreview.jsx';
import { fetchServerInfo, fetchYamlFromPath } from './api.js';
import { SAMPLE_YAML, dirnameFromPath, getEffectiveSticker, normalizeConfigForUi, parseYamlOrThrow, roundMm, stringifyYaml, updateDefaults, updateSticker } from './config.js';

function normalizeKind(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'front' ? 'front' : 'top';
}

function buildCharacterGroups(config) {
  const stickers = Array.isArray(config?.stickers) ? config.stickers : [];
  const groups = [];
  const byKey = new Map();

  function ensureGroup(key, name) {
    const existing = byKey.get(key);
    if (existing) return existing;
    const created = { key, name, topIndex: -1, frontIndex: -1 };
    byKey.set(key, created);
    groups.push(created);
    return created;
  }

  for (let i = 0; i < stickers.length; i++) {
    const sticker = stickers[i] && typeof stickers[i] === 'object' ? stickers[i] : {};
    const name = String(sticker.name || '').trim();
    const kind = normalizeKind(sticker.kind);

    const baseKey = name ? `name:${name}` : `idx:${i}`;
    const group = ensureGroup(baseKey, name);

    if (kind === 'front') {
      if (group.frontIndex === -1) group.frontIndex = i;
      else ensureGroup(`${baseKey}:front:${i}`, name).frontIndex = i;
    } else {
      if (group.topIndex === -1) group.topIndex = i;
      else ensureGroup(`${baseKey}:top:${i}`, name).topIndex = i;
    }
  }

  if (groups.length === 0) groups.push({ key: 'empty', name: '', topIndex: -1, frontIndex: -1 });
  return groups;
}

export default function App() {
  const [yamlText, setYamlText] = useState('');
  const [yamlPath, setYamlPath] = useState('');
  const [config, setConfig] = useState(null);
  const [errors, setErrors] = useState([]);
  const [selectedCharacterKey, setSelectedCharacterKey] = useState('');
  const [showDebug, setShowDebug] = useState(false);
  const [canEyeDropper, setCanEyeDropper] = useState(() =>
    typeof window !== 'undefined' ? Boolean(window.EyeDropper) && Boolean(window.isSecureContext) : false,
  );
  const [isSecureContext, setIsSecureContext] = useState(() => (typeof window !== 'undefined' ? Boolean(window.isSecureContext) : true));
  const [pickFromPreview, setPickFromPreview] = useState(false);

  const basePath = useMemo(() => dirnameFromPath(yamlPath), [yamlPath]);

  useEffect(() => {
    (async () => {
      setIsSecureContext(Boolean(window.isSecureContext));
      setCanEyeDropper(Boolean(window.EyeDropper) && Boolean(window.isSecureContext));

      const url = new URL(window.location.href);
      const paramPath = String(url.searchParams.get('yamlPath') || '').trim();
      if (paramPath) setYamlPath(paramPath);

      const serverInfo = await fetchServerInfo().catch(() => ({ yamlPath: '' }));
      if (!paramPath && serverInfo?.yamlPath) setYamlPath(String(serverInfo.yamlPath || '').trim());

      const initialYaml =
        (paramPath ? await fetchYamlFromPath(paramPath) : '') ||
        (serverInfo?.yamlPath ? await fetchYamlFromPath(serverInfo.yamlPath) : '') ||
        localStorage.getItem('deckboxStickerSheetYaml') ||
        SAMPLE_YAML;

      setYamlText(initialYaml);
      loadYaml(initialYaml);
    })().catch(err => {
      setErrors([err instanceof Error ? err.message : String(err)]);
      setYamlText(SAMPLE_YAML);
      loadYaml(SAMPLE_YAML);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadYaml(text) {
    try {
      const parsed = parseYamlOrThrow(text);
      const normalized = normalizeConfigForUi(parsed);
      setConfig(normalized.config);
      setErrors(normalized.errors);
      setSelectedCharacterKey('');
      localStorage.setItem('deckboxStickerSheetYaml', text);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
      setConfig(null);
    }
  }

  function applyConfigUpdate(updater) {
    setConfig(prev => {
      const next = updater(prev);
      const normalized = normalizeConfigForUi(next);
      setErrors(normalized.errors);
      return normalized.config;
    });
  }

  const characters = useMemo(() => buildCharacterGroups(config), [config]);

  useEffect(() => {
    if (!characters.length) return;
    const exists = selectedCharacterKey && characters.some(c => c.key === selectedCharacterKey);
    if (!exists) setSelectedCharacterKey(characters[0]?.key || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters]);

  const selectedCharacter = useMemo(() => {
    return characters.find(c => c.key === selectedCharacterKey) || characters[0] || null;
  }, [characters, selectedCharacterKey]);

  const topIndex = selectedCharacter?.topIndex ?? -1;
  const frontIndex = selectedCharacter?.frontIndex ?? -1;

  const topSticker = useMemo(() => (config && topIndex >= 0 ? getEffectiveSticker(config, topIndex) : null), [config, topIndex]);
  const frontSticker = useMemo(() => (config && frontIndex >= 0 ? getEffectiveSticker(config, frontIndex) : null), [config, frontIndex]);

  const outputYaml = useMemo(() => (config ? stringifyYaml(config) : ''), [config]);

  async function copyYaml() {
    if (!outputYaml) return;
    await navigator.clipboard.writeText(outputYaml);
  }

  if (!config) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="title">Sticker Sheet UI</div>
        </header>
        <main className="main">
          <section className="panel">
            <h2>YAML</h2>
            <textarea value={yamlText} onChange={e => setYamlText(e.target.value)} rows={24} />
            <div className="row">
              <button onClick={() => loadYaml(yamlText)}>Load YAML</button>
            </div>
            {errors.length ? <pre className="errors">{errors.join('\n')}</pre> : null}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">Sticker Sheet UI</div>
        <div className="spacer" />
        <label className="toggle">
          <input type="checkbox" checked={showDebug} onChange={e => setShowDebug(e.target.checked)} /> Debug guides
        </label>
        <button onClick={copyYaml} disabled={!outputYaml}>
          Copy YAML
        </button>
      </header>

      <main className="main">
        <section className="panel">
          <h2>Input YAML</h2>
          <textarea value={yamlText} onChange={e => setYamlText(e.target.value)} rows={18} />
          <div className="row">
            <button onClick={() => loadYaml(yamlText)}>Load YAML</button>
            <button onClick={() => setYamlText(outputYaml)} disabled={!outputYaml}>
              Replace with output
            </button>
          </div>
          {errors.length ? <pre className="errors">{errors.join('\n')}</pre> : null}
        </section>

        <section className="panel center">
          <h2>Preview</h2>

          {topSticker ? (
            <>
              <div className="value">Top sticker</div>
              <StickerPreview
                widthMm={config.sheet?.stickerWidthMm}
                heightMm={config.sheet?.topStickerHeightMm}
                cornerRadiusMm={config.sheet?.cornerRadiusMm}
                cutMarginMm={config.sheet?.cutMarginMm}
                debug={config.debug}
                showDebug={showDebug}
                sticker={topSticker}
                kind="top"
                basePath={basePath}
                pickingColor={pickFromPreview}
                onArtMove={patch =>
                  applyConfigUpdate(prev =>
                    updateSticker(prev, topIndex, {
                      artOffsetXMm: roundMm(patch.artOffsetXMm),
                      artOffsetYMm: roundMm(patch.artOffsetYMm),
                    }),
                  )
                }
                onLogoMove={patch =>
                  applyConfigUpdate(prev =>
                    updateSticker(prev, topIndex, {
                      logoOffsetXMm: roundMm(patch.logoOffsetXMm),
                      logoOffsetYMm: roundMm(patch.logoOffsetYMm),
                    }),
                  )
                }
                onPickColor={hex => {
                  applyConfigUpdate(prev => updateSticker(prev, topIndex, { gradient: hex }));
                  setPickFromPreview(false);
                }}
              />
            </>
          ) : null}

          {frontSticker ? (
            <>
              <div className="value">Front sticker</div>
              <StickerPreview
                widthMm={config.sheet?.stickerWidthMm}
                heightMm={config.sheet?.frontStickerHeightMm}
                cornerRadiusMm={config.sheet?.cornerRadiusMm}
                cutMarginMm={config.sheet?.cutMarginMm}
                debug={config.debug}
                showDebug={showDebug}
                sticker={frontSticker}
                kind="front"
                basePath={basePath}
                pickingColor={false}
                onArtMove={patch =>
                  applyConfigUpdate(prev =>
                    updateSticker(prev, frontIndex, {
                      artOffsetXMm: roundMm(patch.artOffsetXMm),
                      artOffsetYMm: roundMm(patch.artOffsetYMm),
                    }),
                  )
                }
                onLogoMove={patch =>
                  applyConfigUpdate(prev =>
                    updateSticker(prev, frontIndex, {
                      logoOffsetXMm: roundMm(patch.logoOffsetXMm),
                      logoOffsetYMm: roundMm(patch.logoOffsetYMm),
                    }),
                  )
                }
              />
            </>
          ) : null}

          <div className="hint">Drag art/logo in the previews. Use sliders to zoom.</div>
        </section>

        <section className="panel">
          <h2>Characters</h2>
          <div className="stickerList">
            {characters.map(ch => (
              <button key={ch.key} className={ch.key === selectedCharacterKey ? 'chip active' : 'chip'} onClick={() => setSelectedCharacterKey(ch.key)}>
                {(ch.name || '(Unnamed)')}{ch.topIndex >= 0 ? ' · Top' : ''}{ch.frontIndex >= 0 ? ' · Front' : ''}
              </button>
            ))}
            <button
              onClick={() => {
                applyConfigUpdate(prev => {
                  const next = structuredClone(prev);
                  next.stickers = Array.isArray(next.stickers) ? next.stickers : [];
                  next.stickers.push({ name: 'New Character', kind: 'top' });
                  return next;
                });
              }}
            >
              + Add
            </button>
          </div>

          <h2>Logo</h2>
          <div className="row">
            <label className="field">
              Path
              <input
                value={config.defaults?.logo || ''}
                onChange={e => applyConfigUpdate(prev => updateDefaults(prev, { logo: e.target.value }))}
                placeholder="assets/logo.png"
              />
            </label>
          </div>

          <div className="row">
            <label className="field">
              Character name
              <input
                value={selectedCharacter?.name || ''}
                onChange={e => {
                  const nextName = String(e.target.value || '');
                  applyConfigUpdate(prev => {
                    const next = structuredClone(prev);
                    next.stickers = Array.isArray(next.stickers) ? next.stickers : [];
                    if (topIndex >= 0 && next.stickers[topIndex]) next.stickers[topIndex] = { ...(next.stickers[topIndex] || {}), name: nextName };
                    if (frontIndex >= 0 && next.stickers[frontIndex]) next.stickers[frontIndex] = { ...(next.stickers[frontIndex] || {}), name: nextName };
                    return next;
                  });
                }}
                placeholder="Cyclops"
              />
            </label>
          </div>

          <h2>Top sticker</h2>
          {topIndex >= 0 && topSticker ? (
            <>
              <div className="row">
                <label className="field">
                  Art path
                  <input
                    value={topSticker.art || ''}
                    onChange={e => applyConfigUpdate(prev => updateSticker(prev, topIndex, { art: e.target.value }))}
                    placeholder="assets/sample/image.png"
                  />
                </label>
              </div>
              <div className="row">
                <label className="field">
                  Art zoom
                  <input
                    type="range"
                    min="0.25"
                    max="3"
                    step="0.01"
                    value={Number(topSticker.artScale) || 1}
                    onChange={e => applyConfigUpdate(prev => updateSticker(prev, topIndex, { artScale: Number(e.target.value) }))}
                  />
                </label>
                <div className="value">{(Number(topSticker.artScale) || 1).toFixed(2)}×</div>
              </div>
              <div className="row">
                <div className="value">
                  Art offset: {Number(topSticker.artOffsetXMm || 0).toFixed(1)}mm, {Number(topSticker.artOffsetYMm || 0).toFixed(1)}mm
                </div>
                <button onClick={() => applyConfigUpdate(prev => updateSticker(prev, topIndex, { artOffsetXMm: 0, artOffsetYMm: 0 }))}>Center</button>
              </div>

              <div className="row">
                <div className="value">
                  Logo offset: {Number(topSticker.logoOffsetXMm || 0).toFixed(1)}mm, {Number(topSticker.logoOffsetYMm || 0).toFixed(1)}mm
                </div>
                <button onClick={() => applyConfigUpdate(prev => updateSticker(prev, topIndex, { logoOffsetXMm: 0, logoOffsetYMm: 0 }))}>Reset</button>
              </div>
              <div className="row">
                <label className="field">
                  Logo scale
                  <input
                    type="range"
                    min="0.25"
                    max="2"
                    step="0.01"
                    value={Number(topSticker.logoScale) || 1}
                    onChange={e => applyConfigUpdate(prev => updateSticker(prev, topIndex, { logoScale: Number(e.target.value) }))}
                  />
                </label>
                <div className="value">{(Number(topSticker.logoScale) || 1).toFixed(2)}×</div>
                <button onClick={() => applyConfigUpdate(prev => updateSticker(prev, topIndex, { logoScale: 1 }))}>1×</button>
              </div>

              <h2>Top gradient</h2>
              <div className="row">
                <label className="field">
                  Hex
                  <input
                    value={topSticker.gradient || '#f7d117'}
                    onChange={e => applyConfigUpdate(prev => updateSticker(prev, topIndex, { gradient: e.target.value }))}
                    placeholder="#f7d117"
                  />
                </label>
                <label className="field">
                  Picker
                  <input
                    type="color"
                    value={topSticker.gradient || '#f7d117'}
                    onChange={e => applyConfigUpdate(prev => updateSticker(prev, topIndex, { gradient: e.target.value }))}
                  />
                </label>
              </div>

              <div className="row">
                <button
                  onClick={async () => {
                    if (!window.EyeDropper) {
                      alert('EyeDropper is not supported in this browser.');
                      return;
                    }
                    if (!window.isSecureContext) {
                      alert('EyeDropper requires a secure context (try http://localhost or https).');
                      return;
                    }
                    const eyeDropper = new window.EyeDropper();
                    const result = await eyeDropper.open();
                    applyConfigUpdate(prev => updateSticker(prev, topIndex, { gradient: result?.sRGBHex || '#f7d117' }));
                  }}
                  disabled={false}
                  title={
                    canEyeDropper
                      ? 'Pick a color from the screen'
                      : !isSecureContext
                        ? 'EyeDropper requires a secure context (try http://localhost)'
                        : 'EyeDropper API not supported in this browser'
                  }
                >
                  System dropper
                </button>
                <button onClick={() => setPickFromPreview(v => !v)} title="Click the art in the top preview to pick a color">
                  {pickFromPreview ? 'Cancel pick' : 'Pick from preview'}
                </button>
                <button
                  onClick={() => applyConfigUpdate(prev => updateSticker(prev, topIndex, { gradient: prev?.defaults?.gradient || '#f7d117' }))}
                  title="Reset this sticker's gradient to defaults.gradient"
                >
                  Reset
                </button>
                <label className="field">
                  Fade width (mm)
                  <input
                    type="number"
                    step="0.1"
                    value={Number(config.defaults?.gradientWidthMm) || 0}
                    onChange={e => applyConfigUpdate(prev => updateDefaults(prev, { gradientWidthMm: Number(e.target.value) }))}
                  />
                </label>
              </div>
            </>
          ) : (
            <button
              onClick={() => {
                const name = selectedCharacter?.name || '';
                applyConfigUpdate(prev => {
                  const next = structuredClone(prev);
                  next.stickers = Array.isArray(next.stickers) ? next.stickers : [];
                  next.stickers.push({ name, kind: 'top' });
                  return next;
                });
              }}
            >
              Add top sticker
            </button>
          )}

          <h2>Front sticker</h2>
          {frontIndex >= 0 && frontSticker ? (
            <>
              <div className="row">
                <label className="field">
                  Art path
                  <input
                    value={frontSticker.art || ''}
                    onChange={e => applyConfigUpdate(prev => updateSticker(prev, frontIndex, { art: e.target.value }))}
                    placeholder="assets/sample/image.png"
                  />
                </label>
              </div>
              <div className="row">
                <label className="field">
                  Art zoom
                  <input
                    type="range"
                    min="0.25"
                    max="3"
                    step="0.01"
                    value={Number(frontSticker.artScale) || 1}
                    onChange={e => applyConfigUpdate(prev => updateSticker(prev, frontIndex, { artScale: Number(e.target.value) }))}
                  />
                </label>
                <div className="value">{(Number(frontSticker.artScale) || 1).toFixed(2)}×</div>
              </div>
              <div className="row">
                <div className="value">
                  Art offset: {Number(frontSticker.artOffsetXMm || 0).toFixed(1)}mm, {Number(frontSticker.artOffsetYMm || 0).toFixed(1)}mm
                </div>
                <button onClick={() => applyConfigUpdate(prev => updateSticker(prev, frontIndex, { artOffsetXMm: 0, artOffsetYMm: 0 }))}>Center</button>
              </div>

              <div className="row">
                <div className="value">
                  Logo offset: {Number(frontSticker.logoOffsetXMm || 0).toFixed(1)}mm, {Number(frontSticker.logoOffsetYMm || 0).toFixed(1)}mm
                </div>
                <button onClick={() => applyConfigUpdate(prev => updateSticker(prev, frontIndex, { logoOffsetXMm: 0, logoOffsetYMm: 0 }))}>Reset</button>
              </div>
              <div className="row">
                <label className="field">
                  Logo scale
                  <input
                    type="range"
                    min="0.25"
                    max="2"
                    step="0.01"
                    value={Number(frontSticker.logoScale) || 1}
                    onChange={e => applyConfigUpdate(prev => updateSticker(prev, frontIndex, { logoScale: Number(e.target.value) }))}
                  />
                </label>
                <div className="value">{(Number(frontSticker.logoScale) || 1).toFixed(2)}×</div>
                <button onClick={() => applyConfigUpdate(prev => updateSticker(prev, frontIndex, { logoScale: 1 }))}>1×</button>
              </div>
            </>
          ) : (
            <button
              onClick={() => {
                const name = selectedCharacter?.name || '';
                applyConfigUpdate(prev => {
                  const next = structuredClone(prev);
                  next.stickers = Array.isArray(next.stickers) ? next.stickers : [];
                  next.stickers.push({ name, kind: 'front' });
                  return next;
                });
              }}
            >
              Add front sticker
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
