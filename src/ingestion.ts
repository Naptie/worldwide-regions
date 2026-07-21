import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { gunzipSync } from 'node:zlib';
import type { PipelineRegion } from './types.js';
import { createRegion } from './schema.js';

// ── helpers ──
function point(lon: number, lat: number) {
  return { type: 'Point' as const, coordinates: [lon, lat] as [number, number] };
}

// ── URLs & cache paths ──
const MODOOD_BASE =
  'https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/master/dist';
const DR5HN_BASE =
  'https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json';
const DR5HN_CITIES_URL =
  'https://github.com/dr5hn/countries-states-cities-database/releases/latest/download/json-cities.json.gz';
const DR5HN_CITIES_CACHE = join(process.cwd(), 'data', 'source-cache', 'json-cities.json.gz');
const SOURCE_CACHE_DIR = join(process.cwd(), 'data', 'source-cache');
const MODOOD_CACHE = {
  provinces: join(SOURCE_CACHE_DIR, 'modood-provinces.json'),
  cities: join(SOURCE_CACHE_DIR, 'modood-cities.json'),
  areas: join(SOURCE_CACHE_DIR, 'modood-areas.json'),
  territories: join(SOURCE_CACHE_DIR, 'modood-hk-mo-tw.json')
};
const DR5HN_CACHE = {
  countries: join(SOURCE_CACHE_DIR, 'dr5hn-countries.json'),
  states: join(SOURCE_CACHE_DIR, 'dr5hn-states.json')
};

// ── dr5hn types ──
interface Dr5hnTranslations {
  'zh-CN'?: string;
  ja?: string;
  [lang: string]: string | undefined;
}
interface Dr5hnCity {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
  type?: string;
  native?: string;
  population?: number | null;
  translations?: Dr5hnTranslations;
  wikiDataId?: string;
  timezone?: string;
}
interface Dr5hnState {
  id: number;
  name: string;
  country_code: string;
  iso2: string;
  latitude?: string;
  longitude?: string;
  type?: string;
  translations?: Dr5hnTranslations;
}
interface Dr5hnCountry {
  name: string;
  iso2: string;
  population?: number;
  area_sq_km?: number | null;
  latitude?: string;
  longitude?: string;
  translations?: Dr5hnTranslations;
}
interface Dr5hnSettlement extends Dr5hnCity {
  state_id: number;
  state_code: string;
  country_code: string;
}

const EXCLUDED_SUBDIVISION_TYPES = new Set(['military postal region', 'geographical unit']);
const EXCLUDED_SETTLEMENT_TYPES = new Set([
  'county',
  'regency',
  'prefecture',
  'parish',
  'banner',
  'province',
  'area',
  'oblast',
  'administrative zone',
  'region',
  'abandoned',
  'historical',
  'destroyed',
  'religious',
  'historical_capital'
]);

export function isSelectableSettlementType(type: string | undefined): boolean {
  return type === undefined || !EXCLUDED_SETTLEMENT_TYPES.has(type.toLowerCase());
}

// ── fetch helpers ──
async function fetchJson<T>(url: string, cachePath: string, retries = 3): Promise<T> {
  const label = url.split('/').slice(-2).join('/');
  if (existsSync(cachePath)) {
    console.log(`  Loading cached ${label}...`);
    return JSON.parse(readFileSync(cachePath, 'utf-8')) as T;
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`  Fetching ${label}${attempt > 1 ? ` (attempt ${attempt})` : ''}...`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (e) {
      if (attempt === retries) throw e;
      console.warn(`  Retry ${attempt}/${retries} for ${label}`);
      await sleep(3000 * attempt);
    }
  }
  throw new Error('unreachable');
}

async function fetchGzipJson<T>(url: string, cachePath: string, retries = 3): Promise<T> {
  const label = url.split('/').slice(-2).join('/');
  if (existsSync(cachePath)) {
    console.log(`  Loading cached ${label}...`);
    return JSON.parse(gunzipSync(readFileSync(cachePath)).toString('utf-8')) as T;
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`  Fetching ${label}${attempt > 1 ? ` (attempt ${attempt})` : ''}...`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf-8')) as T;
    } catch (e) {
      if (attempt === retries) throw e;
      console.warn(`  Retry ${attempt}/${retries} for ${label}`);
      await sleep(3000 * attempt);
    }
  }
  throw new Error('unreachable');
}

function nbsParentId(code: string): string | null {
  const len = code.length;
  if (len <= 2) return 'CN';
  if (len <= 4) return `CN-${code.slice(0, 2)}`;
  return `CN-${code.slice(0, 4)}`;
}

