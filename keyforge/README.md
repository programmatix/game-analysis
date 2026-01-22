## KeyForge Adventures CLI

Tools to list and print KeyForge Adventures as proxy PDFs (adventure decks only; no Archon deck support). Card metadata and images come from Archon Arcana and are cached locally.

### Setup

- Requires Node.js 18+.
- From this folder run `npm install`.

### List adventures

```bash
npx keyforge-adventure --list
```

### Print an adventure

```bash
# Builds a printable A4 PDF with cut marks
npx keyforge-adventure RotK --output rotk.pdf
npx keyforge-adventure AC --output abyssal-conspiracy.pdf
```

Useful flags:

- `--cache-dir` controls where card images download (default: `.cache/keyforge-adventure-art`).
- `--refresh` re-downloads cached images.
- `--grid-size` controls the NxN card grid per page (default: `3`).
- `--scale` scales cards down slightly for tight sleeves (default: `0.99`).

### Show card list

```bash
npx keyforge-adventure RotK --cards
```

