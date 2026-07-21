import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import OpenCC from 'opencc-js';

interface SourceNode {
  id: string;
  name: { en?: string; cn?: string; ja?: string };
  children?: SourceNode[];
}

interface WikidataChild {
  qid: string;
  parentQid: string;
  name_en: string | null;
  name_cn: string | null;
  name_ja: string | null;
}

interface CanonicalLabel {
  qid: string;
  name_en: string | null;
  name_cn: string | null;
  name_ja: string | null;
  source: 'wikidata-territory-crawl';
}

const WDQS = 'https://query.wikidata.org/sparql';
const OUTPUT = join(process.cwd(), 'resources', 'canonical-labels.json');
const MODOOD_BASE =
  'https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/master/dist';
const toSimplified = OpenCC.Converter({ from: 't', to: 'cn' });

const ROOT_QIDS: Record<string, string> = {
  'CN-71': 'Q865',
  'CN-81': 'Q8646',
  'CN-82': 'Q14773'
};

const PROVINCE_MAP: Record<string, { code: string; name: string }> = {
  '台湾省': { code: '71', name: '台湾省' },
  '香港特别行政区': { code: '81', name: '香港特别行政区' },
  '澳门特别行政区': { code: '82', name: '澳门特别行政区' }
};

const normalize = (value: string): string =>
  toSimplified(value)
    .normalize('NFKC')
    .replace(/[\s·・（）()縣県區]/g, (token) => ({ 縣: '县', 県: '县', 區: '区' })[token] ?? '')
    .replace(/臺/g, '台');

async function fetchJson<T>(url: string, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (res.ok) return (await res.json()) as T;
    if (attempt === retries) throw new Error(`${res.status} ${res.statusText}`);
    console.warn(`  Retry ${attempt}/${retries} for ${url}`);
    await sleep(3000 * attempt);
  }
  throw new Error('unreachable');
}

function buildSourceHierarchy(
  hkMoTW: Record<string, Record<string, string[]>>
): SourceNode[] {
  const roots: SourceNode[] = [];

  for (const [provName, { code, name }] of Object.entries(PROVINCE_MAP)) {
    const root: SourceNode = {
      id: `CN-${code}`,
      name: { cn: name }
    };

    const cityData = hkMoTW[provName];
    if (!cityData) {
      roots.push(root);
      continue;
    }

    root.children = [];
    let cityIndex = 0;
    for (const [cityName, districts] of Object.entries(cityData)) {
      cityIndex++;
      const cityCode = `CN-${code}${String(cityIndex).padStart(2, '0')}`;
      const city: SourceNode = {
        id: cityCode,
        name: { cn: cityName },
        children: []
      };

      for (let i = 0; i < districts.length; i++) {
        const areaCode = `CN-${code}${String(cityIndex).padStart(2, '0')}${String(i + 1).padStart(2, '0')}`;
        const area: SourceNode = {
          id: areaCode,
          name: { cn: districts[i] }
        };
        city.children!.push(area);
      }

      root.children.push(city);
    }

    roots.push(root);
  }

  return roots;
}

async function queryDescendants(rootQid: string, retries = 4): Promise<WikidataChild[]> {
  const query = `SELECT ?item ?parent ?en ?zh ?zhs ?zht ?ja WHERE {
    ?item wdt:P131+ wd:${rootQid} .
    OPTIONAL { ?item wdt:P131 ?parent }
    OPTIONAL { ?item rdfs:label ?en . FILTER(LANG(?en) = "en") }
    OPTIONAL { ?item rdfs:label ?zh . FILTER(LANG(?zh) = "zh") }
    OPTIONAL { ?item rdfs:label ?zhs . FILTER(LANG(?zhs) = "zh-hans") }
    OPTIONAL { ?item rdfs:label ?zht . FILTER(LANG(?zht) = "zh-hant") }
    OPTIONAL { ?item rdfs:label ?ja . FILTER(LANG(?ja) = "ja") }
  }`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(WDQS, {
        method: 'POST',
        headers: {
          Accept: 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'worldwide-regions-canonical-label-crawler/1.0'
        },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(120_000)
      });
      if (!response.ok) throw new Error(`WDQS ${response.status}: ${await response.text()}`);
      const raw = await response.text();
      const clean = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      const json = JSON.parse(clean) as {
        results: { bindings: Record<string, { value: string }>[] };
      };
      const grouped = new Map<string, WikidataChild>();
      for (const binding of json.results.bindings) {
        const qid = binding.item.value.split('/').at(-1)!;
        const parentQid = binding.parent?.value?.split('/').at(-1) ?? rootQid;
        const current = grouped.get(qid) ?? {
          qid,
          parentQid,
          name_en: null,
          name_cn: null,
          name_ja: null
        };
        current.name_en ??= binding.en?.value ?? null;
        current.name_cn ??= binding.zhs?.value ?? binding.zh?.value ?? binding.zht?.value ?? null;
        current.name_ja ??= binding.ja?.value ?? null;
        grouped.set(qid, current);
      }
      return [...grouped.values()];
    } catch (error) {
      if (attempt === retries) throw error;
      console.warn(`  WDQS retry ${attempt}/${retries}: ${error}`);
      await sleep(attempt * 3000);
    }
  }
  return [];
}

