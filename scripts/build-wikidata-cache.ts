import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WDQS = 'https://query.wikidata.org/sparql';
const UA = 'worldwide-regions/1.0';
const OUT = join(process.cwd(), 'data', 'wikidata-cache.json');

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
type B = Record<string, { type: string; value: string }>;

async function sparql(query: string, retries = 3): Promise<B[]> {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  let dispatcher: unknown = undefined;
  if (proxyUrl) {
    try {
      const { ProxyAgent } = await import('undici');
      dispatcher = new ProxyAgent(proxyUrl);
    } catch {
      /* optional proxy — fine if undici is missing */
    }
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    const body = new URLSearchParams({ query });
    const opts: RequestInit = {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA
      },
      body: body.toString(),
      signal: AbortSignal.timeout(120_000)
    };
    if (dispatcher) (opts as Record<string, unknown>).dispatcher = dispatcher;
    const res = await fetch(WDQS, opts);
    if (res.ok) {
      const raw = await res.text();
      /* eslint-disable-next-line no-control-regex */
      const clean = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      return (JSON.parse(clean) as { results: { bindings: B[] } }).results.bindings;
    }
    const t = await res.text().catch(() => '');
    if (attempt === retries) throw new Error(`WDQS ${res.status}: ${t.slice(0, 200)}`);
    console.warn(`  Retry ${attempt}/${retries} (WDQS ${res.status})...`);
    await sleep(5000 * attempt);
  }
  return [];
}

