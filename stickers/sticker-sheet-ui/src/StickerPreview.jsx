import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Line, Text as KonvaText, Image as KonvaImage } from 'react-konva';
import useImage from 'use-image';
import { fileUrlForPath } from './api.js';

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

function rgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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

function computeContainRectMm(imgW, imgH, targetW, targetH) {
  if (!imgW || !imgH) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = Math.min(targetW / imgW, targetH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  const x = (targetW - width) / 2;
  const y = (targetH - height) / 2;
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

function rgbToHex(r, g, b) {
  const clamp = n => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
  const to2 = n => clamp(n).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function looksLikeFontFilePath(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return false;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = raw.slice(dot).toLowerCase();
  return ['.ttf', '.otf', '.woff', '.woff2'].includes(ext);
}

function fontFormatForPath(fontPath) {
  const raw = typeof fontPath === 'string' ? fontPath.trim() : '';
  const dot = raw.lastIndexOf('.');
  const ext = dot >= 0 ? raw.slice(dot).toLowerCase() : '';
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

function hashStringToHex(input) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const str = String(input || '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export default function StickerPreview({
  widthMm,
  heightMm,
  cornerRadiusMm,
  cutMarginMm,
  debug,
  showDebug,
  sticker,
  kind,
  basePath,
  pickingColor,
  onArtMove,
  onLogoMove,
  onPickColor,
}) {
  const stageRef = useRef(null);
  const [fontVersion, setFontVersion] = useState(0);
  const stickerW = Number(widthMm) || 70;
  const stickerH = Number(heightMm) || 25;
  const radiusMm = Number(cornerRadiusMm) || 2;
  const cutMm = Math.max(0, Number(cutMarginMm) || 0);
  const contentW = Math.max(0, stickerW - cutMm * 2);
  const contentH = Math.max(0, stickerH - cutMm * 2);
  const contentRadiusMm = Math.max(0, radiusMm - cutMm);
  const stickerKind = String(kind || sticker?.kind || 'top').trim().toLowerCase() || 'top';

  const artUrl = sticker?.art ? fileUrlForPath(sticker.art, { basePath }) : '';
  const logoUrl = sticker?.logo ? fileUrlForPath(sticker.logo, { basePath }) : '';

  const [artImg] = useImage(artUrl, 'anonymous');
  const [logoImg] = useImage(logoUrl, 'anonymous');

  const { fontCss, overlayFontFamilyByIndex, fontFamilyKey } = useMemo(() => {
    const overlays = Array.isArray(sticker?.textOverlays) ? sticker.textOverlays : [];
    const faces = new Map();
    const overlayFamilies = [];

    for (let i = 0; i < overlays.length; i++) {
      const overlay = overlays[i] && typeof overlays[i] === 'object' ? overlays[i] : {};
      const explicit = typeof overlay.fontPath === 'string' ? overlay.fontPath.trim() : '';
      const implicit = !explicit && looksLikeFontFilePath(overlay.font) ? String(overlay.font || '').trim() : '';
      const fontPath = explicit || implicit;
      if (!fontPath) {
        overlayFamilies[i] = '';
        continue;
      }

      const key = `${basePath || ''}::${fontPath}`;
      const existing = faces.get(key);
      if (existing) {
        overlayFamilies[i] = existing.family;
        continue;
      }

      const family = `DeckboxFont_${hashStringToHex(key)}`;
      const url = fileUrlForPath(fontPath, { basePath });
      const format = fontFormatForPath(fontPath);
      faces.set(key, { family, url, format });
      overlayFamilies[i] = family;
    }

    const css = Array.from(faces.values()).map(ff => {
      const src = ff.format ? `url("${ff.url}") format("${ff.format}")` : `url("${ff.url}")`;
      return `@font-face { font-family: "${ff.family}"; src: ${src}; font-display: block; }`;
    }).join('\n');

    const familyKey = Array.from(faces.values()).map(f => f.family).sort().join('|');
    return { fontCss: css, overlayFontFamilyByIndex: overlayFamilies, fontFamilyKey: familyKey };
  }, [sticker?.textOverlays, basePath]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!fontFamilyKey) return;
      if (!document.fonts || typeof document.fonts.load !== 'function') return;
      const families = fontFamilyKey.split('|').filter(Boolean);
      await Promise.all(families.map(family => document.fonts.load(`16px "${family}"`).catch(() => null)));
      if (cancelled) return;
      setFontVersion(v => v + 1);
      stageRef.current?.batchDraw?.();
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [fontFamilyKey]);

  const pxPerMm = 12;
  const stageW = stickerW * pxPerMm;
  const stageH = stickerH * pxPerMm;

  const artRect = useMemo(() => {
    if (!artImg) return null;
    return computeCoverRectMm(
      artImg.naturalWidth,
      artImg.naturalHeight,
      contentW,
      contentH,
      sticker.artScale,
      sticker.artOffsetXMm,
      sticker.artOffsetYMm,
    );
  }, [artImg, contentW, contentH, sticker.artScale, sticker.artOffsetXMm, sticker.artOffsetYMm]);

  const baseArtRect = useMemo(() => {
    if (!artImg) return null;
    return computeCoverRectMm(artImg.naturalWidth, artImg.naturalHeight, contentW, contentH, sticker.artScale, 0, 0);
  }, [artImg, contentW, contentH, sticker.artScale]);

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

  const baseLogoBox = { ...logoBox, x: logoArea.x, y: logoArea.y };
  const logoScale = Math.max(0.1, Number(sticker.logoScale) || 1);

  const logoContain = useMemo(() => {
    if (!logoImg) return null;
    return computeContainRectMmScaled(logoImg.naturalWidth, logoImg.naturalHeight, logoBox.width, logoBox.height, logoScale, 0, 0);
  }, [logoImg, logoBox.width, logoBox.height, logoScale]);

  const gradientWidthMm = Math.max(0, Math.min(Number(sticker.gradientWidthMm) || 0, contentW));
  const gradientSolidMm = Math.max(0, Math.min(20, gradientWidthMm));
  const gradientFadeMm = Math.max(0, gradientWidthMm - gradientSolidMm);
  const x1 = Number(debug?.leftMm) || 10;
  const x2 = contentW - (Number(debug?.rightFromRightMm) || 40);
  const yMid = contentH / 2;
  const logoGuideOffsetMm = 5;
  const yGuideTop = logoGuideOffsetMm;
  const yGuideBottom = Math.max(0, contentH - logoGuideOffsetMm);

  function handleStagePointerDown(e) {
    if (!pickingColor) return;
    if (stickerKind !== 'top') return;
    if (!artImg || !artRect) return;
    const stage = e.target?.getStage?.();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const xMm = pos.x / pxPerMm - cutMm;
    const yMm = pos.y / pxPerMm - cutMm;
    const insideArt = xMm >= artRect.x && xMm <= artRect.x + artRect.width && yMm >= artRect.y && yMm <= artRect.y + artRect.height;
    if (!insideArt) return;

    const u = (xMm - artRect.x) / artRect.width;
    const v = (yMm - artRect.y) / artRect.height;
    const px = Math.floor(u * artImg.naturalWidth);
    const py = Math.floor(v * artImg.naturalHeight);
    if (px < 0 || py < 0 || px >= artImg.naturalWidth || py >= artImg.naturalHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = artImg.naturalWidth;
    canvas.height = artImg.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(artImg, 0, 0);
    const data = ctx.getImageData(px, py, 1, 1).data;
    onPickColor?.(rgbToHex(data[0], data[1], data[2]));
  }

  return (
    <>
      {fontCss ? <style>{fontCss}</style> : null}
      <Stage ref={stageRef} width={stageW} height={stageH} onPointerDown={handleStagePointerDown}>
      <Layer>
        <Group scaleX={pxPerMm} scaleY={pxPerMm}>
          <Group x={cutMm} y={cutMm}>
            <Group clipFunc={ctx => clipRoundedRect(ctx, 0, 0, contentW, contentH, contentRadiusMm)}>
              <Rect x={0} y={0} width={contentW} height={contentH} fill={stickerKind === 'top' ? (sticker.gradient || '#f7d117') : '#ffffff'} />
              {artImg && artRect ? (
                <KonvaImage
                  image={artImg}
                  x={artRect.x}
                  y={artRect.y}
                  width={artRect.width}
                  height={artRect.height}
                  draggable
                  onDragEnd={e => {
                    if (!baseArtRect) return;
                    const node = e.target;
                    onArtMove?.({
                      artOffsetXMm: node.x() - baseArtRect.x,
                      artOffsetYMm: node.y() - baseArtRect.y,
                    });
                  }}
                />
              ) : null}
              {stickerKind === 'top' && gradientWidthMm > 0 ? (
                <>
                  {gradientSolidMm > 0 ? (
                    <Rect x={0} y={0} width={gradientSolidMm} height={contentH} fill={rgba(sticker.gradient, 1)} listening={false} />
                  ) : null}
                  {gradientFadeMm > 0 ? (
                    <Rect
                      x={gradientSolidMm}
                      y={0}
                      width={gradientFadeMm}
                      height={contentH}
                      fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                      fillLinearGradientEndPoint={{ x: gradientFadeMm, y: 0 }}
                      fillLinearGradientColorStops={[0, rgba(sticker.gradient, 1), 1, rgba(sticker.gradient, 0)]}
                      listening={false}
                    />
                  ) : null}
                </>
              ) : null}

              {logoImg && logoContain ? (
                <Group
                  x={logoBox.x}
                  y={logoBox.y}
                  draggable
                  onDragEnd={e => {
                    const node = e.target;
                    onLogoMove?.({
                      logoOffsetXMm: node.x() - baseLogoBox.x,
                      logoOffsetYMm: node.y() - baseLogoBox.y,
                    });
                  }}
                >
                  <Rect x={0} y={0} width={logoBox.width} height={logoBox.height} fill="rgba(0,0,0,0.01)" />
                  <KonvaImage image={logoImg} x={logoContain.x} y={logoContain.y} width={logoContain.width} height={logoContain.height} opacity={0.98} listening={false} />
                </Group>
              ) : null}
            </Group>

            {stickerKind === 'top'
              ? (Array.isArray(sticker?.textOverlays) ? sticker.textOverlays : []).map((overlay, idx) => {
                  const text = String(overlay?.text || '');
                  if (!text) return null;
                  const xMm = Number(overlay?.xMm) || 0;
                  const yMm = Number(overlay?.yMm) || 0;
                  const fontSizeMm = Math.max(0.1, Number(overlay?.fontSizeMm) || 3.6);
                  const paddingMm = Math.max(0, Number(overlay?.paddingMm) || 1);
                  const widthGuess = Math.max(5, text.length * fontSizeMm * 0.55 + paddingMm * 2);
                  const heightGuess = Math.max(2, fontSizeMm * 1.2 + paddingMm * 2);
                  const bg = typeof overlay?.background === 'string' ? overlay.background : (typeof overlay?.backgroundColor === 'string' ? overlay.backgroundColor : '');
                  const fg = typeof overlay?.color === 'string' ? overlay.color : '#000000';
                  const fontFamily = overlayFontFamilyByIndex[idx]
                    || (typeof overlay?.font === 'string' && overlay.font.trim() ? overlay.font.trim() : 'Helvetica');
                  return (
                    <Group key={idx} x={xMm} y={yMm} listening={false}>
                      {bg ? <Rect x={0} y={0} width={widthGuess} height={heightGuess} fill={bg} opacity={0.92} /> : null}
                      <KonvaText
                        x={paddingMm}
                        y={paddingMm}
                        width={Math.max(0, widthGuess - paddingMm * 2)}
                        height={Math.max(0, heightGuess - paddingMm * 2)}
                        text={text}
                        fontFamily={fontFamily}
                        key={`${idx}-${fontFamily}-${fontVersion}`}
                        fontSize={fontSizeMm}
                        fill={fg}
                        verticalAlign="middle"
                      />
                    </Group>
                  );
                })
              : null}

            <Rect x={0} y={0} width={contentW} height={contentH} cornerRadius={contentRadiusMm} stroke="rgba(0,0,0,0.5)" strokeWidth={0.15} listening={false} />

            {showDebug ? (
              <>
                <Line points={[x1, 0, x1, contentH]} stroke="red" strokeWidth={0.2} listening={false} />
                <Line points={[x2, 0, x2, contentH]} stroke="red" strokeWidth={0.2} listening={false} />
                {debug?.centerHorizontal !== false ? <Line points={[0, yMid, contentW, yMid]} stroke="red" strokeWidth={0.2} listening={false} /> : null}
                <Line points={[0, yGuideTop, contentW, yGuideTop]} stroke="red" strokeWidth={0.2} listening={false} />
                <Line points={[0, yGuideBottom, contentW, yGuideBottom]} stroke="red" strokeWidth={0.2} listening={false} />
              </>
            ) : null}
          </Group>
        </Group>
      </Layer>
      </Stage>
    </>
  );
}
