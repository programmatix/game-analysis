const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildCardLookup, resolveCard, resolveDeckCards, withCardDatabase } = require('./card-data');

test('resolveCard uses ashes.releaseStub hint to disambiguate', () => {
  const cards = [
    { name: 'Echo', stub: 'echo-r1', release: { name: 'R1', stub: 'r1' }, type: 'Action Spell' },
    { name: 'Echo', stub: 'echo-r2', release: { name: 'R2', stub: 'r2' }, type: 'Action Spell' },
  ];
  const { lookup, cardIndex } = buildCardLookup(cards);

  const entry = { count: 1, name: 'Echo', ashes: { releaseStub: 'r2' } };
  const resolved = resolveCard(entry, lookup, cardIndex);
  assert.equal(resolved.stub, 'echo-r2');
});

test('resolveDeckCards aggregates missing and ambiguous card references', () => {
  const cards = [
    { name: 'Echo', stub: 'echo-r1', release: { name: 'R1', stub: 'r1' }, type: 'Action Spell' },
    { name: 'Echo', stub: 'echo-r2', release: { name: 'R2', stub: 'r2' }, type: 'Action Spell' },
  ];
  const { lookup, cardIndex } = buildCardLookup(cards);

  const entries = [
    { count: 1, name: 'Echo' }, // ambiguous
    { count: 1, name: 'Missing Card', code: 'missing-stub' }, // missing
  ];

  assert.throws(
    () => resolveDeckCards(entries, lookup, cardIndex),
    err =>
      err instanceof Error
      && err.message.includes('Found 1 missing card reference')
      && err.message.includes('Found 1 ambiguous card reference'),
  );
});

test('withCardDatabase refreshes the cache when a stub is missing', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;

  try {
    global.fetch = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() {
          return {
            results: [{ name: 'Final Stand', stub: 'final-stand', release: { name: 'R', stub: 'r' }, type: 'Action Spell' }],
            next: null,
          };
        },
      };
    };

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ashes-card-data-test-'));
    const cachePath = path.join(tmpDir, 'asheslive-cards.json');

    await fs.promises.writeFile(cachePath, JSON.stringify([{ name: 'Other Card', stub: 'other-card' }], null, 2));

    const resolved = await withCardDatabase(
      { cachePath, refresh: false, baseUrl: 'https://api.ashes.live', showLegacy: false },
      ({ lookup, cardIndex }) => resolveCard({ count: 1, name: 'Final Stand', code: 'final-stand' }, lookup, cardIndex),
    );

    assert.equal(resolved.stub, 'final-stand');
    assert.equal(fetchCalls, 1);

    const refreshedCache = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
    assert.ok(Array.isArray(refreshedCache));
    assert.ok(refreshedCache.some(card => card && card.stub === 'final-stand'));
  } finally {
    global.fetch = originalFetch;
  }
});
