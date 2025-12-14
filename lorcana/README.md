## Lorcana Proxy CLI

Creates printable Lorcana deck proxies directly from a deck list. The tool reads the provided list, looks cards up in `allCards.json`, downloads the full-art images into a cache, and lays them out on A4 pages as a centered grid with thin black padding between cards. The very first slot in the grid is now a custom showcase proxy that crops the rarest card’s illustration, fills the entire card with that art, overlays the official Disney Lorcana logo, and renders a styled title block with your deck name, author, archetype, and date. Every sheet has a black background, dense cut marks on every card edge (no more slicing through bleed), horizontal millimetre rulers across the top and bottom edges for scale checks, and a footer that displays the deck name plus the page number.

### Prerequisites

- Node.js 18+ (tested with Node 24)
- `allCards.json` in the project root (already provided)

### Install

```bash
npm install
```

### Usage

```bash
# deck.txt contains lines like "4 Ariel - Spectacular Singer"
npx lorcana-proxy --input deck.txt \
  --name "JDRR Blurple" \
  --author "Luca Pereiro" \
  --archetype "Amethyst Sapphire Ramp" \
  --date "November 2025"
```

To iterate on just the showcase title card, add `--showcase-output` and `--showcase-only` to render a standalone PNG you can refresh quickly:

```bash
npx lorcana-proxy --input deck.txt \
  --name "JDRR Blurple" \
  --author "Luca Pereiro" \
  --archetype "Amethyst Sapphire Ramp" \
  --date "November 2025" \
  --showcase-output title-card.png \
  --showcase-only
```

You can also pipe a list through stdin:

```bash
cat deck.txt | npx lorcana-proxy --name "My Deck"
```

The first run downloads each needed card once and stores it under `.cache/card-art/`. Subsequent runs reuse the cached files.

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--allcards <file>` | `allCards.json` | Location of the master card database. |
| `--input <file>` | _stdin_ | Deck list file. If omitted, read from stdin. |
| `--cache-dir <dir>` | `.cache/card-art` | Where full art images are cached. |
| `--grid-size <n>` | `3` | Grid dimension (NxN). |
| `--card-width-mm <mm>` | `63.5` | Physical card width. |
| `--card-height-mm <mm>` | `88.9` | Physical card height. |
| `--cut-mark-length-mm <mm>` | `5` | Length of the edge cut marks. |
| `--name <text>` | `deck` | Deck name printed on every page footer and on the showcase title block; also sets the PDF file path (`--name report` → `report.pdf`). |
| `--author <text>` | _(empty)_ | Deck author displayed beneath the title on the showcase card. |
| `--archetype <text>` | _(empty)_ | Archetype tag printed on the showcase title block. |
| `--date <text>` | _(empty)_ | Date/event label shown on the showcase title block. |
| `--showcase-output <file>` | _(empty)_ | Path to save the showcase title card PNG. |
| `--showcase-only` | `false` | Only render the showcase title card (requires `--showcase-output`). |

The default 3×3 grid mirrors classic proxy sheets with true-size cards and 1 mm of blackout padding between each proxy. If you’d like more cards per page (up to the extreme 9×9 limit), pass a larger `--grid-size`. The CLI keeps real card dimensions until the requested grid (plus padding) would overflow the physical page, then warns you and scales uniformly to keep everything centered. Use `--name` to choose both the exported filename (`<name>.pdf`) and the footer text automatically—the same name feeds the rarest-card showcase slot, which can optionally include the author, archetype, and date lines. Need to rapidly iterate on that hero card? Add `--showcase-output hero.png` to dump the styled PNG alongside the PDF, or tack on `--showcase-only` to skip the sheet entirely while you tweak metadata.

Deck lists allow inline comments starting with `#` or `//`, plus block comments wrapped in `/* ... */`.

### Showcase slot

- Finds the rarest card in the list using Lorcana rarity tiers.
- Crops the official full art tightly to the illustration window (same crop ratios every run).
- Fits that art to a full-size proxy card, overlays the official Disney Lorcana logo in the upper corner, and renders a metallic gradient title block with your deck name plus any author/archetype/date supplied.
- Auto-sizes the text so long titles, authors, archetypes, or dates stay inside the ribbon without overlapping.
- Inserts the resulting card as the very first position in the grid so it prints at the same size as the rest of your deck.

### Example deck

The `sample-deck.txt` file mirrors the request you shared. Running the CLI against it will build `deck.pdf` with all of those cards in the correct order.
