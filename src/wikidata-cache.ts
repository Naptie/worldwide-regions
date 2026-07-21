import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyHmtDisplayName, hmtEntityFor, taiwanP300For } from './region-policy.js';
import type { PipelineRegion, Region } from './types.js';

interface CachedEntity {
  qid: string;
  p442?: string;
  iso2?: string;
  p300?: string;
  name_en: string | null;
  name_cn: string | null;
  name_ja: string | null;
  population: number | null;
  area_sqkm: number | null;
  lat: number | null;
  lon: number | null;
  country_qid: string | null;
}

interface CacheData {
  built: string;
  entityCount: number;
  byQid: Record<string, CachedEntity>;
  byP442: Record<string, string>;
  byIso2: Record<string, string>;
  byP300: Record<string, string>;
  byNameEn: Record<string, string[]>;
  byNameCn: Record<string, string[]>;
}

const CACHE_PATH = join(process.cwd(), 'data', 'wikidata-cache.json');
let _cache: CacheData | null = null;
const REGION_BY_ID = new WeakMap<Region[], Map<string, Region>>();

function regionById(allRegions: Region[]): Map<string, Region> {
  let index = REGION_BY_ID.get(allRegions);
  if (!index) {
    index = new Map(allRegions.map((region) => [region.id, region]));
    REGION_BY_ID.set(allRegions, index);
  }
  return index;
}

function loadCache(): CacheData | null {
  if (_cache) return _cache;
  if (!existsSync(CACHE_PATH)) return null;
  console.log(`[Wikidata] Loading cache from ${CACHE_PATH}...`);
  _cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as CacheData;
  console.log(`[Wikidata] Cache loaded: ${_cache.entityCount} entities (built ${_cache.built})`);
  return _cache;
}

function entityByP442(code: string): CachedEntity | null {
  const c = loadCache();
  if (!c) return null;
  const qid = c.byP442[code];
  return qid ? c.byQid[qid] : null;
}
function entityByIso2(iso2: string): CachedEntity | null {
  const c = loadCache();
  if (!c) return null;
  const qid = c.byIso2[iso2];
  return qid ? c.byQid[qid] : null;
}
function entityByP300(iso31662: string): CachedEntity | null {
  const c = loadCache();
  if (!c) return null;
  const qid = c.byP300[iso31662];
  return qid ? c.byQid[qid] : null;
}

function entitiesByName(
  index: Record<string, string[]>,
  name: string,
  countryQid: string | null
): CachedEntity[] {
  const cache = loadCache();
  if (!cache || !countryQid) return [];
  const qids = index[name] ?? [];
  return qids
    .map((qid) => cache.byQid[qid])
    .filter((entity): entity is CachedEntity => entity?.country_qid === countryQid);
}

function nbsToP442(id: string): string | null {
  if (!id.startsWith('CN-')) return null;
  const code = id.slice(3);
  if (code.length === 2) return code;
  if (code.length === 4) return `${code.slice(0, 2)} ${code.slice(2, 4)}`;
  if (code.length === 6) return `${code.slice(0, 2)} ${code.slice(2, 4)} ${code.slice(4, 6)}`;
  return null;
}

function applyEntity(region: PipelineRegion, entity: CachedEntity, replaceExisting: boolean): void {
  region._wikidataQid = entity.qid;
  if (entity.name_en && (replaceExisting || !region.name.en)) region.name.en = entity.name_en;
  if (entity.name_cn && (replaceExisting || !region.name.zh)) region.name.zh = entity.name_cn;
  if (entity.name_ja && (replaceExisting || !region.name.ja)) region.name.ja = entity.name_ja;
  if (entity.population != null && (replaceExisting || region.population === null))
    region.population = entity.population;
  if (entity.area_sqkm != null && (replaceExisting || region.area === null))
    region.area = entity.area_sqkm;
  if (entity.lat != null && entity.lon != null && (replaceExisting || region.location === null)) {
    region.location = { type: 'Point', coordinates: [entity.lon, entity.lat] };
  }
}

const COUNTRY_QID_BY_TOP_LEVEL_REGION: Record<string, string> = {
  'CN-71': 'Q865',
  'CN-81': 'Q8646',
  'CN-82': 'Q14773'
};

function countryQidFor(region: Region, allRegions: Region[]): string | null {
  const index = regionById(allRegions);
  let current: Region | undefined = region;
  for (let depth = 0; current && depth < 5; depth++) {
    const specialCountryQid = COUNTRY_QID_BY_TOP_LEVEL_REGION[current.id];
    if (specialCountryQid) return specialCountryQid;
    if (current.level === 'country') return entityByIso2(current.id)?.qid ?? null;
    current = current.parentId ? index.get(current.parentId) : undefined;
  }
  return null;
}
function normalizeIdentityName(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[\p{P}\p{Z}\p{S}]/gu, '');
}

function namesAgree(region: Region, entity: CachedEntity): boolean {
  return (
    (region.name.zh != null &&
      entity.name_cn !== null &&
      normalizeIdentityName(region.name.zh) === normalizeIdentityName(entity.name_cn)) ||
    (region.name.ja != null &&
      entity.name_ja !== null &&
      normalizeIdentityName(region.name.ja) === normalizeIdentityName(entity.name_ja)) ||
    (entity.name_en !== null &&
      normalizeIdentityName(region.name.en) === normalizeIdentityName(entity.name_en))
  );
}

