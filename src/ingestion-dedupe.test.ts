import assert from 'node:assert/strict';
import test from 'node:test';
import { filterImplausibleParentDuplicates } from './ingestion.js';

type Settlement = {
  id: number;
  name: string;
  country_code: string;
  state_id: number;
  latitude: string;
  longitude: string;
  wikiDataId?: string;
};

// State centroids: Baguio (120.596, 16.415) is ~340 km from Camarines Norte's
// centroid and ~80 km from the Cordillera region's; Malolos is ~900 km from
// Agusan del Sur and ~15 km from Central Luzon.
const CENTROIDS = new Map<number, [number, number]>([
  [1, [120.6, 16.9]], // Cordillera Administrative Region (PH-15)
  [2, [122.05, 14.15]], // Camarines Norte (PH-CAN)
  [3, [120.75, 15.0]], // Central Luzon (PH-03)
  [4, [125.9, 8.5]], // Agusan del Sur (PH-AGS)
  [5, [120.5, 17.0]] // Ilocos region (PH-01) — overlaps CAR's coverage
]);

const baguioWrong: Settlement = {
  id: 144771,
  name: 'Baguio',
  country_code: 'PH',
  state_id: 2,
  latitude: '16.41516667',
  longitude: '120.59559444',
  wikiDataId: 'Q1822'
};
const baguioRight: Settlement = {
  id: 81409,
  name: 'Baguio',
  country_code: 'PH',
  state_id: 1,
  latitude: '16.41639',
  longitude: '120.59306',
  wikiDataId: 'Q1822'
};
const malolosWrong: Settlement = {
  id: 145539,
  name: 'Malolos',
  country_code: 'PH',
  state_id: 4,
  latitude: '14.84333333',
  longitude: '120.81138889',
  wikiDataId: 'Q2180'
};
const malolosRight: Settlement = {
  id: 83454,
  name: 'Malolos',
  country_code: 'PH',
  state_id: 3,
  latitude: '14.8443',
  longitude: '120.81039',
  wikiDataId: 'Q2180'
};

test('drops the implausible filing when a same-QID sibling is far more plausible', () => {
  const { kept, dropped } = filterImplausibleParentDuplicates(
    [baguioWrong, baguioRight, malolosWrong, malolosRight],
    CENTROIDS
  );
  assert.deepEqual(
    dropped.map((s) => s.id),
    [144771, 145539]
  );
  assert.deepEqual(
    kept.map((s) => s.id),
    [81409, 83454]
  );
});

test('keeps both region-vs-province filings when both are plausible', () => {
  const bothPlausible: Settlement[] = [
    {
      id: 1,
      name: 'Alac',
      country_code: 'PH',
      state_id: 1,
      latitude: '16.95',
      longitude: '120.55',
      wikiDataId: 'Q6400001'
    },
    {
      id: 2,
      name: 'Alac',
      country_code: 'PH',
      state_id: 5,
      latitude: '16.95',
      longitude: '120.55',
      wikiDataId: 'Q6400001'
    }
  ];
  const { dropped } = filterImplausibleParentDuplicates(bothPlausible, CENTROIDS);
  assert.deepEqual(dropped, []);
});

test('keeps everything when no sibling is clearly better', () => {
  const loneRecord: Settlement[] = [
    {
      id: 1,
      name: 'Somewhere',
      country_code: 'PH',
      state_id: 4,
      latitude: '8.5',
      longitude: '125.9',
      wikiDataId: 'Q6400002'
    }
  ];
  const { dropped } = filterImplausibleParentDuplicates(loneRecord, CENTROIDS);
  assert.deepEqual(dropped, []);
});

test('ignores records without wikiDataId and outside the configured countries', () => {
  const records: Settlement[] = [
    {
      id: 1,
      name: 'No QID',
      country_code: 'PH',
      state_id: 4,
      latitude: '8.5',
      longitude: '125.9'
    },
    {
      id: 2,
      name: 'No QID',
      country_code: 'PH',
      state_id: 3,
      latitude: '8.5',
      longitude: '125.9'
    },
    {
      id: 3,
      name: 'Far Away',
      country_code: 'US',
      state_id: 4,
      latitude: '8.5',
      longitude: '125.9',
      wikiDataId: 'Q6400003'
    },
    {
      id: 4,
      name: 'Far Away',
      country_code: 'US',
      state_id: 1,
      latitude: '8.5',
      longitude: '125.9',
      wikiDataId: 'Q6400003'
    }
  ];
  const { dropped } = filterImplausibleParentDuplicates(records, CENTROIDS);
  assert.deepEqual(dropped, []);
});
