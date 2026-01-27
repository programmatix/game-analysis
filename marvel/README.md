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
- `--corner-radius-mm` controls the rounded-corner clip radius (default: `3.2`).
- `--face a|b` controls the default face for numeric codes like `[01001]` (default: `a`).
- `--include-backs` adds a second page of backs for double-sided cards and flips each row for duplex alignment.
- `--skip-core` skips cards whose `pack_code` is `core` (useful if you own only the Core Set).
- Use `[skipproxy]` or `[skipback]` on a line to omit that card or its back (the latter only matters with `--include-backs`).
- Proxy PDFs include a 2mm black bleed beyond the cut marks.

### Tuckbox generator

Generate a tuckbox net from explicit internal box dimensions. The default output is a 2-page PDF intended for duplex printing: outside art on page 1, and all cut/fold marks + ZA/L# labels on page 2.

```bash
npx marvel-tuckbox --hero "Cyclops" --text "Leadership\\nAggression" --inner-depth-mm 32 --output cyclops-tuckbox.pdf
```

Useful flags:

- `--art` sets front/top art (default: `assets/cyclops/image.png`).
- `--front-art-offset-x-mm/--front-art-offset-y-mm` adjusts front art cropping.
- `--top-art-offset-x-mm/--top-art-offset-y-mm` adjusts top art cropping.
- `--logo` sets the Marvel Champions logo image (default: `assets/logo.png`); use `--no-logo` to disable.
- `--back` sets the back-panel image (default: `assets/cardback.png`).
- `--aspect justice|leadership|aggression|protection|basic|pool` sets a preset accent color (overrides `--accent`).
- Use `--no-duplex` to generate a 1-page single-sided template.
- `--page-size a4|letter` selects the paper size (use `letter` for many US printers).
- `--fonts-dir` and `--font-config` load the official Marvel Champions fonts when you have them locally (otherwise it falls back to Helvetica).
- `--orientation auto|portrait|landscape` selects A4 orientation; `auto` picks the first that fits.

### Font sheet

Generate a one-page PDF showing samples for all configured Marvel Champions fonts:

```bash
npx marvel-font-sheet --output marvel-fonts.pdf
```

`--font-config` accepts a JSON object mapping these keys to local font files (TTF/OTF): `title`, `statNumbers`, `statAbbr`, `heroAlterEgo`, `traits`, `abilityNames`, `abilityTypes`, `body`, `flavor`, `handSizeHp`, `mouseprint`.

### Download open fonts

Some fonts are free/open-licensed (for example, Exo 2). Download supported open font families into `assets/fonts/`:

```bash
npx marvel-fonts-download exo2
```

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

Search the cached MarvelCDB database by name/rules text and print matching cards (defaults to decklist-style output, so it can be piped into `marvel-proxy`):

```bash
npx marvel-search spider man
npx marvel-search --type ally --aspect justice --annotate
npx marvel-search --type ally --aspect justice --cost 2- --annotate
npx marvel-search --type event --dedupe "energy barrier"
npx marvel-search --aspect aggression --limit 0 | npx marvel-proxy
```

Use `--dedupe` to collapse reprints across packs (matches on title + cost + rules text).
By default output is grouped by type (Ally/Event/etc.) with comment headings; disable with `--no-group-by-type`.
Use `--format cards` to print a one-line-per-card detailed list instead of decklist entries.

Supported `--type` codes: `ally`, `alter_ego`, `attachment`, `environment`, `event`, `evidence_means`, `evidence_motive`, `evidence_opportunity`, `hero`, `leader`, `main_scheme`, `minion`, `obligation`, `player_side_scheme`, `resource`, `side_scheme`, `support`, `treachery`, `upgrade`, `villain`.

### Download decklists from MarvelCDB

Download a published decklist (by id or URL) and emit a normalized list in this repo’s deck format (one card per line, with `[code]` tags). The hero + linked alter-ego are included as `[ignoreForDeckLimit]` entries. Set-aside hero side decks (e.g. Storm’s Weather deck, Doctor Strange’s Invocation deck) are also included as `[ignoreForDeckLimit]`:

```bash
npx marvel-download 40979 | npx marvel-proxy
npx marvel-download 40979 --no-hero | npx marvel-proxy

```

To output *only* the hero’s encounter cards (for printing just the “bad” stuff):

```bash
npx marvel-download 40979 --only-hero-encounter | npx marvel-proxy
```

### Pack deck lists

Generate a deck list containing all cards from a given Marvel Champions pack (useful for proxying a hero/scenario pack):

```bash
npx marvel-pack --list-packs
npx marvel-pack bkw --hero-specific > ../../game-decks/marvel/packs/cycle1/bkw.txt
npx marvel-pack "NeXt Evolution" --list-sets
npx marvel-pack next_evol --kind scenario --set juggernaut
```

`--kind auto` (the default) outputs:
- `hero` when a pack only has player cards
- `scenario` when a pack only has encounter cards
- `all` when a pack contains both

When `--kind scenario` is used with a villain set (e.g. `--set magneto_villain`), `marvel-pack` also includes that villain’s recommended modular set by default. Use `--no-recommended-modular` to disable.

Some double-sided cards exist in the data as both `[12345]` and `[12345a]/[12345b]`; `marvel-pack` drops the base `[12345]` form and keeps the `a`/`b` forms to avoid listing the same physical card multiple times.
