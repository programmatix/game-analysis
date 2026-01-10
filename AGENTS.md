This project contains resources to construct decks for some card games, and to print proxy decks for them.

The proxy decks are purely for home playtesting.

Any generic utility code should exist in the `shared` directory.

A standard suite of tools will usually consist of:

- A CLI tool to parse a decklist and annotate it with per-card notes.  See `npx marvel-annotate` as an example.
- A CLI tool to analyze a decklist.  See `npx marvel-analyze` as an example.
- A CLI tool to search the database.  See `npx marvel-search` as an example.
- A CLI tool to generate a proxy PDF from a decklist.
- Not always needed, but a CLI tool to generate a decklist from a pack.  See `npx marvel-pack` as an example.
- Everything should go under a subfolder for this game `subfolder/`.  But generic utility code should go in the `shared` directory.
- Cached files should go in `subfolder/.cache/`.
- Create a README.md file in the subfolder with brief instructions for the tools.  Keep it concise.