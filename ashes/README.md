Ashes Reborn tools

- Run these from the `ashes/` directory so caches land in `ashes/.cache/`.

- `npx ashes-search <query>`: search the Ashes.live card database.
- `npx ashes-pack <release>`: emit a decklist for a release (useful for solo packs like “The Corpse of Viros”).
- `npx ashes-proxy --input deck.txt --name deck`: generate a printable proxy PDF from a decklist.
- `npx ashes-annotate --input deck.txt`: print a decklist with per-card notes.
- `npx ashes-analyze --input deck.txt`: quick stats (types, releases, dice costs).

Decklist format:

- One card per line: `<count> <card name>`
- Optional exact stub: `[stub:some-card-stub]` (recommended when building from `ashes-pack` output)
- `[include:other-file]` and `[proxypagebreak]` are supported.

Examples:

- `npx ashes-pack "corpse of viros" > corpse.txt`
- `npx ashes-proxy --input corpse.txt --name corpse-of-viros`
