## Marvel Champions CLI

Tools to parse Marvel Champions deck lists, annotate them with per-card notes, and create printable proxy PDFs. Card metadata comes from the public MarvelCDB API (including encounter/scenario cards); card images prefer Merlin’s mirror when available and are cached locally.

## Decklist format

Each card line can be:

```
2 Backflip
2x Energy
1 Spider-Man[01001a]
1 Heroic Rescue[All]
[include:some-other-list]
[proxypagebreak]
```

Comments are supported with `#`, `//`, and `/* ... */`.

MarvelCDB text exports often append pack/position in parentheses (e.g. `Backflip (core, 3)`); Marvel tools strip trailing parentheticals that contain digits so those names still resolve.

Use `[All]` to expand ambiguous card names into every matching candidate (useful when the same card name exists in multiple printings/sets).

### Proxy deck generator

```bash
npx marvel-proxy --input decks/sample-deck.txt --name "Spidey Sample"
```

Useful flags:

- `--cache-dir` controls where images download (default: `.cache/marvel-card-art`).
- `--data-cache` controls where the MarvelCDB card JSON is stored (default: `.cache/marvelcdb-cards.json`).
- `--face a|b` controls the default face for numeric codes like `[01001]` (default: `a`).
- `--include-backs` adds a second page of backs for double-sided cards and flips each row for duplex alignment.
- `--skip-core` skips cards whose `pack_code` is `core` (useful if you own only the Core Set).
- Use `[skipproxy]` or `[skipback]` on a line to omit that card or its back (the latter only matters with `--include-backs`).
- Proxy PDFs include a 2mm black bleed beyond the cut marks.

### Deck annotator

Adds inline comments (prefixed with `//?`) with type/aspect, cost, stats, traits, and rules text for each card. Re-running replaces any previous `//?` annotations:
Annotations start with pack tags like `[core]` based on the card's `pack_code` (if a card appears in multiple packs and one is `core`, only `[core]` is shown).

```bash
npx marvel-annotate --input decks/sample-deck.txt
```

Omit `--output` to overwrite `--input`; when reading from stdin, output is written to stdout.

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

Supported `--type` codes: `ally`, `alter_ego`, `attachment`, `environment`, `event`, `evidence_means`, `evidence_motive`, `evidence_opportunity`, `hero`, `leader`, `main_scheme`, `minion`, `obligation`, `player_side_scheme`, `resource`, `side_scheme`, `support`, `treachery`, `upgrade`, `villain`.

### Download decklists from MarvelCDB

Download a published decklist (by id or URL) and emit a normalized list in this repo’s deck format (one card per line, with `[code]` tags). The hero + linked alter-ego are included as `[ignoreForDeckLimit]` entries:

```bash
npx marvel-download 40979 | npx marvel-proxy
```

By default, this also appends the hero’s encounter cards (obligation + nemesis set). Use `--no-hero-encounter` to disable.

To output *only* the hero’s encounter cards (for printing just the “bad” stuff):

```bash
npx marvel-download 40979 --only-hero-encounter | npx marvel-proxy
```

### Pack deck lists

Generate a deck list containing all cards from a given Marvel Champions pack (useful for proxying a hero/scenario pack):

```bash
npx marvel-pack --list-packs
npx marvel-pack bkw --hero-specific > ../../game-decks/marvel/packs/cycle1/bkw.txt
```

`--kind auto` (the default) outputs:
- `hero` when a pack only has player cards
- `scenario` when a pack only has encounter cards
- `all` when a pack contains both

To output a specific encounter/module set within a pack:

```bash
npx marvel-pack "NeXt Evolution" --list-sets
npx marvel-pack next_evol --kind scenario --set juggernaut
```

When `--kind scenario` is used with a villain set (e.g. `--set magneto_villain`), `marvel-pack` also includes that villain’s recommended modular set by default. Use `--no-recommended-modular` to disable.

Some double-sided cards exist in the data as both `[12345]` and `[12345a]/[12345b]`; `marvel-pack` drops the base `[12345]` form and keeps the `a`/`b` forms to avoid listing the same physical card multiple times.
