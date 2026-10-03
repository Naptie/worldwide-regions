import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MongoClient } from 'mongodb';
import OpenCC from 'opencc-js';

const URI = process.env.MONGO_URI;
if (!URI) {
  console.error('[FATAL] MONGO_URI environment variable is not set');
  process.exit(1);
}
const url = new URL(URI);
const DB = url.searchParams.get('dbName');
if (!DB) {
  console.error('[FATAL] MONGO_URI does not contain a dbName query parameter');
  process.exit(1);
}

const MODOOD_BASE =
  'https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/master/dist';
const STREETS_CACHE = join(process.cwd(), 'data', 'source-cache', 'modood-streets.json');

const toJapaneseShinjitai = OpenCC.Converter({ from: 'cn', to: 'jp' });

// Streets of the four directly-administered cities whose placeholder counties
// are removed by the pipeline (CN-441900/442000/460400/620201 do not exist in
// the database; their streets hang off the city node instead).
const CITY_CODES = ['4419', '4420', '4604', '6202'];

// English names researched from en.wikipedia.org (Dongguan/Zhongshan/Danzhou
// division tables, individual town articles), official government sites, and
// Wikidata. Missing codes fall back to the zh name (should not happen).
const EN_NAMES: Record<string, string> = {
  // Dongguan (36)
  '441900003': 'Dongcheng Subdistrict',
  '441900004': 'Nancheng Subdistrict',
  '441900005': 'Wanjiang Subdistrict',
  '441900006': 'Guancheng Subdistrict',
  '441900101': 'Shijie',
  '441900102': 'Shilong',
  '441900103': 'Chashan',
  '441900104': 'Shipai',
  '441900105': 'Qishi',
  '441900106': 'Hengli',
  '441900107': 'Qiaotou',
  '441900108': 'Xiegang',
  '441900109': 'Dongkeng',
  '441900110': 'Changping',
  '441900111': 'Liaobu',
  '441900112': 'Zhangmutou',
  '441900113': 'Dalang',
  '441900114': 'Huangjiang',
  '441900115': 'Qingxi',
  '441900116': 'Tangxia',
  '441900117': 'Fenggang',
  '441900118': 'Dalingshan',
  '441900119': "Chang'an",
  '441900121': 'Humen',
  '441900122': 'Houjie',
  '441900123': 'Shatian',
  '441900124': 'Daojiao',
  '441900125': 'Hongmei',
  '441900126': 'Machong',
  '441900127': 'Wangniudun',
  '441900128': 'Zhongtang',
  '441900129': 'Gaobu',
  '441900401': 'Songshanhu',
  '441900402': 'Dongguan Port',
  '441900403': 'Dongguan Ecological Park',
  '441900404': 'Dongguan Binhaiwan New Area',
  // Zhongshan (23)
  '442000001': 'Shiqi Subdistrict',
  '442000002': 'Dongqu Subdistrict',
  '442000003': 'Zhongshangang Subdistrict',
  '442000004': 'Xiqu Subdistrict',
  '442000005': 'Nanqu Subdistrict',
  '442000006': 'Wuguishan Subdistrict',
  '442000007': 'Minzhong Subdistrict',
  '442000008': 'Nanlang Subdistrict',
  '442000101': 'Huangpu',
  '442000103': 'Dongfeng',
  '442000105': 'Guzhen',
  '442000106': 'Shaxi',
  '442000107': 'Tanzhou',
  '442000108': 'Gangkou',
  '442000109': 'Sanjiao',
  '442000110': 'Henglan',
  '442000111': 'Nantou',
  '442000112': 'Fusha',
  '442000114': 'Sanxiang',
  '442000115': 'Banfu',
  '442000116': 'Dachong',
  '442000117': 'Shenwan',
  '442000118': 'Xiaolan',
  // Danzhou (18)
  '460400100': 'Nada',
  '460400101': 'Heqing',
  '460400102': 'Nanfeng',
  '460400103': 'Dacheng',
  '460400104': 'Yaxing',
  '460400105': 'Lanyang',
  '460400106': 'Guangcun',
  '460400107': 'Mutang',
  '460400108': 'Haitou',
  '460400109': 'Eman',
  '460400111': 'Wangwu',
  '460400112': 'Baimajing',
  '460400113': 'Zhonghe',
  '460400114': 'Paipu',
  '460400115': 'Dongcheng',
  '460400116': 'Xinzhou',
  '460400499': 'Yangpu Economic Development Zone',
  '460400500': 'South China Tropical Crops College',
  // Jiayuguan (5)
  '620201001': 'Xiongguan Subdistrict',
  '620201002': 'Gangcheng Subdistrict',
  '620201100': 'Xincheng Town',
  '620201101': 'Yuquan Town',
  '620201102': 'Wenshu Town'
};