function sourceById(roots: SourceNode[], id: string): SourceNode | undefined {
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === id) return node;
    stack.push(...(node.children ?? []));
  }
  return undefined;
}

console.log('Fetching HMT source hierarchy from modood...');
const hkMoTW = await fetchJson<Record<string, Record<string, string[]>>>(
  `${MODOOD_BASE}/HK-MO-TW.json`
);
const roots = buildSourceHierarchy(hkMoTW);
console.log(`  Built ${roots.length} HMT roots with descendants`);

const labels: Record<string, CanonicalLabel> = {};

for (const [rootId, rootQid] of Object.entries(ROOT_QIDS)) {
  console.log(`Crawling administrative descendants under ${rootId}/${rootQid}...`);
  const root = sourceById(roots, rootId);
  if (!root) throw new Error(`Source root ${rootId} missing`);
  const candidates = await queryDescendants(rootQid);
  const sourceNodes: SourceNode[] = [];
  const stack = [...(root.children ?? [])];
  while (stack.length > 0) {
    const node = stack.pop()!;
    sourceNodes.push(node);
    stack.push(...(node.children ?? []));
  }

  const sourceQidById = new Map<string, string>([[root.id, rootQid]]);
  const pending = [...sourceNodes].sort((left, right) => left.id.length - right.id.length);

  function parentQidsFor(parentId: string): Set<string> {
    const qids = new Set<string>();
    const known = sourceQidById.get(parentId);
    if (known) qids.add(known);
    const parentNode = pending.find((n) => n.id === parentId) ?? root;
    if (parentNode?.name?.cn) {
      const parentNormalized = normalize(parentNode.name.cn);
      for (const c of candidates) {
        if (c.name_cn && normalize(c.name_cn) === parentNormalized) qids.add(c.qid);
      }
    }
    return qids;
  }

  for (const node of pending) {
    const cn = node.name?.cn;
    if (!cn) continue;
    const wanted = normalize(cn);
    const nbsPart = node.id.slice(3);
    const parentId = nbsPart.length <= 2 ? root.id : `CN-${nbsPart.slice(0, nbsPart.length - 2)}`;
    const named = candidates.filter(
      (candidate) => candidate.name_cn && normalize(candidate.name_cn) === wanted
    );

    const parentQids = parentQidsFor(parentId);
    const parentScoped = named.filter((candidate) => parentQids.has(candidate.parentQid));
    let match = parentScoped.length === 1 ? parentScoped[0] : null;
    if (!match) {
      if (parentScoped.length > 1) match = parentScoped[0];
      else if (named.length === 1) match = named[0];
      else continue;
    }
    sourceQidById.set(node.id, match.qid);
    sourceQidById.set(node.id, match.qid);
    labels[node.id] = {
      qid: match.qid,
      name_en: match.name_en,
      name_cn: match.name_cn,
      name_ja: match.name_ja,
      source: 'wikidata-territory-crawl'
    };
  }
  console.log(
    `  Candidates: ${candidates.length}; matched source nodes: ${sourceNodes.filter((node) => labels[node.id]).length}`
  );
  await sleep(1000);
}

const output = {
  built: new Date().toISOString(),
  roots: ROOT_QIDS,
  matched: Object.keys(labels).length,
  labels
};
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${OUTPUT}: ${output.matched} canonical labels`);
