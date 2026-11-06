import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CMEMS } from '../../site/catalog.js';
import { regionOf, durationMs, timeDomain, snapTime, depthLevels, nearestLevel } from '../../site/cmems.js';

test('regionOf: Mediterranean products by name, whatever their family; global ones none', () => {
  for (const p of ['MEDSEA_ANALYSISFORECAST_WAV_006_017/x/VHM0', 'SST_MED_SST_L4_NRT_OBSERVATIONS_010_004/x/analysed_sst', 'OCEANCOLOUR_MED_BGC_L4_NRT_009_142/x/CHL']) {
    assert.equal(regionOf(p)?.name, 'Mediterranean', p);
  }
  for (const p of ['GLOBAL_ANALYSISFORECAST_PHY_001_024/x/zos', 'SST_GLO_SST_L4_NRT_OBSERVATIONS_010_001/x/analysed_sst', 'WIND_GLO_PHY_L4_NRT_012_004/x/wind']) {
    assert.equal(regionOf(p), null, p);
  }
  // every variant with two parts draws a global one first and the regional one over it
  for (const [id, vs] of Object.entries(CMEMS)) {
    for (const [k, v] of Object.entries(vs)) {
      if (v.parts.length > 1) assert.deepEqual(v.parts.map((p) => !!regionOf(p)), [false, true], `${id}/${k}`);
    }
  }
});

test('Copernicus time: durations, a dataset\'s domain from its capabilities, snapping', () => {
  assert.equal(durationMs('PT1H'), 36e5);
  assert.equal(durationMs('PT10800S'), 3 * 36e5);
  assert.equal(durationMs('PT15M'), 9e5);
  assert.equal(durationMs('P1D'), 864e5);
  const xml = `<Layer><ows:Identifier>P/D/zos_detided</ows:Identifier><Dimension><ows:Identifier>time</ows:Identifier><Value>2020-01-01T00:00:00Z/2020-01-02T00:00:00Z/PT1H</Value></Dimension></Layer>
    <Layer><ows:Identifier>P/D/zos</ows:Identifier><Dimension><ows:Identifier>time</ows:Identifier><Default>x</Default>
    <Value>2024-06-25T00:00:00.000000000Z/2026-10-29T23:00:00Z/PT1H</Value></Dimension></Layer>`;
  const d = timeDomain(xml, 'zos');
  assert.deepEqual(d, [{ start: Date.parse('2024-06-25T00:00:00Z'), end: Date.parse('2026-10-29T23:00:00Z'), step: 36e5 }], 'zos, not zos_detided; nanoseconds read');
  assert.deepEqual(timeDomain(xml.replace('2020-01-02T00:00:00Z/PT1H', '2020-01-02T00:00:00Z/P1M'), 'zos_detided'), [], 'a step in months is not read: the range is left out');
  const t = (s) => Date.parse(s);
  assert.equal(snapTime(d, t('2026-10-21T12:00:00Z')), t('2026-10-21T12:00:00Z'));
  assert.equal(snapTime(d, t('2026-10-21T12:40:00Z')), t('2026-10-21T12:00:00Z'));
  assert.equal(snapTime(d, t('2026-10-31T00:00:00Z')), null, 'after the forecast');
  assert.equal(snapTime(d, t('2024-01-01T00:00:00Z')), null, 'before the first step');
  // every 3 hours from 03:00: noon is a step, 13:00 draws noon
  const w = [{ start: t('2022-11-01T03:00:00Z'), end: t('2026-10-30T00:00:00Z'), step: 3 * 36e5 }];
  assert.equal(snapTime(w, t('2026-10-21T13:00:00Z')), t('2026-10-21T12:00:00Z'));
});

test('Copernicus depth: levels from capabilities, the nearest one to the depth chosen', () => {
  const xml = `<Layer><ows:Identifier>P/D/thetao</ows:Identifier><Dimension><ows:Identifier>elevation</ows:Identifier><UOM>m</UOM>
    <Default>-1.0182366371154785</Default><Value>-110.0</Value><Value>-98.5</Value><Value>-10.5</Value><Value>-1.0182366371154785</Value></Dimension>
    <Dimension><ows:Identifier>time</ows:Identifier><Value>2024-01-01T00:00:00Z/2024-01-02T00:00:00Z/P1D</Value></Dimension></Layer>`;
  const levels = depthLevels(xml, 'thetao');
  assert.deepEqual(levels, ['-110.0', '-98.5', '-10.5', '-1.0182366371154785'], 'as listed, for the ELEVATION parameter');
  assert.equal(nearestLevel(levels, 0), '-1.0182366371154785', 'surface: the top level');
  assert.equal(nearestLevel(levels, 100), '-98.5');
  assert.equal(nearestLevel(levels, 1000), '-110.0', 'below the deepest: the deepest');
  assert.equal(nearestLevel([], 100), null, 'a variable without depth');
  assert.deepEqual(depthLevels(xml.replace('elevation', 'x'), 'thetao'), []);
});

