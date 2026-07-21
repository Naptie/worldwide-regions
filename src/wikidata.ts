/**
 * Phase 3: Wikidata Dictionary Enrichment
 *
 * Enrichment scope:
 * - Countries (~246): via ISO2 (P297) → batch SPARQL
 * - CN provinces (~34): via P442 raw code (e.g., "11")
 * - CN municipality counties (~86): via P442 space-separated code (e.g., "11 01 01")
 * - RoW provinces: skipped (dr5hn provides zh-CN/ja translations inline)
 *
 * Population strategy:
 * Wikidata has multiple P1082 (population) statements per entity, mostly NormalRank.
 * We fetch ALL statements with P585 (point in time) dates, then pick the most recent.
 *
 * Rate-limit: POST to WDQS, 800ms delay between batches of 50.
 */
import type {
  PipelineRegion as Region,
  SparqlResult,
  SparqlBinding,
  WikidataEnrichment
} from './types.js';
import { enrichFromCache, isCacheAvailable } from './wikidata-cache.js';

const WDQS_ENDPOINT = 'https://query.wikidata.org/sparql';
const BATCH_SIZE = 20;
const DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;

// ── Public API ────────────────────────────────────────────────────

export async function enrichRegions(regions: Region[]): Promise<Region[]> {
  // ── Fast path: use pre-built cache ───────────────────────────

  if (isCacheAvailable()) {
    console.log('[Wikidata] Using pre-built cache for enrichment...');
    let enriched = 0;
    for (const region of regions) {
      if (enrichFromCache(region, regions)) enriched++;
    }
    console.log(`[Wikidata] Enriched ${enriched}/${regions.length} regions from cache`);
    return regions;
  }

  // ── Slow path: live WDQS queries ─────────────────────────────
  console.log('[Wikidata] No cache found — falling back to live WDQS queries...');
  console.log('[Wikidata] Tip: run `npx tsx scripts/build-wikidata-cache.ts` to build the cache');

  const countries = regions.filter((r) => r.level === 'country');
  const cnProvinces = regions.filter((r) => r.level === 'province' && r.parentId === 'CN');
  const cnCounties = regions.filter((r) => r.level === 'county' && isDescendantOfCN(r, regions));

  console.log(
    `[Wikidata] Targets: ${countries.length} countries, ${cnProvinces.length} CN provinces, ${cnCounties.length} CN counties`
  );

  await enrichCountries(countries);
  await enrichChinaCountry(countries.find((r) => r.id === 'CN'));

  const cnProvQidMap = await resolveCNQids(cnProvinces, 'province');
  console.log(`[Wikidata] Resolved ${cnProvQidMap.size}/${cnProvinces.length} CN province Q-IDs`);
  await enrichFromQidMap(cnProvQidMap, cnProvinces);

  await enrichCNCountiesByName(cnCounties, cnProvQidMap, regions);

  return regions;
}

// ── SPARQL Templates ─────────────────────────────────────────────

/** Core enrichment SELECT clause — NO rank filter, includes popDate for dedup. */
const ENRICH_SELECT = `?enLabel ?zhLabel ?jaLabel ?pop ?popDate ?area ?areaUnit ?coord`;

/** Core enrichment OPTIONAL blocks (labels + population + area + coord). */
const ENRICH_OPTIONALS = `
  OPTIONAL { ?item rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
  OPTIONAL { ?item rdfs:label ?zhLabel . FILTER(LANG(?zhLabel) = "zh" || LANG(?zhLabel) = "zh-hans") }
  OPTIONAL { ?item rdfs:label ?jaLabel . FILTER(LANG(?jaLabel) = "ja") }
  OPTIONAL {
    ?item p:P1082 ?popStmt .
    ?popStmt ps:P1082 ?pop .
    OPTIONAL { ?popStmt pq:P585 ?popDate . }
  }
  OPTIONAL {
    ?item p:P2046 ?areaStmt .
    ?areaStmt ps:P2046 ?area .
    OPTIONAL { ?areaStmt psv:P2046 ?areaVal . ?areaVal wikibase:quantityUnit ?areaUnit . }
  }
  OPTIONAL { ?item wdt:P625 ?coord . }
`;

