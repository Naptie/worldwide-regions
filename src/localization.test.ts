import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeChinaLocalization,
  hasValidChineseDisplayName,
  hasValidJapaneseDisplayName
} from './localization.js';
import { createRegion } from './schema.js';

test('completes mainland labels with provenance-tagged deterministic fallbacks', () => {
  const china = createRegion('CN', null, 'country', 'China');
  china.name.zh = '中国';
  china.name.ja = '中国';
  const province = createRegion('CN-34', 'CN', 'province', '安徽省');
  province.name.zh = '安徽省';
  const district = createRegion('CN-340178', 'CN-34', 'county', '合肥新站高新技术产业开发区');
  district.name.zh = '合肥新站高新技术产业开发区';

  const report = completeChinaLocalization([china, province, district]);

  assert.equal(report.total, 3);
  assert.equal(report.fallbackEnglish, 2);
  assert.equal(report.fallbackJapanese, 2);
  assert.equal(province.name.en, 'An Hui Sheng');
  assert.equal(province._nameSources?.en, 'hanyu-pinyin-fallback');
  assert.equal(district.name.ja, '合肥新站高新技術産業開発区');
  assert.equal(district._nameSources?.ja, 'opencc-japanese-fallback');
  assert.equal(hasValidChineseDisplayName(district.name.zh), true);
  assert.equal(hasValidJapaneseDisplayName(district.name.ja), true);
});

test('preserves identified Wikidata labels', () => {
  const china = createRegion('CN', null, 'country', 'China');
  china.name.zh = '中国';
  china.name.ja = '中国';
  const tongzhou = createRegion('CN-110112', 'CN', 'county', 'Tongzhou District');
  tongzhou.name.zh = '通州区';
  tongzhou.name.ja = '通州区';
  tongzhou._wikidataQid = 'Q393836';

  completeChinaLocalization([china, tongzhou]);

  assert.equal(tongzhou.name.en, 'Tongzhou District');
  assert.equal(tongzhou.name.ja, '通州区');
});

test('uses territory-crawled canonical labels instead of pinyin', () => {
  const china = createRegion('CN', null, 'country', 'China');
  china.name.zh = '中国';
  china.name.ja = '中国';
  const hongKong = createRegion(
    'CN-81',
    'CN',
    'province',
    'Hong Kong Special Administrative Region'
  );
  hongKong.name.zh = '香港特别行政区';
  hongKong.name.ja = '香港特別行政区';
  const newTerritories = createRegion('CN-8103', 'CN-81', 'city', '新界');
  newTerritories.name.zh = '新界';

  completeChinaLocalization([china, hongKong, newTerritories]);

  assert.equal(newTerritories.name.en, 'New Territories');
  assert.equal(newTerritories._wikidataQid, 'Q596660');
  assert.equal(newTerritories._nameSources?.en, 'wikidata-territory-crawl');
});
