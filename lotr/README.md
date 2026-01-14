# lotr

CLI tools for The Lord of the Rings: The Card Game (LOTR LCG):

- `npx lotr-proxy -i deck.txt` → generate a printable proxy PDF
- `npx lotr-annotate -i deck.txt` → add per-card notes
- `npx lotr-analyze -i deck.txt` → deck stats (spheres/types/cost curve)
- `npx lotr-search Gandalf` → search the card database
- `npx lotr-download <ringsdb id|url>` → download a RingsDB decklist into this repo’s decklist format

Card data is fetched from RingsDB and cached under `lotr/.cache/`.