test('cmemsValues: a dataset whose time steps could not be read is said, not left out in silence', async () => {
  const { cmemsValues } = await import('../../site/values.js');
  const was = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('offline'); }; // its capabilities: not had (partTimes: undefined)
  try {
    const [id, variant] = [Object.keys(CMEMS)[0], Object.keys(CMEMS[Object.keys(CMEMS)[0]])[0]];
    await assert.rejects(cmemsValues(id, { variant, t: Date.UTC(2026, 9, 1), depth: 0 }, [0, 40, 1, 41]), /time steps could not be read/);
  } finally { globalThis.fetch = was; }
});

test('partIn: a global part covers every view; a regional one only views meeting its area (the Mediterranean, not the Atlantic or the Black Sea)', async () => {
  const { partIn } = await import('../../site/cmems.js');
  const glo = 'GLOBAL_ANALYSISFORECAST_WAV_001_027/cmems_mod_glo_wav_anfc_0.083deg_PT3H-i_202411/VHM0';
  const med = 'MEDSEA_ANALYSISFORECAST_WAV_006_017/cmems_mod_med_wav_anfc_4.2km_PT1H-i_202311/VHM0';
  const atlantic = [-30, 40, -20, 45], tyrrhenian = [10, 38, 14, 42], black = [30, 42, 40, 46];
  assert.ok([atlantic, tyrrhenian, black].every((b) => partIn(glo, b)));
  assert.deepEqual([atlantic, tyrrhenian, black].map((b) => partIn(med, b)), [false, true, false]);
});

test('normals: a climatology drawn at the calendar month of its stand-in year; a still map at no time', async () => {
  const { monthIn, partTimes, storedVariables, isoTime } = await import('../../site/cmems.js');
  assert.equal(isoTime(Date.UTC(1993, 0, 1)), '1993-01-01T00:00:00Z');
  const domain = Array.from({ length: 12 }, (_, m) => ({ start: Date.UTC(1993, m, 1), end: Date.UTC(1993, m, 1), step: 0 }));
  assert.equal(monthIn(domain, Date.UTC(2026, 7, 15, 13)), Date.UTC(1993, 7, 1));
  assert.equal(snapTime(domain, monthIn(domain, Date.UTC(2026, 11, 31, 23))), Date.UTC(1993, 11, 1));
  assert.deepEqual(await partTimes('normalwaves', 'severe', Date.UTC(2026, 0, 1)), [null, null]); // no capabilities asked
  assert.deepEqual(storedVariables('MEDSEA_MULTIYEAR_PHY_006_004/cmems_mod_med_phy_my_4.2km-climatology_P1M-m_202211/sea_water_velocity'), ['uo_avg', 'vo_avg']);
  assert.deepEqual(storedVariables('GLOBAL_MULTIYEAR_PHY_001_030/cmems_mod_glo_phy_my_0.083deg-climatology_P1M-m_202311/sea_water_velocity'), ['uo', 'vo']);
  // every normal is one or the other, and takes the colour range of the layer it is the normal of
  for (const [id, vs] of Object.entries(CMEMS).filter(([id]) => id.startsWith('normal'))) {
    for (const [k, v] of Object.entries(vs)) assert.ok(!!v.month !== !!v.still, `${id}/${k}`);
  }
  assert.deepEqual(CMEMS.normalwaves.height.range, CMEMS.waves.height.range);
  assert.deepEqual(CMEMS.normalwater.temperature.range, CMEMS.temperature.depth.range);
  assert.deepEqual(CMEMS.normalwater.salinity.range, CMEMS.salinity.depth.range);
  assert.deepEqual(CMEMS.normalwater.mld.range, CMEMS.mld.depth.range);
  assert.deepEqual(CMEMS.normalcurrents.current.range, CMEMS.currents.surface.range);
});

test('cmemsValues: a still map is said to have no data, not read', async () => {
  const { cmemsValues } = await import('../../site/values.js');
  await assert.rejects(cmemsValues('normalwaves', { variant: 'severe', t: 0, depth: 0 }, [0, 40, 1, 41]), /map only/);
});
