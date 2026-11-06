// Statistics of a series in time (series.js reads them): what a point's or an area's waves, wind or
// water did over a period. Pure functions of times (ms since the epoch, ascending, at a regular
// step) and values (NaN where there is none), so that they are tested in Node. Months and years
// are UTC, as the records are.

export const HOUR = 36e5;
// the series' step (ms): the most common gap between the first times (a record is regular; a gap
// in it, such as a missing day, does not change its step)
export function stepOf(times) {
  const n = {};
  for (let i = 1; i < Math.min(times.length, 64); i++) { const d = times[i] - times[i - 1]; n[d] = (n[d] || 0) + 1; }
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : NaN;
}
// the values that are numbers, sorted ascending (a Float64Array)
const sorted = (values) => Float64Array.from(values).filter((v) => !Number.isNaN(v)).sort();
// the p-quantile (0–1) of sorted values, interpolated between the two nearest (NaN if none)
export function quantile(s, p) {
  if (!s.length) return NaN;
  const h = (s.length - 1) * p, i = Math.floor(h);
  return i + 1 < s.length ? s[i] + (h - i) * (s[i + 1] - s[i]) : s[i];
}
// how the values spread: their count, mean, lowest, highest, and the quantiles asked
export function summary(values, ps = [0.5, 0.9, 0.99]) {
  const s = sorted(values);
  let sum = 0;
  for (const v of s) sum += v;
  return { n: s.length, mean: s.length ? sum / s.length : NaN, min: s.length ? s[0] : NaN, max: s.length ? s[s.length - 1] : NaN, quantiles: ps.map((p) => quantile(s, p)) };
}
// the share (0–1) of the values (those that are numbers) below a threshold
export function shareBelow(values, threshold) {
  let n = 0, k = 0;
  for (const v of values) if (!Number.isNaN(v)) { n++; if (v < threshold) k++; }
  return n ? k / n : NaN;
}
// the values grouped by calendar month (0 January … 11 December), each group summarised by f
// (values of that month → anything); the months without a value get f([])
export function byMonth(times, values, f) {
  const groups = Array.from({ length: 12 }, () => []);
  for (let i = 0; i < times.length; i++) if (!Number.isNaN(values[i])) groups[new Date(times[i]).getUTCMonth()].push(values[i]);
  return groups.map((g) => f(g));
}

// Calm spells. For each time, whether the values stay below the threshold for the next `hours`
// (that time's value included, the record's steps in a row: a missing value ends a spell, so does a
// gap in the times); then by month of that time, the share of times that start such a spell: the
// chance, on arriving at a time of that month, of having `hours` of it ahead. A month with no full
// window in the record is NaN.
export function spellChance(times, values, threshold, hours) {
  const step = stepOf(times), need = Math.max(1, Math.ceil((hours * HOUR) / step));
  const run = new Int32Array(times.length + 1); // steps in a row below the threshold from i on
  for (let i = times.length - 1; i >= 0; i--) {
    const next = i + 1 < times.length && times[i + 1] - times[i] === step ? run[i + 1] : 0;
    run[i] = values[i] < threshold ? next + 1 : 0;
  }
  const yes = new Float64Array(12), all = new Float64Array(12);
  for (let i = 0; i + need <= times.length; i++) {
    if (Number.isNaN(values[i])) continue;
    const m = new Date(times[i]).getUTCMonth();
    all[m]++;
    if (run[i] >= need) yes[m]++;
  }
  return Array.from(all, (n, m) => (n ? yes[m] / n : NaN));
}
// the spells themselves: the runs of the values below a threshold lasting at least `hours`, as
// { start, end (the last time in it), hours }, longest first
export function spells(times, values, threshold, hours = 0) {
  const step = stepOf(times), out = [];
  for (let i = 0; i < times.length;) {
    if (!(values[i] < threshold)) { i++; continue; }
    let j = i;
    while (j + 1 < times.length && values[j + 1] < threshold && times[j + 1] - times[j] === step) j++;
    const h = (times[j] - times[i] + step) / HOUR;
    if (h >= hours) out.push({ start: times[i], end: times[j], hours: h });
    i = j + 1;
  }
  return out.sort((a, b) => b.hours - a.hours);
}

// Where something comes from: the share (0–1) of the directions (degrees, 0 north, clockwise) in
// each of `sectors` sectors, the first centred on north; with classes (ascending upper bounds of a
// second series, such as the heights), the share in each sector by class, rows by sector (a value at
// or above the last bound in the last class)
export function rose(directions, sectors = 16, by = null, bounds = null) {
  const width = 360 / sectors, k = bounds ? bounds.length : 1;
  const counts = Array.from({ length: sectors }, () => new Float64Array(k));
  let n = 0;
  for (let i = 0; i < directions.length; i++) {
    const d = directions[i];
    if (Number.isNaN(d) || (by && Number.isNaN(by[i]))) continue;
    const s = Math.floor((((d % 360) + 360 + width / 2) % 360) / width) % sectors;
    let c = 0;
    if (bounds) { while (c < k - 1 && by[i] >= bounds[c]) c++; }
    counts[s][c]++;
    n++;
  }
  return counts.map((row) => Array.from(row, (c) => (n ? c / n : NaN)));
}
// the mean of directions as angles (degrees, 0–360): the direction of the sum of unit vectors, and
// how much they agree (0 spread all round, 1 all the same)
export function meanDirection(directions) {
  let x = 0, y = 0, n = 0;
  for (const d of directions) if (!Number.isNaN(d)) { x += Math.sin((d * Math.PI) / 180); y += Math.cos((d * Math.PI) / 180); n++; }
  if (!n) return { direction: NaN, agreement: NaN };
  return { direction: ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360, agreement: Math.hypot(x, y) / n };
}

