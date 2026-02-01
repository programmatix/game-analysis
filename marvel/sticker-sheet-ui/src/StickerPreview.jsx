import React, { useMemo } from 'react';
import { Stage, Layer, Group, Rect, Line, Image as KonvaImage } from 'react-konva';
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

function rgbToHex(r, g, b) {
  const clamp = n => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
  const to2 = n => clamp(n).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export default function StickerPreview({
  sheet,
  debug,
  showDebug,
  sticker,
  basePath,
  pickingColor,
  onArtMove,
  onLogoMove,
  onPickColor,
}) {
  const stickerW = Number(sheet?.stickerWidthMm) || 70;
  const stickerH = Number(sheet?.stickerHeightMm) || 25;
  const cornerRadiusMm = Number(sheet?.cornerRadiusMm) || 2;

  const artUrl = sticker?.art ? fileUrlForPath(sticker.art, { basePath }) : '';
  const logoUrl = sticker?.logo ? fileUrlForPath(sticker.logo, { basePath }) : '';

  const [artImg] = useImage(artUrl, 'anonymous');
  const [logoImg] = useImage(logoUrl, 'anonymous');

  const pxPerMm = 12;
  const stageW = stickerW * pxPerMm;
  const stageH = stickerH * pxPerMm;

  const artRect = useMemo(() => {
    if (!artImg) return null;
    return computeCoverRectMm(
      artImg.naturalWidth,
      artImg.naturalHeight,
      stickerW,
      stickerH,
      sticker.artScale,
      sticker.artOffsetXMm,
      sticker.artOffsetYMm,
    );
  }, [artImg, stickerW, stickerH, sticker.artScale, sticker.artOffsetXMm, sticker.artOffsetYMm]);

  const baseArtRect = useMemo(() => {
    if (!artImg) return null;
    return computeCoverRectMm(artImg.naturalWidth, artImg.naturalHeight, stickerW, stickerH, sticker.artScale, 0, 0);
  }, [artImg, stickerW, stickerH, sticker.artScale]);

  const paddingMm = 1.2;
  const safeRect = { x: paddingMm, y: paddingMm, width: stickerW - paddingMm * 2, height: stickerH - paddingMm * 2 };
  const logoAreaWidthMm = Math.min(safeRect.width * 0.45, (Number(sticker.logoMaxWidthMm) || 28) + 6);
  const logoArea = { x: safeRect.x, y: safeRect.y, width: logoAreaWidthMm, height: safeRect.height };
  const logoScale = Math.max(0.1, Number(sticker.logoScale) || 1);
  const logoTarget = {
    x: logoArea.x + (Number(sticker.logoOffsetXMm) || 0),
    y: logoArea.y + (Number(sticker.logoOffsetYMm) || 0),
    width: Math.min((Number(sticker.logoMaxWidthMm) || 28) * logoScale, logoArea.width),
    height: Math.min((Number(sticker.logoMaxHeightMm) || 18) * logoScale, logoArea.height),
  };

  const baseLogoTarget = { ...logoTarget, x: logoArea.x, y: logoArea.y };

  const logoContain = useMemo(() => {
    if (!logoImg) return null;
    return computeContainRectMm(logoImg.naturalWidth, logoImg.naturalHeight, logoTarget.width, logoTarget.height);
  }, [logoImg, logoTarget.width, logoTarget.height]);

  const gradientWidthMm = Math.max(0, Math.min(Number(sticker.gradientWidthMm) || 0, stickerW));
  const gradientSolidMm = Math.max(0, Math.min(20, gradientWidthMm));
  const gradientFadeMm = Math.max(0, gradientWidthMm - gradientSolidMm);
  const x1 = Number(debug?.leftMm) || 10;
  const x2 = stickerW - (Number(debug?.rightFromRightMm) || 40);
  const yMid = stickerH / 2;

  function handleStagePointerDown(e) {
    if (!pickingColor) return;
    if (!artImg || !artRect) return;
    const stage = e.target?.getStage?.();
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;

    const xMm = pos.x / pxPerMm;
    const yMm = pos.y / pxPerMm;
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
    <Stage width={stageW} height={stageH} onPointerDown={handleStagePointerDown}>
      <Layer>
        <Group scaleX={pxPerMm} scaleY={pxPerMm}>
          <Group
            clipFunc={ctx => clipRoundedRect(ctx, 0, 0, stickerW, stickerH, cornerRadiusMm)}
          >
            <Rect x={0} y={0} width={stickerW} height={stickerH} fill={sticker.gradient || '#f7d117'} />
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
            {gradientWidthMm > 0 ? (
              <>
                {gradientSolidMm > 0 ? (
                  <Rect x={0} y={0} width={gradientSolidMm} height={stickerH} fill={rgba(sticker.gradient, 1)} listening={false} />
                ) : null}
                {gradientFadeMm > 0 ? (
                  <Rect
                    x={gradientSolidMm}
                    y={0}
                    width={gradientFadeMm}
                    height={stickerH}
                    fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                    fillLinearGradientEndPoint={{ x: gradientFadeMm, y: 0 }}
                    fillLinearGradientColorStops={[0, rgba(sticker.gradient, 1), 1, rgba(sticker.gradient, 0)]}
                    listening={false}
                  />
                ) : null}
              </>
            ) : null}
          </Group>

          {logoImg && logoContain ? (
            <Group
              x={logoTarget.x}
              y={logoTarget.y}
              draggable
              onDragEnd={e => {
                const node = e.target;
                onLogoMove?.({
                  logoOffsetXMm: node.x() - baseLogoTarget.x,
                  logoOffsetYMm: node.y() - baseLogoTarget.y,
                });
              }}
            >
              <Rect x={0} y={0} width={logoTarget.width} height={logoTarget.height} fill="rgba(0,0,0,0.01)" />
              <KonvaImage image={logoImg} x={logoContain.x} y={logoContain.y} width={logoContain.width} height={logoContain.height} opacity={0.98} listening={false} />
            </Group>
          ) : null}

          <Rect x={0} y={0} width={stickerW} height={stickerH} cornerRadius={cornerRadiusMm} stroke="rgba(0,0,0,0.5)" strokeWidth={0.15} listening={false} />

          {showDebug ? (
            <>
              <Line points={[x1, 0, x1, stickerH]} stroke="red" strokeWidth={0.2} listening={false} />
              <Line points={[x2, 0, x2, stickerH]} stroke="red" strokeWidth={0.2} listening={false} />
              {debug?.centerHorizontal !== false ? <Line points={[0, yMid, stickerW, yMid]} stroke="red" strokeWidth={0.2} listening={false} /> : null}
            </>
          ) : null}
        </Group>
      </Layer>
    </Stage>
  );
}
