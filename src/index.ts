/**
 * Global Region Hierarchy ETL Pipeline
 *
 * Orchestrates the full pipeline:
 * 1. Ingest data from modood (China) + dr5hn (RoW)
 * 2. Apply geopolitical compliance pruning (PRC)
 * 3. Enrich with Wikidata multilingual metadata
 * 4. Serialize to JSON, CSV, BSON
 */
import { ingestAll } from './ingestion.js';
import { applyCompliancePruning } from './compliance.js';
import { enrichRegions } from './wikidata.js';
import { serializeAll } from './serialize.js';
import { completeChinaLocalization } from './localization.js';
import { normalizeRegions } from './normalize.js';
import { addCachedSelectorPlaces } from './cached-selector-places.js';
import type { PipelineRegion } from './types.js';

const IS_SAMPLE = process.argv.includes('--sample');

async function main(): Promise<void> {
  const startTime = Date.now();
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Global Region Hierarchy ETL Pipeline');
  console.log('═══════════════════════════════════════════════════════\n');

  try {
    const { china, row } = await ingestAll(IS_SAMPLE);

    // ── Phase 2: Geopolitical Compliance ────────────────────────
    console.log('\n── Phase 2: Geopolitical Compliance ───────────────');
    const { regions: prunedRow, report } = applyCompliancePruning(row);

    console.log('  Compliance report:');
    console.log(`    TW removed:         ${report.removedTW}`);
    console.log(`    HK removed:         ${report.removedHK}`);
    console.log(`    MO removed:         ${report.removedMO}`);
    console.log(`    Arunachal removed:  ${report.removedArunachalPradesh}`);
    console.log(`    Kalayaan removed:   ${report.removedKalayaan}`);
    console.log(`    Hoang Sa removed:   ${report.removedHoangSa}`);
    console.log(`    Truong Sa removed:  ${report.removedTruongSa}`);
    console.log(`    Kosovo reparented:  ${report.reparentedKosovo}`);
    console.log(`    Total removed:      ${report.totalRemoved}`);

    // ── Merge China + pruned RoW ───────────────────────────────
    const allRegions: PipelineRegion[] = [...china, ...prunedRow];
    console.log(`\n  Merged: ${allRegions.length} total regions`);

    // ── Phase 3: Wikidata Enrichment ───────────────────────────
    console.log('\n── Phase 3: Wikidata Enrichment ───────────────────');
    const enriched = await enrichRegions(allRegions);
    const cachedPlaces = addCachedSelectorPlaces(enriched);
    console.log(`  Added ${cachedPlaces} cached selector places absent from the settlement feed`);
    const localization = completeChinaLocalization(enriched);
    console.log(
      `  China localization: ${localization.total} records, ${localization.canonical} canonical; fallbacks ${localization.fallbackEnglish} EN / ${localization.fallbackChinese} CN / ${localization.fallbackJapanese} JP`
    );
    const normalized = normalizeRegions(enriched);
    console.log(
      `  Output normalization: ${normalized.report.simplifiedChinese} CN simplified, ${normalized.report.commasRemoved} commas removed, ${normalized.report.redundantChildrenRemoved} redundant children removed, ${normalized.report.duplicateWikidataIdsResolved} duplicate QID assignments removed`
    );

    // ── Phase 4: Serialization ─────────────────────────────────
    console.log('\n── Phase 4: Serialization ─────────────────────────');
    const { jsonPath, csvPath, bsonPath, selectorPath } = serializeAll(normalized.regions);

    // ── Summary ─────────────────────────────────────────────────
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  Pipeline Complete!');
    console.log(`  Total regions: ${normalized.regions.length}`);
    console.log(`  Countries: ${normalized.regions.filter((r) => r.level === 'country').length}`);
    console.log(`  Provinces: ${normalized.regions.filter((r) => r.level === 'province').length}`);
    console.log(`  Cities:    ${normalized.regions.filter((r) => r.level === 'city').length}`);
    console.log(`  Counties:  ${normalized.regions.filter((r) => r.level === 'county').length}`);
    console.log(`  Elapsed:   ${elapsed}s`);
    console.log(`  Output:`);
    console.log(`    JSON: ${jsonPath}`);
    console.log(`    CSV:  ${csvPath}`);
    console.log(`    BSON: ${bsonPath}`);
    console.log(`    Selector: ${selectorPath}`);
    console.log('═══════════════════════════════════════════════════════\n');
  } catch (error) {
    console.error('\n[FATAL] Pipeline failed:', error);
    process.exit(1);
  }
}

main();
