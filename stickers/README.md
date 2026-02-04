# Deckbox Stickers

Generic tools for editing and printing deck-box stickers.

## Sticker sheet UI

- `node src/sticker-sheet-ui-cli.js`
- `node src/sticker-sheet-ui-cli.js --yaml path/to/sticker-sheet.yaml`

## Sticker sheet PDF (YAML)

- `node src/sticker-sheet-template-cli.js > stickers.yaml`
- `node src/sticker-sheet-cli.js --input stickers.yaml --output stickers.pdf`

## Sticker sheet PNG (YAML)

- `node src/sticker-sheet-cli.js --input stickers.yaml --output stickers.png`
- Optional resolution: `node src/sticker-sheet-cli.js --input stickers.yaml --output stickers.png --px-per-mm 12`

## YAML notes

- `sheet.stickerWidthMm` is shared by all stickers.
- `sheet.topStickerHeightMm` / `sheet.frontStickerHeightMm` control heights for `stickers[].kind: top|front`.
- `sheet.cutMarginMm` insets the printed sticker inside the cut grid (default: `1`). Set `0` to cut exactly on the sticker border.
- Optional top text overlays: `stickers[].textOverlays` entries support `text`, `xMm`, `yMm`, `background`, `color`, `font` (standard PDF font names like `Helvetica-Bold`) and/or `fontPath` (TTF/OTF).
  - For convenience, `font` may also be set to a `.ttf`/`.otf` path (it will be treated as `fontPath`).

Example:

```yaml
stickers:
  - name: magneto
    kind: top
    textOverlays:
      - text: Magneto
        xMm: 42
        yMm: 3
        font: Helvetica-Bold
        fontSizeMm: 3.6
        color: "#000000"
        background: "#ffffff"
        paddingMm: 1
        align: left
```
