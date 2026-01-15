# lotr

CLI tools for The Lord of the Rings: The Card Game (LOTR LCG):

- `npx lotr-proxy -i deck.txt` → generate a printable proxy PDF
- `npx lotr-annotate -i deck.txt` → add per-card notes
- `npx lotr-analyze -i deck.txt` → deck stats (spheres/types/cost curve)
- `npx lotr-search Gandalf` → search the card database
- `npx lotr-download <ringsdb id|url>` → download a RingsDB decklist into this repo’s decklist format

Card data is fetched from RingsDB and cached under `lotr/.cache/`.

## Decklist format

- Card lines are `"<count> <name>"`, optionally with a `[code]` tag like `1 Gandalf[01073]`.
- Directives: `[include:other-file]`, `[proxypagebreak]`.
- Use `[All]` to expand ambiguous card names into every matching candidate.
