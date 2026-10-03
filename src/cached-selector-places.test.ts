import assert from 'node:assert/strict';
import test from 'node:test';
import { addCachedSelectorPlaces, CACHED_SELECTOR_PLACES } from './cached-selector-places.js';
import { createRegion } from './schema.js';

test('adds every configured cached settlement under an existing parent', () => {
  const countries = new Map(
    CACHED_SELECTOR_PLACES.map(({ countryId }) => [
      countryId,
      createRegion(countryId, null, 'country', countryId)
    ])
  );
  const parents = new Map(
    CACHED_SELECTOR_PLACES.map(({ countryId, parentId }) => [
      parentId,
      createRegion(parentId, countryId, 'province', parentId)
    ])
  );
  const regions = [...countries.values(), ...parents.values()];

  assert.equal(addCachedSelectorPlaces(regions), CACHED_SELECTOR_PLACES.length);
  for (const definition of CACHED_SELECTOR_PLACES) {
    const place = regions.find((region) => region.id === `wikidata:${definition.qid}`);
    assert.equal(place?.parentId, definition.parentId);
    assert.equal(place?._settlementType, 'wikidata');
    assert.equal(place?.name.en, definition.nameEn);
    assert.notEqual(place?.location?.coordinates[1], null);
    assert.notEqual(place?.location?.coordinates[0], null);
  }
});

test('inline verified data wins over cache values', () => {
  const country = createRegion('PH', null, 'country', 'Philippines');
  const parent = createRegion('PH-00', 'PH', 'province', 'Metro Manila');
  const regions = [country, parent];

  assert.equal(
    addCachedSelectorPlaces(regions),
    CACHED_SELECTOR_PLACES.filter((d) => d.parentId === 'PH-00').length
  );
  const sanJuan = regions.find((region) => region.id === 'wikidata:Q749283');
  assert.equal(sanJuan?.name.en, 'San Juan');
  assert.deepEqual(sanJuan?.location?.coordinates, [121.03, 14.604]);
});

test('does not add a cached settlement without its configured parent', () => {
  const country = createRegion('AR', null, 'country', 'Argentina');

  assert.equal(addCachedSelectorPlaces([country]), 0);
});

test('every definition carries verified labels and coordinates', () => {
  for (const definition of CACHED_SELECTOR_PLACES) {
    assert.match(definition.qid, /^Q\d+$/);
    assert.ok(definition.nameEn.length > 0);
    assert.ok(Number.isFinite(definition.lon) && Number.isFinite(definition.lat));
    assert.ok(Math.abs(definition.lat) <= 90 && Math.abs(definition.lon) <= 180);
  }
});
