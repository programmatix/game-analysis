## Star Wars: Unlimited CLI

Tools to parse Star Wars: Unlimited deck lists, annotate them with per-card notes, analyze them, search the card database, and create printable proxy PDFs.

Card metadata and image URLs come from `erlloyd/star-wars-unlimited-json` (cached to `swu/.cache/swu-card-db`). You can also load additional cards via `--data-file` in each CLI.

To force a fresh download of the cached database, run with `SWU_DB_REFRESH=1`.

## Install (repo)

```bash
cd swu
npm install
```

## Decklist format

Supported card line formats:

```
3 Battlefield Marine
3x TIE/ln Fighter
1 Luke Skywalker, Faithful Friend [SOR-005]
3xSOR_193
```

Set/number codes accept either `SET-###` (in brackets) or `SET_###` (as the whole card reference).

Section headers from common exports are supported:

```
Leader:
Luke Skywalker, Faithful Friend

Base:
Yavin 4

Deck:
3 Battlefield Marine
...
```

Directives are supported:

```
[include:some-other-list]
[proxypagebreak]
```

Comments are supported with `#`, `//`, and `/* ... */`.

## Proxy deck generator

```bash
npx swu-proxy --input decks/my-deck.txt --name "My SWU Deck"
```

Useful flags:

- `--cache-dir` controls where images download (default: `.cache/swu-card-art`).
- `--include-backs` adds back pages for double-sided cards (leaders) and flips each row for duplex alignment.
- Use `[skipproxy]` or `[skipback]` on a line to omit that card or its back (the latter only matters with `--include-backs`).

## Deck annotator

Adds inline comments (prefixed with `//?`) with type/aspects, arena, cost/stats, traits, and rules text for each card. Re-running replaces any previous `//?` annotations:

```bash
npx swu-annotate --input decks/my-deck.txt
```

## Deck analyzer

Print deck totals, aspect mix, type counts, an ASCII cost curve, and off-aspect penalty counts:

```bash
npx swu-analyze --input decks/my-deck.txt
```

## Card search

Search by name/rules text and filter by type/aspect/set/cost:

```bash
npx swu-search luke
npx swu-search --type unit --aspect vigilance --cost 2- --annotate
```

## Set ("pack") deck lists

Generate a deck list containing all cards from a given set code:

```bash
npx swu-pack --list-sets
npx swu-pack SOR --type leader --no-codes
```
