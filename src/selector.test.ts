import assert from 'node:assert/strict';
import test from 'node:test';
import { isSelectableSettlementType } from './ingestion.js';
import { createRegion } from './schema.js';
import { createSelectorRegions } from './selector.js';
import { countryNameForms, levenshteinSimilarity, placeNameForms } from './place-name-matching.js';

test('excludes administrative-only and defunct settlement source types', () => {
  for (const type of ['county', 'prefecture', 'historical', 'religious']) {
    assert.equal(isSelectableSettlementType(type), false);
  }
  for (const type of ['city', 'adm2', 'town', undefined]) {
    assert.equal(isSelectableSettlementType(type), true);
  }
});

test('normalizes ordinary place qualifiers and political country names without aliases', () => {
  assert.equal(placeNameForms('성남시 (Seongnam-si)').has('seongnam'), true);
  assert.equal(placeNameForms('Haymarket, Sydney').has('haymarket'), true);
  assert.equal(placeNameForms('Miyagi-ken').has('miyagi'), true);
  assert.equal(countryNameForms('United States of America').has('america'), true);
  assert.equal(countryNameForms("People's Republic of China").has('china'), true);
  assert.equal(countryNameForms('Kingdom of the Netherlands').has('netherlands'), true);
  assert.equal(countryNameForms('United States').has('unitedstates'), true);
  assert.equal(countryNameForms('Myanmar (Burma)').has('myanmar'), true);
  assert.equal(levenshteinSimilarity('gwangin', 'gwangjin') >= 0.87, true);
});

test('keeps authoritative China districts while excluding foreign county records', () => {
  const country = createRegion('US', null, 'country', 'United States');
  const state = createRegion('US-CA', 'US', 'province', 'California');
  const losAngeles = createRegion('US:1', 'US-CA', 'city', 'Los Angeles');
  losAngeles._settlementType = 'city';
  losAngeles.population = 3_822_238;
  const county = createRegion('US:2', 'US-CA', 'city', 'Los Angeles County');
  const china = createRegion('CN', null, 'country', 'China');
  const beijing = createRegion('CN-11', 'CN', 'province', '北京市');
  const beijingCity = createRegion('CN-1101', 'CN-11', 'city', '北京市');
  const beijingDistrict = createRegion('CN-110101', 'CN-1101', 'county', '东城区');

  const selector = createSelectorRegions([
    country,
    state,
    losAngeles,
    county,
    china,
    beijing,
    beijingCity,
    beijingDistrict
  ]);

  assert.deepEqual(
    new Set(selector.map((region) => region.id)),
    new Set(['CN', 'US', 'CN-11', 'US-CA', 'CN-1101', 'CN-110101', 'US:1'])
  );
  assert.equal(selector.find((region) => region.id === 'US:1')?.kind, 'settlement');
  assert.equal(selector.find((region) => region.id === 'CN-110101')?.kind, 'district');
  assert.equal(
    selector.some((region) => region.id === 'US:2'),
    false
  );
});

test('ranks settlements by known population then name', () => {
  const country = createRegion('US', null, 'country', 'United States');
  const state = createRegion('US-CA', 'US', 'province', 'California');
  const alpha = createRegion('US:1', 'US-CA', 'city', 'Alpha');
  alpha._settlementType = 'city';
  alpha.population = 10;
  const beta = createRegion('US:2', 'US-CA', 'city', 'Beta');
  beta._settlementType = 'town';
  beta.population = 20;

  const selector = createSelectorRegions([country, state, alpha, beta]);
  assert.deepEqual(
    selector.slice(-2).map((region) => region.name.en),
    ['Beta', 'Alpha']
  );
});
