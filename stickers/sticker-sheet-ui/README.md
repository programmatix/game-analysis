# Sticker Sheet UI

Interactive editor for `deckbox-sticker-sheet` YAML configs.

## Run

From `stickers/`:

- `node src/sticker-sheet-ui-cli.js`
- `node src/sticker-sheet-ui-cli.js --yaml path/to/sticker-sheet.yaml`

## Notes

- Drag the art to reposition it (writes `artOffsetXMm` / `artOffsetYMm`).
- Use the zoom slider to change `artScale`.
- Drag the logo to shift it (writes `logoOffsetXMm` / `logoOffsetYMm`).
- Use the color picker / dropper to set `gradient` on the selected top sticker (legacy `yellow` is still accepted by the CLI).
- Stickers are grouped by character `name` and can have one or both of `kind: top|front`.
