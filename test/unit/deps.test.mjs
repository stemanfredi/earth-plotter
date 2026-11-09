import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stale } from '../../tools/deps.mjs';

test('site/vendor/ holds the libraries at package.json\'s versions, and the policy names the hosts', async () => {
  assert.deepEqual(await stale(), [], 'run npm run vendor');
});

test('a saved area keeps only hosts the page knows, never the imagery', async () => {
  const { HOSTS, OFFLINE } = await import('../../site/hosts.js');
  const { ORTHO } = await import('../../site/catalog.js');
  assert.ok(OFFLINE.every((k) => HOSTS[k]), 'every saved host is one of HOSTS');
  const imagery = new Set([...['eox', 'gibs', 'esriTiles', 'esriStyles'].map((k) => HOSTS[k]), ...ORTHO.flatMap((o) => o.parts)].map((u) => new URL(u).origin));
  assert.deepEqual(OFFLINE.filter((k) => imagery.has(new URL(HOSTS[k]).origin)), [], 'imagery is left out of saved areas (ROADMAP)');
});
