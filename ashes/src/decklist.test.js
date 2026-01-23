const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAshesDeckEntries } = require('./decklist');

test('normalizeAshesDeckEntries extracts stub/release/type hints from keywords', () => {
  const input = [
    {
      count: 1,
      name: 'Final Stand',
      annotations: {
        keywords: ['stub:final-stand', 'release:the-corpse-of-viros', 'type:action spell', 'skipproxy'],
      },
    },
  ];

  const out = normalizeAshesDeckEntries(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].code, 'final-stand');
  assert.equal(out[0].ashes.releaseStub, 'the-corpse-of-viros');
  assert.equal(out[0].ashes.type, 'action spell');
  assert.deepEqual(out[0].annotations.keywords, ['skipproxy']);
});

