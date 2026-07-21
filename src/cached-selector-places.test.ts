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
    assert.notEqual(place?.location?.coordinates[1], null);
    assert.notEqual(place?.location?.coordinates[0], null);
  }
});

test('does not add a cached settlement without its configured parent', () => {
  const country = createRegion('AR', null, 'country', 'Argentina');

  assert.equal(addCachedSelectorPlaces([country]), 0);
});
