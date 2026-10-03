import { ingestAll } from '../dist/ingestion.js';
import { completeChinaLocalization } from '../dist/localization.js';
import { normalizeRegions } from '../dist/normalize.js';
import { createSelectorRegions } from '../dist/selector.js';

async function main() {
  const { china } = await ingestAll();
  try {
    completeChinaLocalization(china);
  } catch {
    // needs wikidata cache; not part of this check
  }
  const { regions } = normalizeRegions(china);
  const byId = new Map(regions.map((r) => [r.id, r]));
  const childrenOf = (id: string) => regions.filter((r) => r.parentId === id);

  console.log('\n=== summary ===');
  for (const level of ['country', 'province', 'city', 'county', 'street']) {
    console.log(`${level}: ${regions.filter((r) => r.level === level).length}`);
  }

  console.log('\n=== 4 direct-administered cities ===');
  for (const id of ['CN-4419', 'CN-4420', 'CN-4604', 'CN-6202']) {
    const city = byId.get(id);
    const kids = childrenOf(id);
    console.log(
      `${id} ${city?.name.zh}: ${kids.length} children (${kids.filter((k) => k.level === 'street').length} streets)`
    );
    for (const k of kids.slice(0, 6)) console.log(`   ${k.id} ${k.name.zh} [${k.level}]`);
  }

  console.log('\n=== placeholder counties removed? ===');
  for (const id of ['CN-441900', 'CN-442000', 'CN-460400', 'CN-620201']) {
    console.log(`${id}: ${byId.has(id) ? 'STILL EXISTS' : 'removed'}`);
  }

  console.log('\n=== selector ===');
  const selector = createSelectorRegions(regions);
  const selectorByParent = new Map<string, number>();
  for (const s of selector) {
    if (!s.parentId) continue;
    selectorByParent.set(s.parentId, (selectorByParent.get(s.parentId) ?? 0) + 1);
  }
  for (const id of ['CN-4419', 'CN-4420', 'CN-4604', 'CN-6202']) {
    console.log(`${id} selector children: ${selectorByParent.get(id) ?? 0}`);
  }
  console.log(`total selector records: ${selector.length}`);

  console.log('\n=== sample street names ===');
  const sample = ['CN-441900122', 'CN-442000118', 'CN-460400112', 'CN-620201001'];
  for (const id of sample) {
    const r = byId.get(id);
    console.log(`${id}: en=${r?.name.en} zh=${r?.name.zh} ja=${r?.name.ja} parent=${r?.parentId}`);
  }
}

main();