// ── Country Enrichment ────────────────────────────────────────────

async function enrichCountries(countries: Region[]): Promise<void> {
  console.log(`[Wikidata] Enriching ${countries.length} countries...`);
  let count = 0;

  for (let i = 0; i < countries.length; i += BATCH_SIZE) {
    const batch = countries.slice(i, i + BATCH_SIZE);
    const isoCodes = batch.map((c) => `"${c.id}"`).join(', ');

    const sparql = `
      SELECT ?item ?iso ${ENRICH_SELECT} WHERE {
        ?item wdt:P297 ?iso .
        FILTER(?iso IN (${isoCodes}))
        ${ENRICH_OPTIONALS}
      }
    `;

    try {
      const data = await querySparql(sparql);
      const grouped = groupByEntity(data, 'iso');
      for (const [iso, bindings] of grouped) {
        const region = batch.find((r) => r.id === iso);
        if (!region) continue;
        applyBestBinding(region, bindings);
        count++;
      }
    } catch (e) {
      console.warn(`[Wikidata] Country batch ${i}-${i + batch.length} failed: ${e}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`[Wikidata] Enriched ${count} countries`);
}

// ── Explicit China Enrichment (Q148) ──────────────────────────────

async function enrichChinaCountry(cn: Region | undefined): Promise<void> {
  if (!cn) return;

  const sparql = `
    SELECT ${ENRICH_SELECT} WHERE {
      VALUES ?item { wd:Q148 }
      ${ENRICH_OPTIONALS}
    }
  `;

  try {
    const data = await querySparql(sparql);
    if (data.results.bindings.length > 0) {
      applyBestBinding(cn, data.results.bindings);
      console.log('[Wikidata] Enriched China (Q148) explicitly');
    }
  } catch (e) {
    console.warn(`[Wikidata] China explicit enrichment failed: ${e}`);
  }
}

// ── CN Entity Q-ID Resolution (P442) ──────────────────────────────

function nbsToP442(code: string, kind: 'province' | 'county'): string | null {
  if (kind === 'province') return code;
  if (kind === 'county' && code.length === 6) {
    return `${code.slice(0, 2)} ${code.slice(2, 4)} ${code.slice(4, 6)}`;
  }
  return null;
}

async function resolveCNQids(
  cnRegions: Region[],
  kind: 'province' | 'county'
): Promise<Map<string, string>> {
  const qidMap = new Map<string, string>();
  const entries: { region: Region; p442: string }[] = [];
  for (const r of cnRegions) {
    const p442 = nbsToP442(r.id, kind);
    if (p442) entries.push({ region: r, p442 });
  }

  console.log(`[Wikidata] Resolving ${entries.length} CN ${kind} Q-IDs via P442...`);

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const values = batch.map((e) => `"${e.p442}"`).join(', ');

    const sparql = `
      SELECT ?item ?code WHERE {
        ?item wdt:P442 ?code .
        FILTER(?code IN (${values}))
      }
    `;

    try {
      const result = await querySparql(sparql);
      for (const binding of result.results.bindings) {
        const qid = binding.item!.value.replace('http://www.wikidata.org/entity/', '');
        const p442Code = binding.code!.value;
        const entry = batch.find((e) => e.p442 === p442Code);
        if (entry) qidMap.set(entry.region.id, qid);
      }
    } catch (e) {
      console.warn(`[Wikidata] P442 ${kind} batch ${i}-${i + batch.length} failed: ${e}`);
    }
    await sleep(DELAY_MS);
  }

  return qidMap;
}

/**
 * Enrich CN counties by matching Chinese name + country (China).
 * Faster than P442 because it uses the label index directly.
 * Groups by parent province Q-ID to reduce false matches.
 */
async function enrichCNCountiesByName(
  cnCounties: Region[],
  provQidMap: Map<string, string>,
  allRegions: Region[]
): Promise<void> {
  // Build parent province Q-ID lookup for each county
  const countyProvQid = new Map<Region, string>();
  for (const county of cnCounties) {
    // Walk up to find the province ancestor
    let current = county;
    for (let depth = 0; depth < 4; depth++) {
      if (!current.parentId) break;
      if (provQidMap.has(current.parentId)) {
        countyProvQid.set(county, provQidMap.get(current.parentId)!);
        break;
      }
      const parent = allRegions.find((r) => r.id === current.parentId);
      if (!parent) break;
      current = parent;
    }
  }

  // Group counties by parent province Q-ID
  const byProvQid = new Map<string, Region[]>();
  for (const [county, provQid] of countyProvQid) {
    if (!byProvQid.has(provQid)) byProvQid.set(provQid, []);
    byProvQid.get(provQid)!.push(county);
  }

  console.log(
    `[Wikidata] Enriching ${cnCounties.length} CN counties by name (${byProvQid.size} province groups)...`
  );

  let count = 0;
  let provDone = 0;
  for (const [, counties] of byProvQid) {
    // Query in batches of BATCH_SIZE names
    for (let i = 0; i < counties.length; i += BATCH_SIZE) {
      const batch = counties.slice(i, i + BATCH_SIZE);
      const nameValues = batch.map((r) => `"${escapeSparql(r.name.zh || r.name.en)}"@zh`).join(' ');

      const sparql = `
        SELECT ?item ?inputName ?enLabel ?zhLabel ?jaLabel ?pop ?popDate ?area ?areaUnit ?coord WHERE {
          VALUES ?inputName { ${nameValues} }
          ?item rdfs:label ?inputName .
          ?item wdt:P17 wd:Q148 .
          OPTIONAL { ?item rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
          OPTIONAL { ?item rdfs:label ?zhLabel . FILTER(LANG(?zhLabel) = "zh" || LANG(?zhLabel) = "zh-hans") }
          OPTIONAL { ?item rdfs:label ?jaLabel . FILTER(LANG(?jaLabel) = "ja") }
          OPTIONAL {
            ?item p:P1082 ?popStmt .
            ?popStmt ps:P1082 ?pop .
            OPTIONAL { ?popStmt pq:P585 ?popDate . }
          }
          OPTIONAL {
            ?item p:P2046 ?areaStmt .
            ?areaStmt ps:P2046 ?area .
            OPTIONAL { ?areaStmt psv:P2046 ?areaVal . ?areaVal wikibase:quantityUnit ?areaUnit . }
          }
          OPTIONAL { ?item wdt:P625 ?coord . }
        }
      `;

      try {
        const data = await querySparql(sparql);
        // Match results back to counties by Chinese name
        for (const binding of data.results.bindings) {
          const inputName = binding.inputName?.value;
          if (!inputName) continue;
          const region = batch.find((r) => (r.name.zh || r.name.en) === inputName);
          if (!region) continue;
          // Apply enrichment (don't overwrite existing name_cn)
          if (binding.enLabel) region.name.en = binding.enLabel.value;
          if (binding.jaLabel && !region.name.ja) region.name.ja = binding.jaLabel.value;
          const pop = pickBestPopulation([binding]);
          if (pop !== null) region.population = pop;
          if (binding.area)
            region.area = convertToSqKm(
              parseFloat(binding.area.value),
              binding.areaUnit?.value ?? ''
            );
          if (binding.coord) {
            const parsed = parseCoord(binding.coord.value);
            if (parsed) region.location = { type: 'Point', coordinates: [parsed.lon, parsed.lat] };
          }
          count++;
        }
      } catch {
        // Silently continue
      }
      await sleep(DELAY_MS);
    }
    provDone++;
    if (provDone % 5 === 0) {
      console.log(
        `[Wikidata] County progress: ${provDone}/${byProvQid.size} provinces (${count} enriched)`
      );
    }
  }

  console.log(`[Wikidata] Enriched ${count}/${cnCounties.length} CN counties by name`);
}

// ── Batch Enrichment from Q-ID Map ────────────────────────────────

async function enrichFromQidMap(qidMap: Map<string, string>, regions: Region[]): Promise<void> {
  const qidToRegion = new Map<string, Region>();
  for (const [regionId, qid] of qidMap) {
    const region = regions.find((r) => r.id === regionId);
    if (region) qidToRegion.set(qid, region);
  }

  const qids = [...qidToRegion.keys()];
  if (qids.length === 0) return;

  const enrichments = await batchFetchEnrichments(qids);
  let count = 0;

  for (const [qid, enrichment] of enrichments) {
    const region = qidToRegion.get(qid);
    if (!region) continue;

    if (enrichment.name.en) region.name.en = enrichment.name.en;
    if (enrichment.name.zh && !region.name.zh) region.name.zh = enrichment.name.zh;
    if (enrichment.name.ja && !region.name.ja) region.name.ja = enrichment.name.ja;
    if (enrichment.population != null) region.population = enrichment.population;
    if (enrichment.area != null) region.area = enrichment.area;
    if (enrichment.lat != null && enrichment.lon != null && !region.location)
      region.location = { type: 'Point', coordinates: [enrichment.lon, enrichment.lat] };

    count++;
  }

  console.log(`[Wikidata] Applied ${count} enrichments`);
}

// ── Enrichment Batch Fetching ─────────────────────────────────────

async function batchFetchEnrichments(qids: string[]): Promise<Map<string, WikidataEnrichment>> {
  const result = new Map<string, WikidataEnrichment>();

  for (let i = 0; i < qids.length; i += BATCH_SIZE) {
    const batch = qids.slice(i, i + BATCH_SIZE);
    const entityUris = batch.map((q) => `wd:${q}`).join(' ');

    const sparql = `
      SELECT ?item ${ENRICH_SELECT} WHERE {
        VALUES ?item { ${entityUris} }
        ${ENRICH_OPTIONALS}
      }
    `;

    try {
      const data = await querySparql(sparql);
      const grouped = groupByEntity(data);
      for (const [qid, bindings] of grouped) {
        const enrichment = parseBestEnrichment(qid, bindings);
        if (enrichment) result.set(qid, enrichment);
      }
    } catch (e) {
      console.warn(`[Wikidata] Enrichment batch failed: ${e}`);
    }

    await sleep(DELAY_MS);
    if (i > 0 && i % (BATCH_SIZE * 10) === 0) {
      console.log(`[Wikidata] Enrichment progress: ${i}/${qids.length}`);
    }
  }

  return result;
}

// ── Binding Grouping & Best-Value Selection ───────────────────────

/**
 * Group SPARQL bindings by entity Q-ID (or by a custom key field).
 * Returns Map<entityKey, bindings[]>.
 */
function groupByEntity(
  data: SparqlResult,
  keyField?: string
): Map<string, Record<string, SparqlBinding>[]> {
  const grouped = new Map<string, Record<string, SparqlBinding>[]>();
  for (const binding of data.results.bindings) {
    let key: string;
    if (keyField && binding[keyField]) {
      key = binding[keyField].value;
    } else {
      key = binding.item!.value.replace('http://www.wikidata.org/entity/', '');
    }
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(binding);
  }
  return grouped;
}

/**
 * From multiple bindings for one entity, pick the best values:
 * - Names: first non-null
 * - Population: most recent by popDate (P585)
 * - Area: first non-null
 * - Coordinates: first non-null
 */
function applyBestBinding(region: Region, bindings: Record<string, SparqlBinding>[]): void {
  if (bindings.length === 0) return;
  const first = bindings[0];

  // Names — first binding is fine
  if (first.enLabel) region.name.en = first.enLabel.value;
  if (first.zhLabel && !region.name.zh) region.name.zh = first.zhLabel.value;
  if (first.jaLabel && !region.name.ja) region.name.ja = first.jaLabel.value;

  // Population: pick the most recent by popDate
  region.population = pickBestPopulation(bindings);

  // Area: first non-null
  for (const b of bindings) {
    if (b.area) {
      region.area = convertToSqKm(parseFloat(b.area.value), b.areaUnit?.value ?? '');
      break;
    }
  }

  // Coordinates: first non-null
  if (first.coord) {
    const parsed = parseCoord(first.coord.value);
    if (parsed) region.location = { type: 'Point', coordinates: [parsed.lon, parsed.lat] };
  }
}

/**
 * Parse multiple bindings into a WikidataEnrichment, picking the best population.
 */
function parseBestEnrichment(
  qid: string,
  bindings: Record<string, SparqlBinding>[]
): WikidataEnrichment | null {
  if (bindings.length === 0) return null;
  const first = bindings[0];

  const name_en = first.enLabel?.value ?? null;
  const name_cn = first.zhLabel?.value ?? null;
  const name_ja = first.jaLabel?.value ?? null;
  const population = pickBestPopulation(bindings);

  let area_sqkm: number | null = null;
  for (const b of bindings) {
    if (b.area) {
      area_sqkm = convertToSqKm(parseFloat(b.area.value), b.areaUnit?.value ?? '');
      break;
    }
  }

  let latitude: number | null = null;
  let longitude: number | null = null;
  if (first.coord) {
    const parsed = parseCoord(first.coord.value);
    if (parsed) {
      latitude = parsed.lat;
      longitude = parsed.lon;
    }
  }

  return {
    qid,
    name: { en: name_en, cn: name_cn, ja: name_ja },
    population,
    area: area_sqkm,
    lat: latitude,
    lon: longitude
  };
}

/**
 * From multiple bindings, pick the population with the most recent popDate.
 * Falls back to the first available population if no dates exist.
 */
function pickBestPopulation(bindings: Record<string, SparqlBinding>[]): number | null {
  let bestPop: number | null = null;
  let bestDate: string | null = null;
  let fallbackPop: number | null = null;

  for (const b of bindings) {
    if (!b.pop) continue;
    const popVal = parseFloat(b.pop.value);
    const dateVal = b.popDate?.value ?? null;

    if (dateVal) {
      if (bestDate === null || dateVal > bestDate) {
        bestPop = popVal;
        bestDate = dateVal;
      }
    } else if (fallbackPop === null) {
      fallbackPop = popVal;
    }
  }

  return bestPop ?? fallbackPop;
}

// ── Utility ───────────────────────────────────────────────────────

function escapeSparql(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isDescendantOfCN(region: Region, allRegions: Region[]): boolean {
  let current = region;
  for (let depth = 0; depth < 5; depth++) {
    if (!current.parentId) return false;
    if (current.parentId === 'CN') return true;
    const parent = allRegions.find((r) => r.id === current.parentId);
    if (!parent) return false;
    current = parent;
  }
  return false;
}

async function querySparql(sparql: string): Promise<SparqlResult> {
  const body = new URLSearchParams({ query: sparql });

  const res = await fetch(WDQS_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'worldwide-regions/1.0 (https://github.com/worldwide-regions)'
    },
    body: body.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`WDQS ${res.status}: ${text.slice(0, 300)}`);
  }

  const raw = await res.text();
  /* eslint-disable-next-line no-control-regex */
  const clean = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return JSON.parse(clean) as SparqlResult;
}

function parseCoord(globeString: string): { lon: number; lat: number } | null {
  const match = globeString.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
  if (!match) return null;
  return { lon: parseFloat(match[1]), lat: parseFloat(match[2]) };
}

function convertToSqKm(value: number, unitUri: string): number {
  if (unitUri.includes('Q28390') || unitUri === '') return value;
  if (unitUri.includes('Q35852')) return value / 100;
  if (unitUri.includes('Q25343')) return value / 1_000_000;
  if (unitUri.includes('Q180435')) return value * 2.58999;
  if (unitUri.includes('Q215440')) return value * 0.00404686;
  // Q712226 = Chinese unit "square li" (平方公里) — already sq km
  if (unitUri.includes('Q712226')) return value;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
