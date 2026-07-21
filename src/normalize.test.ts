import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRegions } from './normalize.js';
import { createRegion } from './schema.js';

test('normalizes commas, Simplified Chinese, redundant children, and duplicate QIDs', () => {
  const country = createRegion('AA', null, 'country', 'Example, Country');
  country.name.zh = '範例國';
  country.name.ja = '例国';
  country._wikidataQid = 'Q1';
  country._enrichmentMatch = 'iso2';

  const state = createRegion('AA-1', 'AA', 'province', 'Example State');
  state.name.zh = '範例州';
  state.name.ja = '例州';
  const duplicate = createRegion('duplicate', 'AA', 'province', 'Duplicate');
  duplicate.name.zh = '重复';
  duplicate.name.ja = '重複';
  duplicate._wikidataQid = 'Q1';
  duplicate._enrichmentMatch = 'iso3166_2';
  const badQid = createRegion('AA:2', 'AA-1', 'city', 'Wrong Place');
  badQid.name.zh = '錯誤地點';
  badQid.name.ja = '誤った場所';
  badQid._wikidataQid = 'Q1';
  badQid._enrichmentMatch = 'wikidata';

  const result = normalizeRegions([country, state, duplicate, badQid]);

  assert.equal(country.name.en, 'Example · Country');
  assert.equal(country.name.zh, '范例国');
  assert.equal(
    result.regions.some((region) => region.id === duplicate.id),
    false
  );
  assert.equal(country._wikidataQid, 'Q1');
  assert.equal(badQid._wikidataQid, undefined);
  assert.equal(result.report.redundantChildrenRemoved, 1);
  assert.equal(result.report.duplicateWikidataIdsResolved, 1);
});

test('preserves a distinct settlement when only one locale repeats its parent label', () => {
  const country = createRegion('AA', null, 'country', 'Example');
  const state = createRegion('AA-1', 'AA', 'province', 'Example State');
  state.name.zh = '示例州';
  state.name.ja = '例州';
  const city = createRegion('AA:1', 'AA-1', 'city', 'Different English');
  city._settlementType = 'city';
  city.name.zh = '示例州';
  city.name.ja = '異なる日本語';

  const result = normalizeRegions([country, state, city]);

  assert.equal(
    result.regions.some((region) => region.id === city.id),
    true
  );
  assert.equal(city.name.zh, '示例州');
  assert.equal(city.name.ja, '異なる日本語');
});

test('removes an administrative county placeholder that repeats its parent locale', () => {
  const country = createRegion('CN', null, 'country', 'China');
  const city = createRegion('CN-4604', 'CN', 'city', 'Danzhou');
  city.name.zh = '儋州市';
  const placeholder = createRegion('CN-460400', 'CN-4604', 'county', 'Dan Zhou Shi');
  placeholder.name.zh = '儋州市';

  const result = normalizeRegions([country, city, placeholder]);

  assert.equal(
    result.regions.some((region) => region.id === placeholder.id),
    false
  );
});
test('preserves valid atomic names that contain a parent token', () => {
  const country = createRegion('US', null, 'country', 'United States');
  const state = createRegion('US-OK', 'US', 'province', 'Oklahoma');
  const city = createRegion('US:1', 'US-OK', 'city', 'Oklahoma City');

  const result = normalizeRegions([country, state, city]);

  assert.equal(
    result.regions.some((region) => region.id === city.id),
    true
  );
  assert.equal(city.name.en, 'Oklahoma City');
});
