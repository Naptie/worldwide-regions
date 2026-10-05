import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDataOverrides, NON_SELECTABLE_REGIONS, REGION_OVERRIDES } from './data-overrides.js';
import { createRegion } from './schema.js';
import type { PipelineRegion } from './types.js';

function regionWith(id: string, parentId: string, nameEn: string): PipelineRegion {
  const region = createRegion(id, parentId, 'city', nameEn);
  region._settlementType = 'city';
  region.location = { type: 'Point', coordinates: [0, 0] };
  return region;
}

test('reparents Kent Margate away from Tower Hamlets', () => {
  const margate = regionWith('GB:50496', 'GB-TWH', 'Margate');
  const report = applyDataOverrides([margate]);

  assert.equal(margate.parentId, 'GB-KEN');
  assert.equal(report.overridesApplied, 1);
  assert.deepEqual(report.skippedStale, []);
});

test('reparents the UK seaside misfilings to their true counties', () => {
  const towns = [
    regionWith('GB:50297', 'GB-SOS', 'Leysdown-on-Sea'),
    regionWith('GB:48950', 'GB-HNS', 'Chertsey'),
    regionWith('GB:51398', 'GB-IOS', 'St Ives'),
    regionWith('GB:51742', 'GB-SFK', 'Walton-on-the-Naze')
  ];
  const report = applyDataOverrides(towns);

  assert.equal(towns[0].parentId, 'GB-KEN');
  assert.equal(towns[1].parentId, 'GB-SRY');
  assert.equal(towns[2].parentId, 'GB-CON');
  assert.equal(towns[3].parentId, 'GB-ESS');
  assert.equal(report.overridesApplied, 4);
});

test('fixes Barceloneta PR coordinates to Puerto Rico', () => {
  const barceloneta = regionWith('PR:153557', 'PR-017', 'Barceloneta');
  applyDataOverrides([barceloneta]);

  assert.deepEqual(barceloneta.location?.coordinates, [-66.538611, 18.450556]);
  assert.equal(barceloneta._wikidataQid, 'Q2025087');
  assert.equal(barceloneta.parentId, 'PR-017');
});

test('marks the Singapore capital leaf non-selectable', () => {
  const singapore = regionWith('SG:104057', 'SG-01', 'Singapore');
  const report = applyDataOverrides([singapore]);

  assert.equal(singapore.selectable, false);
  assert.equal(report.nonSelectableMarked, 1);
});

test('skips an override when the source record was renamed (stale guard)', () => {
  const margate = regionWith('GB:50496', 'GB-TWH', 'Margate-by-the-Sea');
  const report = applyDataOverrides([margate]);

  assert.equal(margate.parentId, 'GB-TWH');
  assert.deepEqual(report.skippedStale, [
    'GB:50496 (name is now "Margate-by-the-Sea", expected "Margate")'
  ]);
});

test('every override target carries a reason and a plausible parent', () => {
  for (const [id, override] of Object.entries(REGION_OVERRIDES)) {
    assert.ok(override.reason.length > 10, `${id} needs a reason`);
    if (override.parentId) assert.match(override.parentId, /^[A-Z]{2}-[A-Z0-9]{1,3}$/);
    if (override.location) {
      const [lon, lat] = override.location.coordinates;
      assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180);
    }
  }
  for (const [id, reason] of Object.entries(NON_SELECTABLE_REGIONS)) {
    assert.ok(reason.length > 10, `${id} needs a reason`);
  }
});
