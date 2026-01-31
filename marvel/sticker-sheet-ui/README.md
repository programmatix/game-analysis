# Sticker Sheet UI (Marvel)

Interactive editor for `marvel-sticker-sheet` YAML configs.

## Run

From `marvel/`:

- `node src/sticker-sheet-ui-cli.js`
- `node src/sticker-sheet-ui-cli.js --yaml path/to/sticker-sheet.yaml`

## Notes

- Drag the art to reposition it (writes `artOffsetXMm` / `artOffsetYMm`).
- Use the zoom slider to change `artScale`.
- Drag the logo to shift it (writes `defaults.logoOffsetXMm` / `defaults.logoOffsetYMm`).
- Use the color picker / dropper to set `defaults.gradient` (renamed from `yellow`).

