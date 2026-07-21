import type { PipelineRegion, GeoPoint } from './types.js';
import { cachedLabelsForQid } from './wikidata-cache.js';
import { createRegion } from './schema.js';

interface CachedPlaceDefinition {
  qid: string;
  countryId: string;
  parentId: string;
}

export const CACHED_SELECTOR_PLACES: CachedPlaceDefinition[] = [
  { qid: 'Q2321518', countryId: 'AR', parentId: 'AR-B' },
  { qid: 'Q162279', countryId: 'FI', parentId: 'FI-15' },
  { qid: 'Q6393223', countryId: 'MY', parentId: 'MY-14' },
  { qid: 'Q1098057', countryId: 'VN', parentId: 'VN-SG' },
  { qid: 'Q32005019', countryId: 'VN', parentId: 'VN-SG' }
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
    if (!cached?.name_en || cached.lat === null || cached.lon === null) continue;
    const r = createRegion(id, definition.parentId, 'city', cached.name_en);
    if (cached.name_cn) r.name.zh = cached.name_cn;
    if (cached.name_ja) r.name.ja = cached.name_ja;
    r._settlementType = 'wikidata';
    r._wikidataQid = definition.qid;
    r._enrichmentMatch = 'wikidata';
    r._nameSources = { en: 'wikidata', cn: 'wikidata', ja: 'wikidata' };
    r.location = point(cached.lon, cached.lat);
    regions.push(r);
    ids.add(id);
    added++;
  }
  return added;
}