const v = (b: B, k: string) => b[k]?.value ?? null;
const n = (b: B, k: string) => {
  const s = v(b, k);
  return s ? parseFloat(s) : null;
};
const toQid = (s: string | null) => s?.replace('http://www.wikidata.org/entity/', '') ?? null;
function coord(s: string | null) {
  if (!s) return { lat: null, lon: null };
  const m = s.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
  return m ? { lat: parseFloat(m[2]), lon: parseFloat(m[1]) } : { lat: null, lon: null };
}
function sqKm(val: number | null, unit: string | null): number | null {
  if (val === null) return null;
  if (!unit || unit.includes('Q28390')) return val;
  if (unit.includes('Q35852')) return val / 100;
  if (unit.includes('Q25343')) return val / 1e6;
  if (unit.includes('Q180435')) return val * 2.58999;
  if (unit.includes('Q712226')) return val;
  return val;
}
function bestPop(bs: B[]): number | null {
  let best: number | null = null,
    bestDate = '',
    fb: number | null = null;
  for (const b of bs) {
    const p = n(b, 'pop');
    if (p === null) continue;
    const d = v(b, 'popDate') ?? '';
    if (d > bestDate) {
      best = p;
      bestDate = d;
    } else if (!d && fb === null) fb = p;
  }
  return best ?? fb;
}
function groupByQid(bs: B[]): Map<string, B[]> {
  const m = new Map<string, B[]>();
  for (const b of bs) {
    const id = toQid(v(b, 'item'))!;
    if (!m.has(id)) m.set(id, []);
    m.get(id)!.push(b);
  }
  return m;
}
function sleep(ms: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

const SEL = '?enLabel ?zhLabel ?jaLabel ?pop ?popDate ?area ?au ?coord';
const OPT = `OPTIONAL { ?item rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
    OPTIONAL { ?item rdfs:label ?zhLabel . FILTER(LANG(?zhLabel) = "zh" || LANG(?zhLabel) = "zh-hans") }
    OPTIONAL { ?item rdfs:label ?jaLabel . FILTER(LANG(?jaLabel) = "ja") }
    OPTIONAL { ?item p:P1082 ?ps . ?ps ps:P1082 ?pop . OPTIONAL { ?ps pq:P585 ?popDate . } }
    OPTIONAL { ?item p:P2046 ?as_ . ?as_ ps:P2046 ?area . OPTIONAL { ?as_ psv:P2046 ?av . ?av wikibase:quantityUnit ?au . } }
    OPTIONAL { ?item wdt:P625 ?coord }`;

async function enrichQids(
  qids: string[],
  extra?: (qid: string) => Partial<CachedEntity>
): Promise<CachedEntity[]> {
  const entities: CachedEntity[] = [];
  const BATCH = 100;
  for (let i = 0; i < qids.length; i += BATCH) {
    const batch = qids.slice(i, i + BATCH);
    const uris = batch.map((q) => `wd:${q}`).join(' ');
    try {
      const bs = await sparql(`SELECT ?item ${SEL} WHERE { VALUES ?item { ${uris} } ${OPT} }`);
      const grouped = groupByQid(bs);
      for (const qid_ of batch) {
        const bindings = grouped.get(qid_);
        if (!bindings) {
          entities.push({
            qid: qid_,
            name_en: null,
            name_cn: null,
            name_ja: null,
            population: null,
            area_sqkm: null,
            lat: null,
            lon: null,
            country_qid: null,
            ...(extra?.(qid_) ?? {})
          });
          continue;
        }
        const f = bindings[0];
        const c = coord(v(f, 'coord'));
        entities.push({
          qid: qid_,
          name_en: v(f, 'enLabel'),
          name_cn: v(f, 'zhLabel'),
          name_ja: v(f, 'jaLabel'),
          population: bestPop(bindings),
          area_sqkm: sqKm(n(f, 'area'), v(f, 'au')),
          lat: c.lat,
          lon: c.lon,
          country_qid: null,
          ...(extra?.(qid_) ?? {})
        });
      }
    } catch (e) {
      console.warn(`  Batch ${i}-${i + BATCH} failed: ${e}`);
    }
    if (i > 0 && i % 500 === 0) console.log(`  Progress: ${i}/${qids.length}`);
    await sleep(300);
  }
  return entities;
}

async function fetchCountries(): Promise<CachedEntity[]> {
  console.log('[1/4] Fetching countries...');
  const bs = await sparql(`SELECT ?item ?iso2 ${SEL} WHERE { ?item wdt:P297 ?iso2 . ${OPT} }`);
  const grouped = groupByQid(bs);
  const out: CachedEntity[] = [];
  for (const [id, bindings] of grouped) {
    const f = bindings[0];
    const c = coord(v(f, 'coord'));
    out.push({
      qid: id,
      iso2: v(f, 'iso2') ?? undefined,
      name_en: v(f, 'enLabel'),
      name_cn: v(f, 'zhLabel'),
      name_ja: v(f, 'jaLabel'),
      population: bestPop(bindings),
      area_sqkm: sqKm(n(f, 'area'), v(f, 'au')),
      lat: c.lat,
      lon: c.lon,
      country_qid: null
    });
  }
  return out;
}

async function fetchCN(): Promise<CachedEntity[]> {
  console.log('[2/4] Fetching CN entities (P442)...');
  const codeBs = await sparql(
    `SELECT ?item ?p442 WHERE { ?item wdt:P442 ?p442 . ?item wdt:P17 wd:Q148 . FILTER(STRLEN(?p442) <= 8) }`
  );
  const qidToP442 = new Map<string, string>();
  for (const b of codeBs) {
    const q = toQid(v(b, 'item'));
    const p = v(b, 'p442');
    if (q && p) qidToP442.set(q, p);
  }
  console.log(`  Found ${qidToP442.size} CN entities`);
  return enrichQids([...qidToP442.keys()], (qid_) => ({
    p442: qidToP442.get(qid_),
    country_qid: 'Q148'
  }));
}

async function fetchProvinces(): Promise<CachedEntity[]> {
  console.log('[3/4] Fetching provinces/states worldwide (P300)...');
  // Capture the actual P300 value for ISO 3166-2 matching
  const idBs = await sparql(
    `SELECT ?item ?country ?iso WHERE { ?item wdt:P300 ?iso . ?item wdt:P17 ?country . FILTER(?country != wd:Q148) }`
  );
  const provMap = new Map<string, string>();
  const provIso = new Map<string, string>();
  for (const b of idBs) {
    const q = toQid(v(b, 'item'));
    const c = toQid(v(b, 'country'));
    const iso = v(b, 'iso');
    if (q && c) provMap.set(q, c);
    if (q && iso) provIso.set(q, iso);
  }
  console.log(`  Found ${provMap.size} provinces/states`);
  return enrichQids([...provMap.keys()], (qid_) => ({
    country_qid: provMap.get(qid_) ?? null,
    p300: provIso.get(qid_)
  }));
}

async function fetchCities(countryEntities: CachedEntity[]): Promise<CachedEntity[]> {
  console.log('[4/4] Fetching settlements worldwide (per country)...');

  const countryQids = countryEntities.map((e) => e.qid);
  console.log(`  Querying ${countryQids.length} countries...`);

  const SETTLEMENT_TYPES = 'wd:Q515 wd:Q3957 wd:Q532';

  // Phase 1: Get Q-IDs + names per-country (fast, lightweight)
  const allQids: string[] = [];
  const qidToCountry = new Map<string, string>();

  for (let i = 0; i < countryQids.length; i++) {
    const countryQid = countryQids[i];
    process.stdout.write(`  ${i + 1}/${countryQids.length}...`);
    try {
      const idBs = await sparql(
        `SELECT ?item ?enLabel ?zhLabel ?jaLabel WHERE {
          VALUES ?type { ${SETTLEMENT_TYPES} }
          ?item wdt:P31 ?type .
          ?item wdt:P17 wd:${countryQid} .
          OPTIONAL { ?item rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
          OPTIONAL { ?item rdfs:label ?zhLabel . FILTER(LANG(?zhLabel) = "zh" || LANG(?zhLabel) = "zh-hans") }
          OPTIONAL { ?item rdfs:label ?jaLabel . FILTER(LANG(?jaLabel) = "ja") }
        }`
      );

      const grouped = groupByQid(idBs);
      for (const [qid_] of grouped) {
        allQids.push(qid_);
        qidToCountry.set(qid_, countryQid);
      }
      process.stdout.write(` ${grouped.size}\n`);
    } catch (e) {
      console.log(` FAILED: ${e}`);
    }
    await sleep(300);
  }

  console.log(`  Found ${allQids.length} settlements. Enriching with metadata...`);

  // Phase 2: Enrich with metadata (slow but comprehensive)
  return enrichQids(allQids, (qid_) => ({ country_qid: qidToCountry.get(qid_) ?? null }));
}

async function main() {
  const t0 = Date.now();
  console.log('=== Wikidata Cache Builder ===\n');
  const countries = await fetchCountries();
  await sleep(2000);
  const cn = await fetchCN();
  await sleep(2000);
  const provinces = await fetchProvinces();
  await sleep(2000);
  const cities = await fetchCities(countries);

  const cache = new Map<string, CachedEntity>();
  for (const e of [...countries, ...cn, ...provinces, ...cities]) {
    const ex = cache.get(e.qid);
    if (ex) {
      if (e.name_en && !ex.name_en) ex.name_en = e.name_en;
      if (e.name_cn && !ex.name_cn) ex.name_cn = e.name_cn;
      if (e.name_ja && !ex.name_ja) ex.name_ja = e.name_ja;
      if (e.population && !ex.population) ex.population = e.population;
      if (e.area_sqkm && !ex.area_sqkm) ex.area_sqkm = e.area_sqkm;
      if (e.lat && !ex.lat) {
        ex.lat = e.lat;
        ex.lon = e.lon;
      }
      if (e.p442 && !ex.p442) ex.p442 = e.p442;
      if (e.iso2 && !ex.iso2) ex.iso2 = e.iso2;
      if (e.p300 && !ex.p300) ex.p300 = e.p300;
      if (e.country_qid && !ex.country_qid) ex.country_qid = e.country_qid;
    } else {
      cache.set(e.qid, e);
    }
  }

  if (!existsSync('data')) mkdirSync('data');
  const byP442 = new Map<string, string>();
  const byIso2 = new Map<string, string>();
  const byP300 = new Map<string, string>();
  const byNameEn = new Map<string, string[]>();
  const byNameCn = new Map<string, string[]>();
  for (const e of cache.values()) {
    if (e.p442) byP442.set(e.p442, e.qid);
    if (e.iso2) byIso2.set(e.iso2, e.qid);
    if (e.p300) byP300.set(e.p300, e.qid);
    if (e.name_en) {
      const k = e.name_en.toLowerCase();
      if (!byNameEn.has(k)) byNameEn.set(k, []);
      byNameEn.get(k)!.push(e.qid);
    }
    if (e.name_cn) {
      if (!byNameCn.has(e.name_cn)) byNameCn.set(e.name_cn, []);
      byNameCn.get(e.name_cn)!.push(e.qid);
    }
  }

  const output = {
    built: new Date().toISOString(),
    entityCount: cache.size,
    byQid: Object.fromEntries(cache),
    byP442: Object.fromEntries(byP442),
    byIso2: Object.fromEntries(byIso2),
    byP300: Object.fromEntries(byP300),
    byNameEn: Object.fromEntries(byNameEn),
    byNameCn: Object.fromEntries(byNameCn)
  };
  writeFileSync(OUT, JSON.stringify(output));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  const sizeMB = (Buffer.byteLength(JSON.stringify(output)) / 1e6).toFixed(1);
  console.log(`\n=== Done ===`);
  console.log(
    `  Entities: ${cache.size}  P442: ${byP442.size}  ISO2: ${byIso2.size}  P300: ${byP300.size}`
  );
  console.log(`  Names(en): ${byNameEn.size}  Names(cn): ${byNameCn.size}`);
  console.log(`  Output: ${OUT} (${sizeMB} MB) in ${elapsed}s`);
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