function distanceKm(region: Region, entity: CachedEntity): number | null {
  if (region.location === null || entity.lat === null || entity.lon === null) return null;
  const [regionLon, regionLat] = region.location.coordinates;
  const radians = Math.PI / 180;
  const latitudeDelta = (entity.lat - regionLat) * radians;
  const longitudeDelta = (entity.lon - regionLon) * radians;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(regionLat * radians) *
      Math.cos(entity.lat * radians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPlausibleSettlementIdentity(
  region: Region,
  entity: CachedEntity,
  countryQid: string | null
): boolean {
  if (!countryQid || entity.country_qid !== countryQid) return false;
  const distance = distanceKm(region, entity);
  if (distance !== null && distance <= 5) return true;
  return namesAgree(region, entity) && (distance === null || distance <= 100);
}

type EnrichmentMatch = NonNullable<PipelineRegion['_enrichmentMatch']>;

function applyIdentifiedEntity(
  region: PipelineRegion,
  entity: CachedEntity,
  match: EnrichmentMatch
): void {
  applyEntity(region, entity, true);
  region._enrichmentMatch = match;
}

function applySupplementalEntity(region: PipelineRegion, entity: CachedEntity): void {
  region._wikidataQid = entity.qid;
  if (entity.name_en && !region.name.en) region.name.en = entity.name_en;
  if (entity.name_cn && !region.name.zh) region.name.zh = entity.name_cn;
  if (entity.name_ja && !region.name.ja) region.name.ja = entity.name_ja;
  if (entity.lat != null && entity.lon != null && region.location === null) {
    region.location = { type: 'Point', coordinates: [entity.lon, entity.lat] };
  }
  if (entity.name_en && region.name.en === region.name.zh) region.name.en = entity.name_en;
  region._enrichmentMatch = 'unique-country-name';
}

export function enrichFromCache(region: PipelineRegion, allRegions: Region[] = []): boolean {
  const cache = loadCache();
  if (!cache) return false;

  const countryQid = countryQidFor(region, allRegions);

  // Stable identifiers are the only enrichment methods allowed to replace source values.
  if (region.level === 'country') {
    const entity = entityByIso2(region.id);
    if (!entity) return false;
    applyEntity(region, entity, false);
    region._enrichmentMatch = 'iso2';
    return true;
  }

  const hmtEntity = hmtEntityFor(region);
  if (hmtEntity) {
    const entity = cache.byQid[hmtEntity.qid];
    if (!entity) return false;
    applyIdentifiedEntity(region, entity, 'p442');
    applyHmtDisplayName(region);
    return true;
  }

  const taiwanP300 = taiwanP300For(region);
  if (taiwanP300) {
    const entity = entityByP300(taiwanP300);
    if (!entity) return false;
    applyIdentifiedEntity(region, entity, 'iso3166_2');
    return true;
  }

  const p442 = countryQid === 'Q148' ? nbsToP442(region.id) : null;
  const p442Entity = p442 ? entityByP442(p442) : null;
  if (p442Entity && namesAgree(region, p442Entity)) {
    applyIdentifiedEntity(region, p442Entity, 'p442');
    return true;
  }

  if (region.level === 'province' && region.id.includes('-')) {
    const entity = entityByP300(region.id);
    if (entity) {
      applyIdentifiedEntity(region, entity, 'iso3166_2');
      return true;
    }
  }

  // Upstream settlement QIDs are advisory: accept them only when the cached entity agrees
  // with the source country and either its names or its coordinates. A rejected QID must
  // not overwrite the source place; the country-scoped name resolver still gets a chance.
  if (region._wikidataQid) {
    const entity = cache.byQid[region._wikidataQid];
    if (!entity) delete region._wikidataQid;
    else if (isPlausibleSettlementIdentity(region, entity, countryQid)) {
      applyEntity(region, entity, false);
      region._enrichmentMatch = 'wikidata';
      return true;
    } else delete region._wikidataQid;
  }

  // The cache's fallback corpus contains settlements. It may supplement city records only;
  // counties and special administrative units require an authoritative identifier mapping.
  if (region.level !== 'city') return false;

  const cnCandidates = region.name.zh
    ? entitiesByName(cache.byNameCn, region.name.zh, countryQid)
    : [];
  const enCandidates = entitiesByName(cache.byNameEn, region.name.en.toLowerCase(), countryQid);
  const candidates = new Map(
    [...cnCandidates, ...enCandidates].map((entity) => [entity.qid, entity])
  );
  if (candidates.size !== 1) return false;

  applySupplementalEntity(region, [...candidates.values()][0]);
  return true;
}

export function cachedLabelsForQid(qid: string): {
  name_en: string | null;
  name_cn: string | null;
  name_ja: string | null;
  lat: number | null;
  lon: number | null;
} | null {
  const entity = loadCache()?.byQid[qid];
  if (!entity) return null;
  return {
    name_en: entity.name_en,
    name_cn: entity.name_cn,
    name_ja: entity.name_ja,
    lat: entity.lat,
    lon: entity.lon
  };
}

export function isCacheAvailable(): boolean {
  return existsSync(CACHE_PATH);
}
