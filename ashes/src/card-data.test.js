const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCardLookup, resolveCard, resolveDeckCards } = require('./card-data');

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

