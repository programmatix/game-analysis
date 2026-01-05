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
- `[resourcesperturn:<n>]` simulates getting that many resources per turn after the card is seen (accumulates over turns).
- `[draw:<n>]` adds that many extra draws.
- `[drawperturn:<n>]` simulates getting that many draws per turn after the card is seen (accumulates over turns).
- `[permanent]` marks cards that start out and are excluded from deck counts/draw simulations.
- `[ignorefordecklimit]` excludes the card from deck-size warnings (permanent cards are treated this way automatically).
- `[weakness]` (or `[basicweakness]`) marks a weakness; opening hand redraws them and shuffles them back in.
- `[skipproxy]` keeps the card in the list but omits it from the proxy PDF (no image download).
- `[skipback]` prints only the front of a card and omits its back face from the proxy PDF.

Example: `2 emergency cache[01088] [resources:3]`

### Proxy deck generator

```bash
# deck.txt lines look like: "2 Lucky! (2)"
npx arkham-proxy --input deck.txt --name "Roland Solo"
```

### Deck annotator

Add inline comments (prefixed with `//?`) with XP, cost, type, traits, slot, and text for each card. Re-running replaces any previous `//?` annotations:

```bash
npx arkham-annotate --input deck.txt
```

Omit `--output` to overwrite `--input`; when reading from stdin, output is written to stdout.

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

### Hand sample (single run)

Use to debug the sampler. Show one literal shuffle with the same annotations as the sampler, listing the exact opening hand and draw order:

```bash
npx arkham-hand-sample --input deck.txt --opening-hand 5 --next-draws 8
```

### Card search

Search through the bundled card database by faction, XP, cost, traits, text, and more:

```bash
# Guardians weapons up to level 2 that mention engage
npx arkham-search --faction guardian --xp 0-2 --trait Weapon --text engage --type asset

# Cheap Rogue tricks
npx arkham-search --class rogue --cost 0-2 --type event --show-text
```

Useful flags:

- `--faction/--class` guardian|seeker|rogue|mystic|survivor|neutral
- `--xp` and `--cost` accept ranges like `0-2` or single values
- `--trait`, `--slot`, `--type`, `--pack`, `--name`, `--text` filter on other card fields
- `--unique` restricts to unique cards; `--exclude-weaknesses` removes weaknesses
- `--sort` controls ordering (comma-separated fields), `--limit` caps how many lines print

### Required sets

List every pack or box needed for a deck using the full names from arkhamdb:

```bash
npx arkham-sets --input deck.txt
```

### Scenario deck list

Generate a deck list for a scenario/encounter set (suitable for piping into `arkham-proxy`):

```bash
npx arkham-scenario --scenario the_gathering > encounters.txt
# or match by name
npx arkham-scenario --scenario "The Wages of Sin" > wages-of-sin.txt
```

Use `--list` to print all available encounter codes and names.
