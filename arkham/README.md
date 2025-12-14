## Arkham Proxy CLI

Create printable proxy PDFs for Arkham Horror: The Card Game. The tool reads a deck list, looks up cards in the bundled `arkhamdb-json-data`, fetches matching art from dragncards, and lays everything out on A4 with cut marks, rulers, and a footer.

### Setup

- Requires Node.js 18+ (tested with Node 24).
- From this folder run `npm install` to pull dependencies.
- Uses the local `arkhamdb-json-data/` by default; override with `--data-dir` if you want to point at another checkout.

### Usage

```bash
# deck.txt lines look like: "2 Lucky! (2)"
npx arkham-proxy --input deck.txt --name "Roland Solo"
```

Options:

- `--input <file>`: Deck list to read; if omitted, reads from stdin.
- `--name <text>`: Deck name for the PDF filename/footer (`deck` → `deck.pdf`).
- `--data-dir <dir>`: Path to `arkhamdb-json-data` (defaults to the copy in this repo).
- `--cache-dir <dir>`: Cache directory for downloaded art (default `.cache/arkham-card-art`).
- `--grid-size <n>`: NxN grid per page (default `3`).
- `--card-width-mm` / `--card-height-mm`: Physical card size in millimetres.
- `--cut-mark-length-mm`: Length of edge cut marks.
- `--face <a|b>`: Which face to use when a code lacks an explicit side (defaults to `a`).

Deck lines support comments starting with `#` or `//`. Ambiguous names (like cards with multiple XP versions) can be disambiguated with a code (`01030`) or an XP suffix (`Lucky! (2)`).

## Decklist format

```
2 knife
1 sophie[03009]
[include:partial-mark]
```
