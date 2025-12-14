## Arkham Proxy CLI

Create printable proxy PDFs for Arkham Horror: The Card Game. The tool reads a deck list, looks up cards in the bundled `arkhamdb-json-data`, fetches matching art from dragncards, and lays everything out on A4 with cut marks, rulers, and a footer.

### Setup

- Requires Node.js 18+ (tested with Node 24).
- From this folder run `npm install` to pull dependencies.
- Uses the local `arkhamdb-json-data/` by default; override with `--data-dir` if you want to point at another checkout.


## Decklist format

```
2 knife
1 sophie[03009]
[include:partial-mark]
# comment
// comment
/* multi-line comment */
```

### Arkham annotations

Tag Arkham-specific utility in square brackets so the sampler CLI can track it:

- `[weapon]` marks a card as a weapon.
- `[resources:<n>]` adds that many resources when you see and play the card.
- `[draw:<n>]` adds that many extra draws.

Example: `2 emergency cache[01088] [resources:3]`

### Proxy deck generator

```bash
# deck.txt lines look like: "2 Lucky! (2)"
npx arkham-proxy --input deck.txt --name "Roland Solo"
```

### Odds helper

Compute draw odds that respect Arkham opening-hand weakness redraws:

```bash
npx arkham-odds --deck-size 33 --weaknesses 2 --target-copies 2 --opening-hand 5 --next-draws 10
```

### Hand sampler

Sample 10,000 opening hands and early draws, counting weapons plus resource/draw potential (starts at 5 resources and +1 per draw):

```bash
npx arkham-hand-sim --input deck.txt --opening-hand 5 --next-draws 8
```

### Required sets

List every pack or box needed for a deck using the full names from arkhamdb:

```bash
npx arkham-sets --input deck.txt
```
