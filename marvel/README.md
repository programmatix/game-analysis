## Marvel Champions CLI

Tools to parse Marvel Champions deck lists, annotate them with per-card notes, and create printable proxy PDFs. Card metadata and images come from the public MarvelCDB API and are cached locally.

### Setup

- Requires Node.js 18+ (tested with Node 24).
- From this folder run `npm install` to pull dependencies.

The first run of any command downloads the MarvelCDB card list into `.cache/marvelcdb-cards.json`. Re-run with `--refresh-data` to update it.

## Decklist format

Each card line can be:

```
2 Backflip
2x Energy
1 Spider-Man[01001a]
[include:some-other-list]
[proxypagebreak]
```

Comments are supported with `#`, `//`, and `/* ... */`.

MarvelCDB text exports often append pack/position in parentheses (e.g. `Backflip (core, 3)`); Marvel tools strip trailing parentheticals that contain digits so those names still resolve.

### Proxy deck generator

```bash
npx marvel-proxy --input decks/sample-deck.txt --name "Spidey Sample"
```

Useful flags:

- `--cache-dir` controls where images download (default: `.cache/marvel-card-art`).
- `--data-cache` controls where the MarvelCDB card JSON is stored (default: `.cache/marvelcdb-cards.json`).
- `--face a|b` controls the default face for numeric codes like `[01001]` (default: `a`).
- Use `[skipproxy]` or `[skipback]` on a line to omit that card or its back.

### Deck annotator

Adds inline comments (prefixed with `//?`) with type/aspect, cost, stats, traits, and rules text for each card. Re-running replaces any previous `//?` annotations:

```bash
npx marvel-annotate --input decks/sample-deck.txt --output decks/sample-deck-annotated.txt
```

### Deck parser (resolver)

Resolves a deck list against MarvelCDB and emits a normalized list with explicit codes:

```bash
npx marvel-parse --input decks/sample-deck.txt --output decks/sample-deck-resolved.txt
```