type ModoodStreet = { code: string; name: string; areaCode: string; cityCode: string };

async function fetchJson<T>(url: string, cachePath: string): Promise<T> {
  if (existsSync(cachePath)) {
    console.log(`  Cache hit: ${cachePath}`);
    return JSON.parse(readFileSync(cachePath, 'utf8')) as T;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as T;
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(json, null, 2), 'utf8');
  console.log(`  Cached ${url} -> ${cachePath}`);
  return json;
}

async function main() {
  const client = new MongoClient(URI, { appName: 'worldwide-regions-patch-streets' });
  await client.connect();
  try {
    const db = client.db(DB);
    const coll = db.collection('regions');

    const sample = await coll.findOne({ level: 'county' }, { projection: { _id: 0 } });
    console.log('Sample county doc in DB:', JSON.stringify(sample, null, 2));

    console.log('Fetching streets.json...');
    const streets = Object.values(
      await fetchJson<Record<string, ModoodStreet>>(`${MODOOD_BASE}/streets.json`, STREETS_CACHE)
    ).filter((s) => CITY_CODES.includes(s.cityCode));
    console.log(`  ${streets.length} streets in the 4 target cities`);

    const ids = streets.map((s) => `CN-${s.code}`);
    const existing = new Set(await coll.distinct('id', { id: { $in: ids } }));
    const missing = streets.filter((s) => !existing.has(`CN-${s.code}`));
    console.log(`  ${existing.size} already present, ${missing.length} to insert`);

    const candidateParents = new Set(missing.map((s) => `CN-${s.areaCode}`));
    const existingParents = new Set(
      await coll.distinct('id', { id: { $in: [...candidateParents] } })
    );

    const docs = missing.map((s) => {
      const parentId = existingParents.has(`CN-${s.areaCode}`)
        ? `CN-${s.areaCode}`
        : `CN-${s.cityCode}`;
      const en = EN_NAMES[s.code];
      if (!en) console.warn(`  [WARN] No English name for ${s.code} (${s.name}), using zh as en`);
      return {
        id: `CN-${s.code}`,
        parentId,
        level: 'street',
        name: {
          en: en ?? s.name,
          zh: s.name,
          ja: toJapaneseShinjitai(s.name)
        },
        population: null,
        area: null,
        location: null
      };
    });

    for (const d of docs) {
      console.log(`  ${d.id} ${d.name.zh} -> ${d.parentId} | en: ${d.name.en} | ja: ${d.name.ja}`);
    }

    if (docs.length === 0) {
      console.log('Nothing to insert.');
    } else {
      const BATCH = 500;
      for (let i = 0; i < docs.length; i += BATCH) {
        const batch = docs.slice(i, i + BATCH);
        await coll.insertMany(batch, { ordered: false });
        console.log(`  Inserted ${i + batch.length}/${docs.length}`);
      }

      const perCity = new Map<string, number>();
      for (const d of docs) {
        const city = d.parentId;
        perCity.set(city, (perCity.get(city) ?? 0) + 1);
      }
      console.log('Inserted per parent:', Object.fromEntries(perCity));
      console.log(`Done: ${docs.length} streets into ${DB}.regions`);
    }
  } finally {
    await client.close();
  }
}
main();