// ── China ingestion ──
async function ingestChina(): Promise<PipelineRegion[]> {
  console.log('  Fetching China data from modood/Administrative-divisions-of-China...');
  type ModoodEntry = Record<string, { code: string; name: string }>;

  const [provinces, cities, areas, hkMoTw] = await Promise.all([
    fetchJson<ModoodEntry>(`${MODOOD_BASE}/provinces.json`, MODOOD_CACHE.provinces),
    fetchJson<ModoodEntry>(`${MODOOD_BASE}/cities.json`, MODOOD_CACHE.cities),
    fetchJson<ModoodEntry>(`${MODOOD_BASE}/areas.json`, MODOOD_CACHE.areas),
    fetchJson<Record<string, Record<string, string[]>>>(
      `${MODOOD_BASE}/HK-MO-TW.json`,
      MODOOD_CACHE.territories
    )
  ]);

  const regions: PipelineRegion[] = [];
  const china = createRegion('CN', null, 'country', 'China');
  china.name.zh = '中国';
  china.name.ja = '中国';
  regions.push(china);

  for (const entry of Object.values(provinces)) {
    const r = createRegion(`CN-${entry.code}`, 'CN', 'province', entry.name);
    r.name.zh = entry.name;
    regions.push(r);
  }
  for (const entry of Object.values(cities)) {
    const r = createRegion(`CN-${entry.code}`, nbsParentId(entry.code)!, 'city', entry.name);
    r.name.zh = entry.name;
    regions.push(r);
  }
  for (const entry of Object.values(areas)) {
    const r = createRegion(`CN-${entry.code}`, nbsParentId(entry.code)!, 'county', entry.name);
    r.name.zh = entry.name;
    regions.push(r);
  }

  const sarProvinceMap: Record<string, string> = {
    香港特别行政区: '81',
    澳门特别行政区: '82',
    台湾省: '71'
  };
  for (const [provName, provCode] of Object.entries(sarProvinceMap)) {
    const cityData = hkMoTw[provName];
    if (!cityData) continue;
    const provId = `CN-${provCode}`;
    if (!regions.some((r) => r.id === provId)) {
      const r = createRegion(provId, 'CN', 'province', provName);
      r.name.zh = provName;
      regions.push(r);
    }
    let cityIndex = 0;
    for (const [cityName, districts] of Object.entries(cityData)) {
      cityIndex++;
      const cityCode = `CN-${provCode}${String(cityIndex).padStart(2, '0')}`;
      if (!regions.some((r) => r.id === cityCode)) {
        const r = createRegion(cityCode, provId, 'city', cityName);
        r.name.zh = cityName;
        regions.push(r);
      }
      for (let i = 0; i < districts.length; i++) {
        const areaCode = `CN-${provCode}${String(cityIndex).padStart(2, '0')}${String(i + 1).padStart(2, '0')}`;
        if (!regions.some((r) => r.id === areaCode)) {
          const r = createRegion(areaCode, cityCode, 'county', districts[i]);
          r.name.zh = districts[i];
          regions.push(r);
        }
      }
    }
  }

  const PLACEHOLDER_NAMES = new Set(['市辖区', '县']);
  const placeholderIds = regions.filter((r) => PLACEHOLDER_NAMES.has(r.name.en)).map((r) => r.id);
  for (const pid of placeholderIds) {
    const placeholder = regions.find((r) => r.id === pid);
    if (!placeholder) continue;
    for (const r of regions) {
      if (r.parentId === pid) r.parentId = placeholder.parentId;
    }
  }
  const filtered = regions.filter((r) => !PLACEHOLDER_NAMES.has(r.name.en));
  regions.length = 0;
  regions.push(...filtered);

  console.log(
    `  China: 1 country + ${regions.filter((r) => r.level === 'province').length} provinces + ${regions.filter((r) => r.level === 'city').length} cities + ${regions.filter((r) => r.level === 'county').length} counties = ${regions.length} total`
  );
  return regions;
}

