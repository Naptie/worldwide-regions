import type { PipelineRegion, GeoPoint } from './types.js';
import { cachedLabelsForQid } from './wikidata-cache.js';
import { createRegion } from './schema.js';

interface CachedPlaceDefinition {
  qid: string;
  countryId: string;
  parentId: string;
  /**
   * Verified labels and coordinates captured from the Wikidata entity. The
   * weekly cache build is the supplement, never the source of truth: its
   * per-country settlement queries can fail (US entries were missing from the
   * 2026-09-28 build) and reclassifications silently drop entities (the
   * 2026-09 releases lost Q1098057). Inline data keeps these places — and
   * their region IDs — stable across releases.
   */
  nameEn: string;
  nameZh?: string;
  nameJa?: string;
  lon: number;
  lat: number;
  population?: number;
}

export const CACHED_SELECTOR_PLACES: CachedPlaceDefinition[] = [
  {
    qid: 'Q2321518',
    countryId: 'AR',
    parentId: 'AR-B',
    nameEn: 'Mar del Tuyú',
    lon: -56.691666666667,
    lat: -36.580555555556,
    population: 8070
  },
  {
    qid: 'Q162279',
    countryId: 'FI',
    parentId: 'FI-15',
    nameEn: 'Kuopio',
    nameZh: '库奥皮奥',
    nameJa: 'クオピオ',
    lon: 27.678333333333,
    lat: 62.8925,
    population: 126572
  },
  {
    qid: 'Q6393223',
    countryId: 'MY',
    parentId: 'MY-14',
    nameEn: 'Kepong',
    nameZh: '甲洞',
    nameJa: 'ケポン',
    lon: 101.63891667,
    lat: 3.21422222
  },
  {
    qid: 'Q1098057',
    countryId: 'VN',
    parentId: 'VN-SG',
    nameEn: 'Thuận An',
    nameZh: '顺安市',
    nameJa: 'トゥアンアン',
    lon: 106.69944444444444,
    lat: 10.905,
    population: 618984
  },
  {
    qid: 'Q32005019',
    countryId: 'VN',
    parentId: 'VN-SG',
    nameEn: 'Thủ Đức',
    nameZh: '守德市',
    lon: 106.7241106676243,
    lat: 10.864906308390243,
    population: 1013795
  },
  // ── Places nearcade shops actually reference (addr-audit §D3) ──────────
  {
    // City of San Juan, Metro Manila (Greenhills area) — handoff §A/§D3
    qid: 'Q749283',
    countryId: 'PH',
    parentId: 'PH-00',
    nameEn: 'San Juan',
    nameZh: '仙范市',
    nameJa: 'サンフアン市',
    lon: 121.03,
    lat: 14.604
  },
  {
    qid: 'Q487988',
    countryId: 'US',
    parentId: 'US-FL',
    nameEn: 'St. Augustine',
    nameZh: '圣奥古斯丁',
    nameJa: 'セイント・オーガスティン',
    lon: -81.314444444444,
    lat: 29.894722222222
  },
  {
    qid: 'Q2151661',
    countryId: 'US',
    parentId: 'US-MN',
    nameEn: 'Tower',
    nameZh: '陶尔',
    lon: -92.274722222222,
    lat: 47.805555555556
  },
  {
    qid: 'Q2276683',
    countryId: 'US',
    parentId: 'US-CO',
    nameEn: 'Ignacio',
    nameZh: '伊格纳西奥',
    lon: -107.635,
    lat: 37.1167
  },
  {
    // Warrington Township, Bucks County (the zh label on the entity is a long
    // disambiguated form — intentionally not mirrored here)
    qid: 'Q1896572',
    countryId: 'US',
    parentId: 'US-PA',
    nameEn: 'Warrington Township',
    lon: -75.1417,
    lat: 40.2397
  },
  {
    // City of San Juan, Hidalgo County, TX
    qid: 'Q581862',
    countryId: 'US',
    parentId: 'US-TX',
    nameEn: 'San Juan',
    nameZh: '圣胡安',
    nameJa: 'サン・フアン',
    lon: -98.1528,
    lat: 26.1925
  },
  {
    // Ibafo, Obafemi-Owode, Ogun State — no dr5hn record; entity is a
    // GeoNames import (P1566 = 2339349)
    qid: 'Q60193463',
    countryId: 'NG',
    parentId: 'NG-OG',
    nameEn: 'Ibafo',
    lon: 3.42187,
    lat: 6.74244
  }
];

function point(lon: number, lat: number): GeoPoint {
  return { type: 'Point', coordinates: [lon, lat] };
}

/** Add known populated places present in the cache but absent from the primary settlement feed. */
export function addCachedSelectorPlaces(regions: PipelineRegion[]): number {
  const ids = new Set(regions.map((region) => region.id));
  let added = 0;
  for (const definition of CACHED_SELECTOR_PLACES) {
    const id = `wikidata:${definition.qid}`;
    if (ids.has(id) || !ids.has(definition.parentId)) continue;
    const cached = cachedLabelsForQid(definition.qid);
    const r = createRegion(id, definition.parentId, 'city', definition.nameEn);
    const nameZh = definition.nameZh ?? cached?.name_cn ?? null;
    const nameJa = definition.nameJa ?? cached?.name_ja ?? null;
    if (nameZh) r.name.zh = nameZh;
    if (nameJa) r.name.ja = nameJa;
    r._settlementType = 'wikidata';
    r._wikidataQid = definition.qid;
    r._enrichmentMatch = 'wikidata';
    r._nameSources = {
      en: 'wikidata',
      ...(nameZh ? { cn: 'wikidata' } : {}),
      ...(nameJa ? { ja: 'wikidata' } : {})
    };
    r.location = point(definition.lon, definition.lat);
    if (definition.population != null) r.population = definition.population;
    regions.push(r);
    ids.add(id);
    added++;
  }
  return added;
}
