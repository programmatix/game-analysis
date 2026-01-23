const test = require('node:test');
const assert = require('node:assert/strict');

const { pickRelease, findReleasesByQuery } = require('./pack-utils');

test('pickRelease prefers exact stub match', () => {
  const releases = [
    { name: 'The Corpse of Viros', stub: 'the-corpse-of-viros', is_legacy: false },
    { name: 'The Corpse of X', stub: 'the-corpse-of-x', is_legacy: false },
  ];
  const { release } = pickRelease(releases, 'the-corpse-of-viros');
  assert.ok(release);
  assert.equal(release.stub, 'the-corpse-of-viros');
});

test('findReleasesByQuery matches by name terms', () => {
  const releases = [
    { name: 'The Corpse of Viros', stub: 'the-corpse-of-viros', is_legacy: false },
    { name: 'Master Set', stub: 'master-set', is_legacy: false },
  ];

  const matches = findReleasesByQuery(releases, 'corpse viros');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].stub, 'the-corpse-of-viros');
});

