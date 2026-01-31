import React, { useEffect, useMemo, useState } from 'react';
import StickerPreview from './StickerPreview.jsx';
import { fetchServerInfo, fetchYamlFromPath } from './api.js';
import { SAMPLE_YAML, dirnameFromPath, getEffectiveSticker, normalizeConfigForUi, parseYamlOrThrow, roundMm, stringifyYaml, updateDefaults, updateSticker } from './config.js';

export default function App() {
  const [yamlText, setYamlText] = useState('');
  const [yamlPath, setYamlPath] = useState('');
  const [config, setConfig] = useState(null);
  const [errors, setErrors] = useState([]);
  const [selectedSticker, setSelectedSticker] = useState(0);
  const [showDebug, setShowDebug] = useState(false);

  const basePath = useMemo(() => dirnameFromPath(yamlPath), [yamlPath]);

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const paramPath = String(url.searchParams.get('yamlPath') || '').trim();
      if (paramPath) setYamlPath(paramPath);

      const serverInfo = await fetchServerInfo().catch(() => ({ yamlPath: '' }));
      if (!paramPath && serverInfo?.yamlPath) setYamlPath(String(serverInfo.yamlPath || '').trim());

      const initialYaml =
        (paramPath ? await fetchYamlFromPath(paramPath) : '') ||
        (serverInfo?.yamlPath ? await fetchYamlFromPath(serverInfo.yamlPath) : '') ||
        localStorage.getItem('marvelStickerSheetYaml') ||
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
      setSelectedSticker(0);
      localStorage.setItem('marvelStickerSheetYaml', text);
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

  const selected = useMemo(() => {
    if (!config) return null;
    const idx = Math.max(0, Math.min(selectedSticker, (config.stickers?.length || 1) - 1));
    return getEffectiveSticker(config, idx);
  }, [config, selectedSticker]);

  const outputYaml = useMemo(() => (config ? stringifyYaml(config) : ''), [config]);

  async function copyYaml() {
    if (!outputYaml) return;
    await navigator.clipboard.writeText(outputYaml);
  }

  if (!config) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="title">Marvel Sticker Sheet UI</div>
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
        <div className="title">Marvel Sticker Sheet UI</div>
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
          <h2>Output YAML</h2>
          <textarea value={outputYaml} readOnly rows={10} />
        </section>

        <section className="panel center">
          <h2>Preview</h2>
          {selected ? (
            <StickerPreview
              sheet={config.sheet}
              debug={config.debug}
              showDebug={showDebug}
              sticker={selected}
              basePath={basePath}
              onArtMove={patch =>
                applyConfigUpdate(prev =>
                  updateSticker(prev, selectedSticker, {
                    artOffsetXMm: roundMm(patch.artOffsetXMm),
                    artOffsetYMm: roundMm(patch.artOffsetYMm),
                  }),
                )
              }
              onLogoMove={patch =>
                applyConfigUpdate(prev =>
                  updateDefaults(prev, {
                    logoOffsetXMm: roundMm(patch.logoOffsetXMm),
                    logoOffsetYMm: roundMm(patch.logoOffsetYMm),
                  }),
                )
              }
            />
          ) : null}
          <div className="hint">Drag art to position it. Drag the logo to shift it. Use controls to zoom and set gradient.</div>
        </section>

        <section className="panel">
          <h2>Stickers</h2>
          <div className="stickerList">
            {(config.stickers || []).map((s, idx) => (
              <button key={idx} className={idx === selectedSticker ? 'chip active' : 'chip'} onClick={() => setSelectedSticker(idx)}>
                {idx + 1}
                {s?.name ? ` · ${String(s.name)}` : ''}
              </button>
            ))}
          </div>

          <h2>Art</h2>
          <div className="row">
            <label className="field">
              Path
              <input
                value={selected?.art || ''}
                onChange={e => applyConfigUpdate(prev => updateSticker(prev, selectedSticker, { art: e.target.value }))}
                placeholder="assets/cyclops/image.png"
              />
            </label>
          </div>
          <div className="row">
            <label className="field">
              Zoom
              <input
                type="range"
                min="0.25"
                max="3"
                step="0.01"
                value={Number(selected?.artScale) || 1}
                onChange={e => applyConfigUpdate(prev => updateSticker(prev, selectedSticker, { artScale: Number(e.target.value) }))}
              />
            </label>
            <div className="value">{(Number(selected?.artScale) || 1).toFixed(2)}×</div>
          </div>
          <div className="row">
            <div className="value">
              Offset: {Number(selected?.artOffsetXMm || 0).toFixed(1)}mm, {Number(selected?.artOffsetYMm || 0).toFixed(1)}mm
            </div>
            <button onClick={() => applyConfigUpdate(prev => updateSticker(prev, selectedSticker, { artOffsetXMm: 0, artOffsetYMm: 0 }))}>Center</button>
          </div>

          <h2>Logo (defaults)</h2>
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
            <div className="value">
              Offset: {Number(config.defaults?.logoOffsetXMm || 0).toFixed(1)}mm, {Number(config.defaults?.logoOffsetYMm || 0).toFixed(1)}mm
            </div>
            <button onClick={() => applyConfigUpdate(prev => updateDefaults(prev, { logoOffsetXMm: 0, logoOffsetYMm: 0 }))}>Reset</button>
          </div>

          <h2>Gradient</h2>
          <div className="row">
            <label className="field">
              Hex
              <input
                value={config.defaults?.gradient || '#f7d117'}
                onChange={e => applyConfigUpdate(prev => updateDefaults(prev, { gradient: e.target.value }))}
                placeholder="#f7d117"
              />
            </label>
            <label className="field">
              Picker
              <input
                type="color"
                value={config.defaults?.gradient || '#f7d117'}
                onChange={e => applyConfigUpdate(prev => updateDefaults(prev, { gradient: e.target.value }))}
              />
            </label>
          </div>
          <div className="row">
            <button
              onClick={async () => {
                if (!window.EyeDropper) return;
                const eyeDropper = new window.EyeDropper();
                const result = await eyeDropper.open();
                applyConfigUpdate(prev => updateDefaults(prev, { gradient: result?.sRGBHex || prev.defaults?.gradient || '#f7d117' }));
              }}
              disabled={!window.EyeDropper}
              title={window.EyeDropper ? 'Pick a color from the screen' : 'EyeDropper API not supported in this browser'}
            >
              Dropper
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
        </section>
      </main>
    </div>
  );
}
