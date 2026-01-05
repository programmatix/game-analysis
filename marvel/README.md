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
- `--skip-core` skips cards whose `pack_code` is `core` (useful if you own only the Core Set).
- Use `[skipproxy]` or `[skipback]` on a line to omit that card or its back.

### Deck annotator

Adds inline comments (prefixed with `//?`) with type/aspect, cost, stats, traits, and rules text for each card. Re-running replaces any previous `//?` annotations:
Annotations start with pack tags like `[core]` based on the card's `pack_code` (if a card appears in multiple packs and one is `core`, only `[core]` is shown).

```bash
npx marvel-annotate --input decks/sample-deck.txt
```

Omit `--output` to overwrite `--input`; when reading from stdin, output is written to stdout.

### Deck parser (resolver)

Resolves a deck list against MarvelCDB and emits a normalized list with explicit codes:

```bash
npx marvel-parse --input decks/sample-deck.txt --output decks/sample-deck-resolved.txt
```

### Deck analyzer

Print deck totals, ally count, aspect/basic breakdown, and an ASCII cost curve:

```bash
npx marvel-analyze --input decks/sample-deck.txt
```

### Card search

Search the cached MarvelCDB database by name/rules text and print matching cards:

```bash
npx marvel-search spider man
npx marvel-search --type ally --aspect justice --annotate
npx marvel-search --type ally --aspect justice --cost 2- --annotate
```

Supported `--type` codes: `ally`, `alter_ego`, `attachment`, `environment`, `event`, `hero`, `minion`, `obligation`, `player_side_scheme`, `resource`, `side_scheme`, `support`, `treachery`, `upgrade`.

### Pack deck lists

Generate a deck list containing all cards from a given Marvel Champions pack (useful for proxying a hero/scenario pack):

```bash
npx marvel-pack --list-packs
npx marvel-pack core --kind hero
npx marvel-pack "Green Goblin" --kind scenario
```
