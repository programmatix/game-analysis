# Deckbox Stickers

Generic tools for editing and printing deck-box stickers.

## Sticker sheet UI

- `node src/sticker-sheet-ui-cli.js`
- `node src/sticker-sheet-ui-cli.js --yaml path/to/sticker-sheet.yaml`

## Sticker sheet PDF (YAML)

- `node src/sticker-sheet-template-cli.js > stickers.yaml`
- `node src/sticker-sheet-cli.js --input stickers.yaml --output stickers.pdf`

## YAML notes

- `sheet.stickerWidthMm` is shared by all stickers.
- `sheet.topStickerHeightMm` / `sheet.frontStickerHeightMm` control heights for `stickers[].kind: top|front`.
- Optional top text overlays: `stickers[].textOverlays` entries support `text`, `xMm`, `yMm`, `background`, `color`, `font` (standard PDF font names like `Helvetica-Bold`) and/or `fontPath` (TTF/OTF).