// The highest value of each year, as { year, value, time, coverage (the share of the year's steps
// that have a value) }; a year with less than minCoverage (the record's first and last, a year with
// gaps) is left out, as its highest could be missing
export function annualMaxima(times, values, minCoverage = 0.8) {
  const step = stepOf(times), years = new Map();
  for (let i = 0; i < times.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    const year = new Date(times[i]).getUTCFullYear(), y = years.get(year) || { year, value: -Infinity, time: NaN, n: 0 };
    y.n++;
    if (v > y.value) { y.value = v; y.time = times[i]; }
    years.set(year, y);
  }
  return [...years.values()].map(({ n, ...y }) => ({ ...y, coverage: (n * step) / (Date.UTC(y.year + 1, 0, 1) - Date.UTC(y.year, 0, 1)) }))
    .filter((y) => y.coverage >= minCoverage).sort((a, b) => a.year - b.year);
}
// The value exceeded on average once in T years, from the annual maxima: Gumbel's distribution
// fitted by L-moments (robust with a few decades of maxima), for each T asked. A T longer than twice
// the years of maxima is NaN: the fit says nothing there. { location, scale, levels }
export function returnLevels(maxima, periods = [10, 50]) {
  const x = Float64Array.from(maxima).sort(), n = x.length;
  if (n < 10) return { location: NaN, scale: NaN, levels: periods.map(() => NaN) };
  let b0 = 0, b1 = 0;
  for (let i = 0; i < n; i++) { b0 += x[i]; b1 += (i / (n - 1)) * x[i]; }
  b0 /= n; b1 /= n;
  const scale = (2 * b1 - b0) / Math.LN2, location = b0 - 0.5772156649 * scale;
  return { location, scale, levels: periods.map((T) => (T > 2 * n ? NaN : location - scale * Math.log(-Math.log(1 - 1 / T)))) };
}
// Storms: the times the values went above a threshold, as events, a new one only after `apart`
// hours below it (so that one storm's hours are counted once); each { start, end, peak, time (of the
// peak), hours (above the threshold) }, the highest first
export function storms(times, values, threshold, apart = 48) {
  const step = stepOf(times), out = [];
  let e = null;
  for (let i = 0; i < times.length; i++) {
    if (!(values[i] >= threshold)) continue;
    if (e && times[i] - e.end > apart * HOUR) { out.push(e); e = null; }
    if (!e) e = { start: times[i], end: times[i], peak: values[i], time: times[i], steps: 0 };
    e.end = times[i];
    e.steps++;
    if (values[i] > e.peak) { e.peak = values[i]; e.time = times[i]; }
  }
  if (e) out.push(e);
  return out.map(({ steps, ...s }) => ({ ...s, hours: (steps * step) / HOUR })).sort((a, b) => b.peak - a.peak);
}

// The trend of the yearly means, per decade: Sen's slope (the median of the slopes between every
// two years, robust to an odd year), over the years with at least minCoverage of their steps
export function trend(times, values, minCoverage = 0.8) {
  const step = stepOf(times), years = new Map();
  for (let i = 0; i < times.length; i++) {
    if (Number.isNaN(values[i])) continue;
    const y = new Date(times[i]).getUTCFullYear(), a = years.get(y) || [0, 0];
    a[0] += values[i]; a[1]++;
    years.set(y, a);
  }
  const pts = [...years].filter(([y, [, n]]) => (n * step) / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) >= minCoverage).map(([y, [s, n]]) => [y, s / n]);
  const slopes = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
  return { perDecade: slopes.length ? 10 * quantile(Float64Array.from(slopes).sort(), 0.5) : NaN, years: pts.length };
}

// Wave power in deep water (kW per metre of wave front) from the significant height (m) and the
// energy period (s, the record's Tm-1,0): ρg²/64π · Hs² · Te
export const wavePower = (hs, te) => ((1025 * 9.81 ** 2) / (64 * Math.PI)) * hs * hs * te / 1000;

// the times of a series within [t0, t1] (ms), as the first and last index (−1, −1 if none)
export function within(times, t0, t1) {
  let a = 0, b = times.length - 1;
  while (a < times.length && times[a] < t0) a++;
  while (b >= 0 && times[b] > t1) b--;
  return a <= b ? [a, b] : [-1, -1];
}
