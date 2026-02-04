const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const { computePackedStickerPagesMm } = require('./sticker-sheet-layout');

function clampInt(value, { min = 1, max = 999 } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeOutputBasePath(outputPath) {
  const abs = path.resolve(String(outputPath || '').trim() || 'sticker-sheet.png');
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.png') return abs;
  return `${abs}.png`;
}

function withNumericSuffix(filePath, index1Based) {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  return `${base}-${index1Based}${ext}`;
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH ? String(process.env.CHROME_PATH) : '',
    'google-chrome',
    'chromium',
    'chromium-browser',
    'chrome',
  ].filter(Boolean);
  return candidates;
}

async function runChromeHeadless({ args, cwd }) {
  const candidates = findChromeExecutable();
  let lastErr = null;
  for (const exe of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(exe, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', d => {
          stderr += String(d);
        });
        child.on('error', reject);
        child.on('close', code => {
          if (code === 0) return resolve();
          reject(new Error(`${exe} exited with code ${code}${stderr ? `\n${stderr.trim()}` : ''}`));
        });
      });
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  const tried = candidates.map(s => `- ${s}`).join('\n');
  throw new Error(`Unable to run headless Chrome. Tried:\n${tried}\n\nLast error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

function escapeHtmlText(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildStickerSheetPageHtml({
  pageWidthMm,
  pageHeightMm,
  cornerRadiusMm,
  cutMarginMm,
  packedPage,
  baseDir,
  pxPerMm,
  konvaScriptFile,
  showDebug,
  debug,
}) {
  const konvaUrl = pathToFileURL(konvaScriptFile).toString();

  const safePxPerMm = Math.max(1, Number(pxPerMm) || 12);
  const widthPx = Math.round(pageWidthMm * safePxPerMm);
  const heightPx = Math.round(pageHeightMm * safePxPerMm);

  function looksLikeFontFilePath(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return false;
    const ext = path.extname(raw).toLowerCase();
    return ['.ttf', '.otf', '.woff', '.woff2'].includes(ext);
  }

  function resolveLocalPath(p) {
    const raw = typeof p === 'string' ? p.trim() : '';
    if (!raw) return '';
    if (path.isAbsolute(raw)) return raw;
    return path.resolve(String(baseDir || ''), raw);
  }

  function fontFormatForPath(fontPath) {
    const ext = path.extname(String(fontPath || '')).toLowerCase();
    switch (ext) {
      case '.otf':
        return 'opentype';
      case '.ttf':
        return 'truetype';
      case '.woff2':
        return 'woff2';
      case '.woff':
        return 'woff';
      default:
        return '';
    }
  }

  function fontFamilyForPath(fontPath) {
    const digest = crypto.createHash('sha1').update(String(fontPath)).digest('hex').slice(0, 12);
    return `DeckboxFont_${digest}`;
  }

  // Pre-resolve file:// URLs for images so the browser can load them directly.
  const fontFacesByPath = new Map();
  const stickers = (packedPage?.stickers || []).map(slot => {
    const rect = slot.rectMm || { x: 0, y: 0, width: 0, height: 0 };
    const sticker = slot.sticker || {};
    const artUrl = sticker.art ? pathToFileURL(String(sticker.art)).toString() : '';
    const logoUrl = sticker.logo ? pathToFileURL(String(sticker.logo)).toString() : '';
    const textOverlays = Array.isArray(sticker.textOverlays)
      ? sticker.textOverlays.map(o => {
          const overlay = o && typeof o === 'object' ? { ...o } : {};
          const explicitFontPath = typeof overlay.fontPath === 'string' ? overlay.fontPath.trim() : '';
          const implicitFontPath = !explicitFontPath && looksLikeFontFilePath(overlay.font) ? String(overlay.font || '').trim() : '';
          const fontPath = resolveLocalPath(explicitFontPath || implicitFontPath);
          if (fontPath) {
            const family = fontFamilyForPath(fontPath);
            overlay.__fontFamily = family;
            if (!fontFacesByPath.has(fontPath)) {
              fontFacesByPath.set(fontPath, {
                family,
                url: pathToFileURL(fontPath).toString(),
                format: fontFormatForPath(fontPath),
              });
            }
          }
          return overlay;
        })
      : sticker.textOverlays;
    return {
      rectMm: rect,
      sticker: {
        ...sticker,
        artUrl,
        logoUrl,
        textOverlays,
      },
    };
  });

  const fontFaces = Array.from(fontFacesByPath.values());
  const fontCss = fontFaces.map(ff => {
    const src = ff.format
      ? `url(${JSON.stringify(ff.url)}) format(${JSON.stringify(ff.format)})`
      : `url(${JSON.stringify(ff.url)})`;
    return `@font-face { font-family: ${JSON.stringify(ff.family)}; src: ${src}; font-display: block; }`;
  }).join('\n      ');

  const payload = {
    page: { widthMm: pageWidthMm, heightMm: pageHeightMm, cornerRadiusMm: Number(cornerRadiusMm) || 0 },
    stickers,
    pxPerMm: safePxPerMm,
    showDebug: Boolean(showDebug),
    debug: debug && typeof debug === 'object' ? debug : {},
    baseDir: String(baseDir || ''),
    fontFamilies: fontFaces.map(f => f.family),
    cutMarginMm: Math.max(0, Number(cutMarginMm) || 0),
  };

  // NOTE: This is intentionally a single self-contained HTML file so we can render via file:// + headless Chrome.
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>sticker-sheet</title>
    <style>
      html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
      #container { width: ${widthPx}px; height: ${heightPx}px; }
      canvas { image-rendering: auto; }
      ${fontCss}
    </style>
  </head>
  <body>
    <div id="container"></div>
    <script src="${escapeHtmlText(konvaUrl)}"></script>
    <script>
      (function () {
        const payload = ${JSON.stringify(payload)};
        const pxPerMm = payload.pxPerMm;

        function mmToPx(mm) { return (Number(mm) || 0) * pxPerMm; }
        function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

        async function ensureFontsLoaded(families) {
          const list = Array.isArray(families) ? families.filter(Boolean) : [];
          if (!list.length) return;
          if (!document.fonts || typeof document.fonts.load !== 'function') return;
          await Promise.all(list.map(family => document.fonts.load(\`16px "\${family}"\`).catch(() => null)));
          if (document.fonts && document.fonts.ready) {
            try {
              await document.fonts.ready;
            } catch {
              // ignore
            }
          }
        }

        function clipRoundedRect(ctx, x, y, w, h, r) {
          const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
          ctx.beginPath();
          ctx.moveTo(x + radius, y);
          ctx.lineTo(x + w - radius, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
          ctx.lineTo(x + w, y + h - radius);
          ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
          ctx.lineTo(x + radius, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
          ctx.lineTo(x, y + radius);
          ctx.quadraticCurveTo(x, y, x + radius, y);
          ctx.closePath();
        }

        function computeCoverRectMm(imgW, imgH, targetW, targetH, scaleFactor, offsetX, offsetY) {
          if (!imgW || !imgH) return { x: 0, y: 0, width: 0, height: 0 };
          const base = Math.max(targetW / imgW, targetH / imgH);
          const scale = base * (Number(scaleFactor) || 1);
          const width = imgW * scale;
          const height = imgH * scale;
          const x = (targetW - width) / 2 + (Number(offsetX) || 0);
          const y = (targetH - height) / 2 + (Number(offsetY) || 0);
          return { x, y, width, height };
        }

        function computeContainRectMmScaled(imgW, imgH, targetW, targetH, scaleFactor, offsetX, offsetY) {
          if (!imgW || !imgH) return { x: 0, y: 0, width: 0, height: 0 };
          const base = Math.min(targetW / imgW, targetH / imgH);
          const scale = base * (Number(scaleFactor) || 1);
          const width = imgW * scale;
          const height = imgH * scale;
          const x = (targetW - width) / 2 + (Number(offsetX) || 0);
          const y = (targetH - height) / 2 + (Number(offsetY) || 0);
          return { x, y, width, height };
        }

        function rgba(hex, alpha) {
          const h = String(hex || '').replace('#', '');
          if (!/^[0-9a-f]{6}$/i.test(h)) return 'rgba(0,0,0,' + alpha + ')';
          const r = parseInt(h.slice(0, 2), 16);
          const g = parseInt(h.slice(2, 4), 16);
          const b = parseInt(h.slice(4, 6), 16);
          return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
        }

        function loadImage(url) {
          return new Promise(resolve => {
            if (!url) return resolve(null);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = url;
          });
        }

        function drawSticker(layer, pageHeightMm, slot) {
          const rect = slot.rectMm;
          const sticker = slot.sticker || {};

          const stickerW = Number(rect.width) || 70;
          const stickerH = Number(rect.height) || 25;
          const radiusMm = Number(payload.page.cornerRadiusMm) || 2;
          const cutMarginMm = Math.max(0, Number(payload.cutMarginMm) || 0);
          const contentW = Math.max(0, stickerW - cutMarginMm * 2);
          const contentH = Math.max(0, stickerH - cutMarginMm * 2);
          const contentRadiusMm = Math.max(0, radiusMm - cutMarginMm);
          const kind = String(sticker.kind || 'top').trim().toLowerCase() || 'top';

          const xMm = Number(rect.x) || 0;
          const yMmPdf = Number(rect.y) || 0;
          const yMm = pageHeightMm - (yMmPdf + stickerH);

          const group = new Konva.Group({ x: mmToPx(xMm), y: mmToPx(yMm), listening: false });
          layer.add(group);

          const pxPerMmLocal = pxPerMm;
          const stickerRoot = new Konva.Group({ scaleX: pxPerMmLocal, scaleY: pxPerMmLocal });
          group.add(stickerRoot);

          const contentRoot = new Konva.Group({ x: cutMarginMm, y: cutMarginMm });
          stickerRoot.add(contentRoot);

          const clipGroup = new Konva.Group({
            clipFunc: ctx => clipRoundedRect(ctx, 0, 0, contentW, contentH, contentRadiusMm),
          });
          contentRoot.add(clipGroup);

          const bg = kind === 'top' ? (sticker.gradient || '#f7d117') : '#ffffff';
          clipGroup.add(new Konva.Rect({ x: 0, y: 0, width: contentW, height: contentH, fill: bg }));

          if (sticker.__artImg) {
            const artRect = computeCoverRectMm(
              sticker.__artImg.naturalWidth,
              sticker.__artImg.naturalHeight,
              contentW,
              contentH,
              sticker.artScale,
              sticker.artOffsetXMm,
              sticker.artOffsetYMm
            );
            clipGroup.add(new Konva.Image({
              image: sticker.__artImg,
              x: artRect.x,
              y: artRect.y,
              width: artRect.width,
              height: artRect.height,
              opacity: 1,
            }));
          }

          if (kind === 'top') {
            const gradientWidthMm = Math.max(0, Math.min(Number(sticker.gradientWidthMm) || 0, contentW));
            const gradientSolidMm = Math.max(0, Math.min(20, gradientWidthMm));
            const gradientFadeMm = Math.max(0, gradientWidthMm - gradientSolidMm);
            if (gradientSolidMm > 0) {
              clipGroup.add(new Konva.Rect({ x: 0, y: 0, width: gradientSolidMm, height: contentH, fill: rgba(sticker.gradient, 1), opacity: 1 }));
            }
            if (gradientFadeMm > 0) {
              clipGroup.add(new Konva.Rect({
                x: gradientSolidMm,
                y: 0,
                width: gradientFadeMm,
                height: contentH,
                fillLinearGradientStartPoint: { x: 0, y: 0 },
                fillLinearGradientEndPoint: { x: gradientFadeMm, y: 0 },
                fillLinearGradientColorStops: [0, rgba(sticker.gradient, 1), 1, rgba(sticker.gradient, 0)],
                opacity: 1,
              }));
            }
          }

          if (sticker.__logoImg) {
            const paddingMm = 1.2;
            const safeRect = { x: paddingMm, y: paddingMm, width: contentW - paddingMm * 2, height: contentH - paddingMm * 2 };
            const logoMaxWidthMm = Math.max(0, Number(sticker.logoMaxWidthMm) || 28);
            const logoMaxHeightMm = Math.max(0, Number(sticker.logoMaxHeightMm) || 18);
            const logoAreaWidthMm = Math.min(safeRect.width * 0.45, logoMaxWidthMm + 6);
            const logoArea = { x: safeRect.x, y: safeRect.y, width: logoAreaWidthMm, height: safeRect.height };
            const logoBox = {
              x: logoArea.x + (Number(sticker.logoOffsetXMm) || 0),
              y: logoArea.y + (Number(sticker.logoOffsetYMm) || 0),
              width: Math.max(0, Math.min(logoMaxWidthMm, logoArea.width)),
              height: Math.max(0, Math.min(logoMaxHeightMm, logoArea.height)),
            };
            const logoScale = Math.max(0.1, Number(sticker.logoScale) || 1);
            const contain = computeContainRectMmScaled(
              sticker.__logoImg.naturalWidth,
              sticker.__logoImg.naturalHeight,
              logoBox.width,
              logoBox.height,
              logoScale,
              0,
              0
            );

            const logoGroup = new Konva.Group({ x: logoBox.x, y: logoBox.y });
            clipGroup.add(logoGroup);
            logoGroup.add(new Konva.Rect({ x: 0, y: 0, width: logoBox.width, height: logoBox.height, fill: 'rgba(0,0,0,0.01)' }));
            logoGroup.add(new Konva.Image({ image: sticker.__logoImg, x: contain.x, y: contain.y, width: contain.width, height: contain.height, opacity: 0.98 }));
          }

          if (kind === 'top' && Array.isArray(sticker.textOverlays)) {
            for (const overlay of sticker.textOverlays) {
              if (!overlay || typeof overlay !== 'object') continue;
              const text = String(overlay.text || '');
              if (!text) continue;
              const overlayGroup = new Konva.Group({ x: Number(overlay.xMm) || 0, y: Number(overlay.yMm) || 0 });
              contentRoot.add(overlayGroup);

              const wantsCenter = overlay.center === true
                || overlay.centered === true
                || String(overlay.anchor ?? '').trim().toLowerCase() === 'center';

              const align = String(overlay.align ?? (wantsCenter ? 'center' : 'left')).trim().toLowerCase() || 'left';
              const vAlignRaw = overlay.valign ?? overlay.vAlign ?? overlay.verticalAlign ?? (wantsCenter ? 'middle' : 'top');
              let valign = String(vAlignRaw || 'top').trim().toLowerCase() || 'top';
              if (valign === 'center') valign = 'middle';
              const fontSizeMm = Math.max(0.1, Number(overlay.fontSizeMm) || 3.6);
              const paddingMm2 = Math.max(0, Number(overlay.paddingMm) || 1);
              const bg2 = typeof overlay.background === 'string' ? overlay.background : (typeof overlay.backgroundColor === 'string' ? overlay.backgroundColor : '');
              const fg2 = typeof overlay.color === 'string' ? overlay.color : '#000000';
              const fontFamily = typeof overlay.__fontFamily === 'string' && overlay.__fontFamily.trim()
                ? overlay.__fontFamily.trim()
                : (typeof overlay.font === 'string' && overlay.font.trim() ? overlay.font.trim() : 'Helvetica');

              const maxWidthMm = Math.max(0, contentW - (Number(overlay.xMm) || 0));
              const availableWidthMm = Math.max(0, maxWidthMm - paddingMm2 * 2);
              const maxHeightMm = Math.max(0, contentH - (Number(overlay.yMm) || 0));

              const textNode = new Konva.Text({
                x: 0,
                y: 0,
                text,
                fontFamily,
                fontSize: fontSizeMm,
                fill: fg2,
                wrap: 'none',
                listening: false,
              });

              function measureTextWidthMm() {
                if (typeof textNode.getTextWidth === 'function') return Math.max(0, Number(textNode.getTextWidth()) || 0);
                return Math.max(0, Number(textNode.width()) || 0);
              }

              if (availableWidthMm > 0) {
                const measured = measureTextWidthMm();
                if (measured > availableWidthMm && measured > 0) {
                  const scaled = fontSizeMm * (availableWidthMm / measured);
                  textNode.fontSize(Math.max(0.1, scaled));
                }
              }

              const textWidthMm = measureTextWidthMm();
              const textHeightMm = Math.max(0, Number(textNode.height()) || 0);
              const boxW = Math.max(0, textWidthMm + paddingMm2 * 2);
              const boxH = Math.max(0, textHeightMm + paddingMm2 * 2);

              let boxX = 0;
              if (maxWidthMm > 0) {
                if (align === 'center') boxX = (maxWidthMm - boxW) / 2;
                else if (align === 'right') boxX = maxWidthMm - boxW;
              }
              if (!Number.isFinite(boxX)) boxX = 0;

              let boxY = 0;
              if (maxHeightMm > 0) {
                if (valign === 'middle') boxY = (maxHeightMm - boxH) / 2;
                else if (valign === 'bottom') boxY = maxHeightMm - boxH;
              }
              if (!Number.isFinite(boxY)) boxY = 0;

              if (bg2) overlayGroup.add(new Konva.Rect({ x: boxX, y: boxY, width: boxW, height: boxH, fill: bg2, opacity: 0.92, listening: false }));
              textNode.position({ x: boxX + paddingMm2, y: boxY + paddingMm2 });
              overlayGroup.add(textNode);
            }
          }

          // Sticker outline
          contentRoot.add(new Konva.Rect({ x: 0, y: 0, width: contentW, height: contentH, cornerRadius: contentRadiusMm, stroke: 'rgba(0,0,0,0.5)', strokeWidth: 0.15 }));

          if (payload.showDebug) {
            const x1 = Number(payload.debug?.leftMm) || 10;
            const x2 = contentW - (Number(payload.debug?.rightFromRightMm) || 40);
            const yMid = contentH / 2;
            contentRoot.add(new Konva.Line({ points: [x1, 0, x1, contentH], stroke: 'red', strokeWidth: 0.2 }));
            contentRoot.add(new Konva.Line({ points: [x2, 0, x2, contentH], stroke: 'red', strokeWidth: 0.2 }));
            if (payload.debug?.centerHorizontal !== false) {
              contentRoot.add(new Konva.Line({ points: [0, yMid, contentW, yMid], stroke: 'red', strokeWidth: 0.2 }));
            }
          }
        }

        function drawCutMarks(layer, pageWidthMm, pageHeightMm, stickerRectsMm) {
          const insetMm = 0.7;
          const lenMm = 7;
          const strokePx = Math.max(1, Math.round(mmToPx(0.12)));

          const left = insetMm;
          const right = pageWidthMm - insetMm;
          const bottom = insetMm;
          const top = pageHeightMm - insetMm;

          const xs = new Set();
          const ys = new Set();
          for (const r of stickerRectsMm) {
            if (!r) continue;
            const x1 = Number(r.x);
            const x2 = Number(r.x) + Number(r.width);
            const y1 = Number(r.y);
            const y2 = Number(r.y) + Number(r.height);
            if (Number.isFinite(x1)) xs.add(Math.round(x1 * 10) / 10);
            if (Number.isFinite(x2)) xs.add(Math.round(x2 * 10) / 10);
            if (Number.isFinite(y1)) ys.add(Math.round(y1 * 10) / 10);
            if (Number.isFinite(y2)) ys.add(Math.round(y2 * 10) / 10);
          }
          xs.add(Math.round(left * 10) / 10);
          xs.add(Math.round(right * 10) / 10);
          ys.add(Math.round(bottom * 10) / 10);
          ys.add(Math.round(top * 10) / 10);

          const black = 'black';
          for (const x of xs) {
            layer.add(new Konva.Line({ points: [mmToPx(x), mmToPx(0), mmToPx(x), mmToPx(lenMm)], stroke: black, strokeWidth: strokePx }));
            layer.add(new Konva.Line({ points: [mmToPx(x), mmToPx(pageHeightMm), mmToPx(x), mmToPx(pageHeightMm - lenMm)], stroke: black, strokeWidth: strokePx }));
          }
          for (const yPdf of ys) {
            const y = pageHeightMm - yPdf;
            layer.add(new Konva.Line({ points: [mmToPx(0), mmToPx(y), mmToPx(lenMm), mmToPx(y)], stroke: black, strokeWidth: strokePx }));
            layer.add(new Konva.Line({ points: [mmToPx(pageWidthMm), mmToPx(y), mmToPx(pageWidthMm - lenMm), mmToPx(y)], stroke: black, strokeWidth: strokePx }));
          }
        }

        async function main() {
          // Force deterministic canvas sizing.
          if (window.Konva && typeof window.Konva.pixelRatio === 'number') window.Konva.pixelRatio = 1;

          await ensureFontsLoaded(payload.fontFamilies);

          const pageWidthMm = payload.page.widthMm;
          const pageHeightMm = payload.page.heightMm;
          const stage = new Konva.Stage({ container: 'container', width: mmToPx(pageWidthMm), height: mmToPx(pageHeightMm) });
          const layer = new Konva.Layer();
          stage.add(layer);

          // Background
          layer.add(new Konva.Rect({ x: 0, y: 0, width: stage.width(), height: stage.height(), fill: '#ffffff' }));

          // Load all images first.
          const slots = payload.stickers;
          await Promise.all(slots.map(async s => {
            const sticker = s.sticker || {};
            sticker.__artImg = await loadImage(sticker.artUrl);
            sticker.__logoImg = await loadImage(sticker.logoUrl);
            s.sticker = sticker;
          }));

          // Draw stickers
          for (const slot of slots) drawSticker(layer, pageHeightMm, slot);

          // Cut marks after stickers
          drawCutMarks(layer, pageWidthMm, pageHeightMm, slots.map(s => s.rectMm));

          layer.draw();

          // Give the browser a couple frames to rasterize everything before headless screenshot.
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          document.documentElement.dataset.ready = 'true';
        }

        main().catch(err => {
          document.body.innerText = 'Render error: ' + (err && err.message ? err.message : String(err));
          document.documentElement.dataset.ready = 'error';
        });
      })();
    </script>
  </body>
</html>`;
}