// ── RoW ingestion ──
async function ingestRestOfWorld(): Promise<PipelineRegion[]> {
  console.log('  Fetching RoW data from dr5hn/countries-states-cities-database...');
  const [countries, states, settlements] = await Promise.all([
    fetchJson<Dr5hnCountry[]>(`${DR5HN_BASE}/countries.json`, DR5HN_CACHE.countries),
    fetchJson<Dr5hnState[]>(`${DR5HN_BASE}/states.json`, DR5HN_CACHE.states),
    fetchGzipJson<Dr5hnSettlement[]>(DR5HN_CITIES_URL, DR5HN_CITIES_CACHE)
  ]);

  const regions: PipelineRegion[] = [];
  const stateIdBySourceId = new Map<number, string>();
  for (const country of countries) {
    const r = createRegion(country.iso2, null, 'country', country.name);
    if (country.translations?.['zh-CN']) r.name.zh = country.translations['zh-CN'];
    if (country.translations?.ja) r.name.ja = country.translations.ja;
    if (country.population) r.population = country.population;
    if (country.area_sq_km && country.area_sq_km > 0) r.area = country.area_sq_km;
    if (country.latitude && country.longitude)
      r.location = point(parseFloat(country.longitude), parseFloat(country.latitude));
    regions.push(r);
  }

  for (const state of states) {
    if (state.type && EXCLUDED_SUBDIVISION_TYPES.has(state.type.toLowerCase())) continue;
    const stateId = `${state.country_code}-${state.iso2}`;
    stateIdBySourceId.set(state.id, stateId);
    const r = createRegion(stateId, state.country_code, 'province', state.name);
    if (state.type) r._adminType = state.type;
    if (state.translations?.['zh-CN']) r.name.zh = state.translations['zh-CN'];
    if (state.translations?.ja) r.name.ja = state.translations.ja;
    if (state.latitude && state.longitude)
      r.location = point(parseFloat(state.longitude), parseFloat(state.latitude));
    regions.push(r);
  }

  let excludedSettlements = 0;
  for (const settlement of settlements) {
    const parentId = stateIdBySourceId.get(settlement.state_id);
    const type = settlement.type?.toLowerCase();
    const lat = Number(settlement.latitude);
    const lon = Number(settlement.longitude);
    if (
      !parentId ||
      !isSelectableSettlementType(type) ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      excludedSettlements++;
      continue;
    }
    const r = createRegion(
      `${settlement.country_code}:${settlement.id}`,
      parentId,
      'city',
      settlement.name
    );
    r._settlementType = settlement.type ?? 'unclassified';
    if (settlement.translations?.['zh-CN']) r.name.zh = settlement.translations['zh-CN'];
    if (settlement.translations?.ja) r.name.ja = settlement.translations.ja;
    if (settlement.native && settlement.native.toLowerCase() !== settlement.name.toLowerCase())
      r.name.native = settlement.native;
    for (const [locale, value] of Object.entries(settlement.translations ?? {})) {
      if (!value || locale === 'zh-CN' || locale === 'ja') continue;
      const key = locale.split('-')[0].toLowerCase();
      if (key !== 'en' && !r.name[key]) r.name[key] = value;
    }
    if (settlement.population != null && settlement.population > 0)
      r.population = settlement.population;
    r.location = point(lon, lat);
    if (settlement.wikiDataId) r._wikidataQid = settlement.wikiDataId;
    regions.push(r);
  }

  console.log(
    `  RoW: ${countries.length} countries, ${settlements.length - excludedSettlements} settlements, ${excludedSettlements} source records excluded`
  );
  return regions;
}

// ── Sample mode & entry point ──
export const SAMPLE_COUNTRIES = [
  'CN',
  'US',
  'JP',
  'DE',
  'FR',
  'BR',
  'IN',
  'NG',
  'AU',
  'EG',
  'RU',
  'MX',
  'ZA',
  'KR',
  'TR',
  'SA',
  'IR',
  'TH',
  'VN',
  'PH',
  'GB',
  'IT',
  'ES',
  'CA',
  'AR',
  'CO',
  'KE',
  'ET',
  'TZ',
  'PL'
];
const SAMPLE_SET = new Set(SAMPLE_COUNTRIES);

export async function ingestAll(
  sample = false
): Promise<{ china: PipelineRegion[]; row: PipelineRegion[] }> {
  console.log(`[Ingestion] Starting data fetch${sample ? ' (SAMPLE MODE — 30 countries)' : ''}...`);
  const china = await ingestChina();
  let row = await ingestRestOfWorld();
  if (sample)
    row = row.filter((r) =>
      r.id.length <= 2 ? SAMPLE_SET.has(r.id) : SAMPLE_SET.has(r.id.split(/[-:]/)[0])
    );
  console.log(
    `[Ingestion] Complete: ${china.length} CN + ${row.length} RoW = ${china.length + row.length} regions`
  );
  return { china, row };
}
