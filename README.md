## Lorcana Proxy CLI

Creates printable Lorcana deck proxies directly from a deck list. The tool reads the provided list, looks cards up in `allCards.json`, downloads the full-art images into a cache, and lays them out on A4 pages as a centered grid with thin black padding between cards. The very first slot in the grid is now a custom showcase proxy that crops the rarest card’s illustration, fills the entire card with that art, overlays the official Disney Lorcana logo, and prints your label in a gold ribbon. Every sheet has a black background, dense cut marks on every card edge (no more slicing through bleed), horizontal millimetre rulers across the top and bottom edges for scale checks, and a footer that displays the PDF label plus the page number.

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
npx lorcana-proxy --input deck.txt --label "My Deck"
```

You can also pipe a list through stdin:

```bash
cat deck.txt | npx lorcana-proxy --label "My Deck"
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
| `--label <text>` | `deck` | Text printed on every page footer and on the showcase slot; also sets the PDF file path (`--label report` → `report.pdf`). |

The default 3×3 grid mirrors classic proxy sheets with true-size cards and 1 mm of blackout padding between each proxy. If you’d like more cards per page (up to the extreme 9×9 limit), pass a larger `--grid-size`. The CLI keeps real card dimensions until the requested grid (plus padding) would overflow the physical page, then warns you and scales uniformly to keep everything centered. Use `--label` to choose both the exported filename (`<label>.pdf`) and the footer text automatically—the same label is also overlaid on the rarest-card showcase slot.

### Showcase slot

- Finds the rarest card in the list using Lorcana rarity tiers.
- Crops the official full art tightly to the illustration window (same crop ratios every run).
- Fits that art to a full-size proxy card, overlays the official Disney Lorcana logo in the upper corner, and places your label in a metallic ribbon near the bottom.
- Inserts the resulting card as the very first position in the grid so it prints at the same size as the rest of your deck.

### Example deck

The `sample-deck.txt` file mirrors the request you shared. Running the CLI against it will build `deck.pdf` with all of those cards in the correct order.