async function renderStickerSheetPng(config, { outputPath, pxPerMm = 12, debug } = {}) {
  const sheet = config?.sheet;
  if (!sheet) throw new Error('Missing config.sheet');

  const pageWidthMm = Number(sheet.pageWidthMm);
  const pageHeightMm = Number(sheet.pageHeightMm);
  if (!Number.isFinite(pageWidthMm) || !Number.isFinite(pageHeightMm)) {
    throw new Error('config.sheet.pageWidthMm/pageHeightMm must be numbers (did you normalize config first?)');
  }

  const stickerWidthMm = Number(sheet.stickerWidthMm) || 70;
  const topStickerHeightMm = Number(sheet.topStickerHeightMm ?? sheet.stickerHeightMm) || 25;
  const frontStickerHeightMm = Number(sheet.frontStickerHeightMm) || 40;

  const pages = computePackedStickerPagesMm(config, {
    pageWidthMm,
    pageHeightMm,
    stickerWidthMm,
    topStickerHeightMm,
    frontStickerHeightMm,
  });

  const baseOutputPath = normalizeOutputBasePath(outputPath);
  const baseDir = process.cwd();

  const toolRoot = path.resolve(__dirname, '..');
  const konvaScriptFile = path.resolve(toolRoot, 'node_modules', 'konva', 'konva.min.js');
  try {
    await fs.promises.access(konvaScriptFile);
  } catch {
    throw new Error(`Missing Konva browser bundle at ${konvaScriptFile}. Did you run npm install in stickers/?`);
  }

  const cacheRoot = path.resolve(toolRoot, '.cache');
  await fs.promises.mkdir(cacheRoot, { recursive: true });

  const sessionDir = await fs.promises.mkdtemp(path.join(cacheRoot, 'render-'));
  const outputs = [];

  try {
    for (let i = 0; i < pages.length; i++) {
      const packedPage = pages[i];
      const html = buildStickerSheetPageHtml({
        pageWidthMm,
        pageHeightMm,
        cornerRadiusMm: sheet.cornerRadiusMm,
        cutMarginMm: sheet.cutMarginMm,
        packedPage,
        baseDir,
        pxPerMm,
        konvaScriptFile,
        showDebug: false,
        debug: debug && typeof debug === 'object' ? debug : {},
      });

      const htmlPath = path.resolve(sessionDir, `page-${i + 1}.html`);
      await fs.promises.writeFile(htmlPath, html, 'utf8');

      const outPath = pages.length === 1 ? baseOutputPath : withNumericSuffix(baseOutputPath, i + 1);
      const widthPx = Math.round(pageWidthMm * (Number(pxPerMm) || 12));
      const heightPx = Math.round(pageHeightMm * (Number(pxPerMm) || 12));

      const args = [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--window-size=${widthPx},${heightPx}`,
        '--allow-file-access-from-files',
        '--disable-web-security',
        '--no-sandbox',
        '--run-all-compositor-stages-before-draw',
        '--virtual-time-budget=15000',
        `--screenshot=${outPath}`,
        pathToFileURL(htmlPath).toString(),
      ];

      await runChromeHeadless({ args, cwd: sessionDir });
      outputs.push(outPath);
    }
  } finally {
    // Best-effort cleanup; keep on failure for debugging.
    if (process.env.KEEP_RENDER_CACHE !== '1') {
      try {
        await fs.promises.rm(sessionDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  return {
    outputs,
    sheet: {
      pageWidthMm,
      pageHeightMm,
      orientation: sheet.orientation,
      columns: Number(sheet.columns) || 1,
      pages: pages.length,
      stickers: Array.isArray(config.stickers) ? config.stickers.length : 0,
      pxPerMm: clampInt(pxPerMm, { min: 1, max: 200 }),
    },
  };
}

module.exports = {
  renderStickerSheetPng,
};
