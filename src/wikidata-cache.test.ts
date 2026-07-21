import assert from 'node:assert/strict';
import test from 'node:test';
import type { PipelineRegion } from './types.js';
import { createRegion } from './schema.js';
import { enrichFromCache } from './wikidata-cache.js';

function addChineseName(region: PipelineRegion, name: string) {
  region.name.zh = name;
  return region;
}

test('P442 replaces stale China county metadata with the identified entity', () => {
  const china = addChineseName(createRegion('CN', null, 'country', 'China'), '中国');
  const beijing = addChineseName(createRegion('CN-11', 'CN', 'province', '北京市'), '北京市');
  const tongzhou = addChineseName(
    createRegion('CN-110112', 'CN-11', 'county', 'Tongzhou District'),
    '通州区'
  );
  tongzhou.location = { type: 'Point', coordinates: [121.07123, 32.08217] };

  assert.equal(enrichFromCache(tongzhou, [china, beijing, tongzhou]), true);
  assert.equal(tongzhou._wikidataQid, 'Q393836');
  assert.equal(tongzhou._enrichmentMatch, 'p442');
  assert.equal(tongzhou.location!.coordinates[1], 39.90858);
  assert.equal(tongzhou.location!.coordinates[0], 116.65133);
});

test('ambiguous special-region names remain source-only', () => {
  const china = addChineseName(createRegion('CN', null, 'country', 'China'), '中国');
  const taiwan = addChineseName(
    createRegion('CN-71', 'CN', 'province', 'Taiwan Province'),
    '台湾省'
  );
  const tainan = addChineseName(createRegion('CN-7105', 'CN-71', 'city', '台南市'), '台南市');
  const xinshi = addChineseName(createRegion('CN-710515', 'CN-7105', 'county', '新市区'), '新市区');

  assert.equal(enrichFromCache(xinshi, [china, taiwan, tainan, xinshi]), false);
  assert.equal(xinshi._wikidataQid, undefined);
  assert.equal(xinshi.location, null);
});

test('unique country-scoped names supplement missing city data', () => {
  const china = addChineseName(createRegion('CN', null, 'country', 'China'), '中国');
  const taiwan = addChineseName(
    createRegion('CN-71', 'CN', 'province', 'Taiwan Province'),
    '台湾省'
  );
  const taipei = addChineseName(createRegion('CN-7101', 'CN-71', 'city', '台北市'), '台北市');

  assert.equal(enrichFromCache(taipei, [china, taiwan, taipei]), true);
  assert.equal(taipei._wikidataQid, 'Q1867');
  assert.equal(taipei._enrichmentMatch, 'iso3166_2');
  assert.equal(taipei.name.en, 'Taipei');
  assert.equal(taipei.name.zh, '台北市');
  assert.equal(taipei.location!.coordinates[1], 25.0375);
  assert.equal(taipei.location!.coordinates[0], 121.5625);
});

test('preserves source country labels while supplementing identified metadata', () => {
  const netherlands = createRegion('NL', null, 'country', 'Netherlands');

  assert.equal(enrichFromCache(netherlands, [netherlands]), true);
  assert.equal(netherlands.name.en, 'Netherlands');
  assert.equal(netherlands._enrichmentMatch, 'iso2');
  assert.notEqual(netherlands.population, null);
});

test('rejects an upstream settlement QID that points to a distant different place', () => {
  const canada = createRegion('CA', null, 'country', 'Canada');
  const ontario = createRegion('CA-ON', 'CA', 'province', 'Ontario');
  const scarborough = createRegion('CA:17023', 'CA-ON', 'city', 'Scarborough');
  scarborough._settlementType = 'city';
  scarborough._wikidataQid = 'Q463165';
  scarborough.location = { type: 'Point', coordinates: [-79.25666, 43.77223] };

  assert.equal(enrichFromCache(scarborough, [canada, ontario, scarborough]), false);
  assert.equal(scarborough.name.en, 'Scarborough');
  assert.equal(scarborough._wikidataQid, undefined);
  assert.equal(scarborough.location!.coordinates[1], 43.77223);
  assert.equal(scarborough.location!.coordinates[0], -79.25666);
});

test('HMT provincial records use explicit, complete canonical entities', () => {
  const china = addChineseName(createRegion('CN', null, 'country', 'China'), '中国');
  const taiwan = addChineseName(createRegion('CN-71', 'CN', 'province', '台湾省'), '台湾省');
  const hongKong = addChineseName(
    createRegion('CN-81', 'CN', 'province', '香港特别行政区'),
    '香港特别行政区'
  );
  const macao = addChineseName(
    createRegion('CN-82', 'CN', 'province', '澳门特别行政区'),
    '澳门特别行政区'
  );

  for (const region of [taiwan, hongKong, macao]) {
    assert.equal(enrichFromCache(region, [china, taiwan, hongKong, macao]), true);
    assert.notEqual(region.population, null);
    assert.notEqual(region.area, null);
    assert.notEqual(region.location, null);
  }

  assert.equal(taiwan.name.en, 'Taiwan Province');
  assert.equal(hongKong.name.en, 'Hong Kong Special Administrative Region');
  assert.equal(macao.name.en, 'Macao Special Administrative Region');
});

test('Taiwan Tainan City resolves through its ISO 3166-2 identity', () => {
  const china = addChineseName(createRegion('CN', null, 'country', 'China'), '中国');
  const taiwan = addChineseName(
    createRegion('CN-71', 'CN', 'province', 'Taiwan Province'),
    '台湾省'
  );
  const tainan = addChineseName(createRegion('CN-7105', 'CN-71', 'city', '台南市'), '台南市');

  assert.equal(enrichFromCache(tainan, [china, taiwan, tainan]), true);
  assert.equal(tainan._wikidataQid, 'Q140631');
  assert.equal(tainan._enrichmentMatch, 'iso3166_2');
  assert.equal(tainan.name.en, 'Tainan');
  assert.equal(tainan.population, 1849762);
  assert.equal(tainan.location!.coordinates[1], 22.99);
  assert.equal(tainan.location!.coordinates[0], 120.185);
});
