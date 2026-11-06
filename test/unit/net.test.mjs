import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lru, fetchOk, fetchBytes } from '../../site/net.js';

test('lru: a promise kept per key, the least recently used forgotten past max; peek is not a use', async () => {
  let made = 0;
  const get = lru(2), make = (v) => () => { made++; return Promise.resolve(v); };
  assert.equal(await get('a', make(1)), 1);
  assert.equal(await get('a', make(2)), 1, 'kept: made once');
  assert.equal(made, 1);
  await get('b', make(2));
  assert.equal(get.peek('a'), get.peek('a'), 'peek gives the one kept');
  await get('c', make(3)); // past max: a (used before b) goes
  assert.equal(get.peek('a'), undefined);
  assert.equal(await get('b', make(9)), 2, 'b stays');
  assert.equal(made, 3);
  // a use moves a key to the front: a asked again, then d; b (least recent) goes, not a
  await get('a', make(1));
  await get('d', make(4));
  assert.deepEqual([get.peek('a') !== undefined, get.peek('b'), get.peek('c')], [true, undefined, undefined]);
});

test('lru: a make that fails is forgotten, so the next ask tries again', async () => {
  let tries = 0;
  const get = lru(Infinity);
  const make = () => { tries++; return tries === 1 ? Promise.reject(new Error('down')) : Promise.resolve('up'); };
  await assert.rejects(get('k', make), /down/);
  assert.equal(await get('k', make), 'up');
  assert.equal(tries, 2);
});

test('lru: a failure forgets only its own promise, not one made since under its key', async () => {
  const get = lru(Infinity);
  let fail;
  const old = get('k', () => new Promise((_, reject) => { fail = reject; }));
  get.drop('k');
  const now = get('k', () => Promise.resolve('new'));
  fail(new Error('old'));
  await assert.rejects(old, /old/);
  assert.equal(get.peek('k'), now, 'the newer one stays');
  assert.equal(await get('k', () => Promise.resolve('again')), 'new');
});

test('lru with maxAge: one older is made again, a newer one kept', async () => {
  const { lru } = await import('../../site/net.js');
  let now = 0, made = 0;
  const real = Date.now;
  Date.now = () => now;
  try {
    const get = lru(Infinity, 1000), make = () => { made++; return Promise.resolve(made); };
    assert.equal(await get('a', make), 1);
    now = 999;
    assert.equal(await get('a', make), 1, 'within its age: kept');
    now = 1000;
    assert.equal(await get('a', make), 2, 'a day later: asked again');
  } finally { Date.now = real; }
});

test('lru with maxAge: a refresh that fails keeps the one kept, and asks again an hour later', async () => {
  const { lru } = await import('../../site/net.js');
  let now = 0, made = 0, fail = false;
  const real = Date.now;
  Date.now = () => now;
  try {
    const get = lru(Infinity, 864e5), make = () => { made++; return fail ? Promise.reject(new Error('down')) : Promise.resolve(`v${made}`); };
    assert.equal(await get('a', make), 'v1');
    now = 864e5; fail = true;
    assert.equal(await get('a', make), 'v1', 'offline the next day: the last known');
    assert.equal(made, 2);
    now += 1000;
    assert.equal(await get('a', make), 'v1');
    assert.equal(made, 2, 'not asked again at every request');
    now += 36e5; fail = false;
    assert.equal(await get('a', make), 'v3', 'an hour later: asked again');
  } finally { Date.now = real; }
});

test('fetchOk and fetchBytes: every request gets a deadline, the caller\'s signal kept', async (t) => {
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { seen.push(init.signal); return new Response('x'); });
  const mine = new AbortController();
  await fetchOk('https://example.org/a', { signal: mine.signal });
  await fetchBytes('https://example.org/b');
  assert.ok(seen.every((s) => s instanceof AbortSignal && !s.aborted), 'a signal on each');
  mine.abort();
  assert.ok(seen[0].aborted, 'the caller\'s cancel still reaches the request');
  assert.ok(!seen[1].aborted);
});
