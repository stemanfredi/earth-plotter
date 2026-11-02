import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyEntry, keyOf, openKey, KEYS } from '../../site/keys.js';

test('keys: each single key opens one thing or one tool, in either case; a key with none gives nothing', () => {
  assert.equal(keyEntry('L').open, 'layers');
  assert.equal(keyEntry('l').open, 'layers');
  assert.equal(keyEntry('/').open, 'search');
  assert.equal(keyEntry('b').tool, 'box');
  assert.equal(keyEntry('x'), undefined);
  assert.deepEqual(['point', 'line', 'shape', 'label', 'measure'].map(keyOf), ['P', 'G', 'S', 'T', 'M']);
  assert.equal(keyOf('select'), '', 'Select has no key');
  assert.deepEqual([openKey('layers'), openKey('elements'), openKey('props'), openKey('nothing')], ['L', 'E', 'I', '']);
});

test('keys: no key is given twice', () => {
  const keys = KEYS.filter((k) => k.key).map((k) => k.key.toLowerCase());
  assert.ok(keys.length > 5);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'a key given twice');
});
