import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, stepOf, quantile, summary, shareBelow, byMonth, spellChance, spells, rose, meanDirection, annualMaxima, returnLevels, storms, trend, wavePower, within } from '../../site/stats.js';

// hourly times from a UTC date, n of them
const hourly = (y, m, d, n) => Float64Array.from({ length: n }, (_, i) => Date.UTC(y, m, d) + i * HOUR);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('stepOf: the most common gap, a missing step not counted', () => {
  assert.equal(stepOf([0, 10, 20, 40, 50, 60]), 10);
  assert.equal(stepOf(hourly(2000, 0, 1, 5)), HOUR);
});

test('quantile and summary: interpolated, NaN left out', () => {
  const s = Float64Array.of(1, 2, 3, 4);
  close(quantile(s, 0.5), 2.5);
  assert.equal(quantile(s, 1), 4);
  assert.ok(Number.isNaN(quantile(new Float64Array(0), 0.5)));
  const r = summary(Float32Array.of(3, NaN, 1, 2), [0.5]);
  assert.deepEqual({ ...r, quantiles: [...r.quantiles] }, { n: 3, mean: 2, min: 1, max: 3, quantiles: [2] });
});

test('shareBelow and byMonth', () => {
  close(shareBelow([0.5, 1.5, NaN, 0.9], 1), 2 / 3);
  const t = [Date.UTC(2000, 0, 5), Date.UTC(2000, 0, 6), Date.UTC(2000, 6, 1)];
  const means = byMonth(t, [1, 3, 10], (g) => (g.length ? g.reduce((a, b) => a + b) / g.length : NaN));
  assert.equal(means[0], 2);
  assert.equal(means[6], 10);
  assert.ok(Number.isNaN(means[3]));
});

test('spellChance: the share of times with the hours ahead below the threshold, a missing value ending a spell', () => {
  // 10 hours: below for 0–3, above at 4, below 5–9; a 3-hour spell can start at 0, 1, 5, 6, 7
  const t = hourly(2001, 2, 1, 10), v = [0, 0, 0, 0, 2, 0, 0, 0, 0, 0];
  const c = spellChance(t, v, 1, 3);
  close(c[2], 5 / 8); // 8 times with three hours of record ahead
  assert.ok(Number.isNaN(c[0]));
  const gap = [0, 0, NaN, 0, 0, 0, 0, 0, 0, 0];
  close(spellChance(t, gap, 1, 3)[2], 5 / 7); // 0 and 1 no longer start one: 3, 4, 5, 6, 7 do, of 7 with values
});

test('spells: runs below the threshold, longest first, a gap in the times ending one', () => {
  const t = [...hourly(2002, 0, 1, 4), Date.UTC(2002, 0, 1, 10), Date.UTC(2002, 0, 1, 11)];
  const s = spells(t, [0, 0, 0, 5, 0, 0], 1);
  assert.deepEqual(s.map((x) => x.hours), [3, 2]);
  assert.deepEqual(spells(t, [0, 0, 0, 5, 0, 0], 1, 3).length, 1);
});

test('rose: sectors centred on north, wrapping, by classes', () => {
  const r = rose([0, 359, 10, 90, 180, NaN], 4);
  assert.deepEqual(r.map((x) => x[0]), [3 / 5, 1 / 5, 1 / 5, 0]);
  const c = rose([0, 0, 90], 4, [0.5, 3, 1], [1, 2, Infinity]);
  assert.deepEqual(c[0], [1 / 3, 0, 1 / 3]);
  assert.deepEqual(c[1], [0, 1 / 3, 0]);
});

test('meanDirection: across north, and how much they agree', () => {
  const m = meanDirection([350, 10]);
  close(m.direction % 360, 0, 1e-9);
  close(m.agreement, Math.cos((10 * Math.PI) / 180));
  close(meanDirection([90, 270]).agreement, 0, 1e-12);
});

test('annualMaxima: the highest of each year, years with gaps left out', () => {
  const t = [], v = [];
  for (let y = 2000; y < 2003; y++) for (let d = 0; d < (y === 2002 ? 100 : 366); d++) { t.push(Date.UTC(y, 0, 1) + d * 864e5); v.push(y === 2001 && d === 40 ? 9 : d % 7); }
  const m = annualMaxima(t, v);
  assert.deepEqual(m.map((x) => [x.year, x.value]), [[2000, 6], [2001, 9]]);
  assert.equal(m[1].time, Date.UTC(2001, 1, 10));
});

test('returnLevels: Gumbel by L-moments recovers its parameters; no level past twice the record', () => {
  // the expected maxima of a Gumbel (μ 5, β 0.8) at plotting positions: its fit gives them back closely
  const n = 40, mu = 5, beta = 0.8;
  const x = Array.from({ length: n }, (_, i) => mu - beta * Math.log(-Math.log((i + 0.65) / (n + 0.3))));
  const r = returnLevels(x, [10, 50, 100]);
  close(r.location, mu, 0.08);
  close(r.scale, beta, 0.08);
  close(r.levels[0], mu - beta * Math.log(-Math.log(0.9)), 0.15);
  assert.ok(Number.isNaN(r.levels[2]));
  assert.ok(Number.isNaN(returnLevels([1, 2, 3]).levels[0]));
});

test('storms: one event until the values stay below for the hours apart', () => {
  const t = hourly(2003, 0, 1, 200), v = new Array(200).fill(0);
  v[10] = 3; v[12] = 5; v[30] = 4; // 10–30: one storm (gaps under 48 h)
  v[150] = 6; // another
  const s = storms(t, v, 2.5);
  assert.deepEqual(s.map((x) => [x.peak, x.hours]), [[6, 1], [5, 3]]);
  assert.equal(s[1].time, t[12]);
  assert.equal(s[1].end, t[30]);
});

test('trend: Sen\'s slope of yearly means, per decade', () => {
  const t = [], v = [];
  for (let y = 1990; y < 2000; y++) for (let d = 0; d < 365; d++) { t.push(Date.UTC(y, 0, 1) + d * 864e5); v.push(20 + 0.03 * (y - 1990) + (y === 1995 ? 5 : 0)); }
  const r = trend(t, v);
  close(r.perDecade, 0.3, 1e-6);
  assert.equal(r.years, 10);
});

test('wavePower: about 0.49 Hs² Te kW/m', () => {
  close(wavePower(2, 8), 0.4906 * 4 * 8, 0.01);
});

test('within: the indices of a period', () => {
  assert.deepEqual(within([0, 10, 20, 30], 5, 25), [1, 2]);
  assert.deepEqual(within([0, 10], 11, 12), [-1, -1]);
});
