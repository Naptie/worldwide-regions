import OpenCC from 'opencc-js';
import type { PipelineRegion } from './types.js';
import { cachedLabelsForQid } from './wikidata-cache.js';

const toSimplified = OpenCC.Converter({ from: 't', to: 'cn' });
const NAME_FIELDS = ['en', 'zh', 'ja'] as const;

export interface RegionNormalizationReport {
  simplifiedChinese: number;
  commasRemoved: number;
  redundantChildrenRemoved: number;
  duplicateWikidataIdsResolved: number;
}

/** Enforce output-wide identity and display-name invariants before serialization. */
export function normalizeRegions(regions: PipelineRegion[]): {
  regions: PipelineRegion[];
  report: RegionNormalizationReport;
} {
  const report: RegionNormalizationReport = {
    simplifiedChinese: 0,
    commasRemoved: 0,
    redundantChildrenRemoved: 0,
    duplicateWikidataIdsResolved: 0
  };

  for (const region of regions) {
    if (region.name.zh) {
      const simplified = toSimplified(region.name.zh);
      if (simplified !== region.name.zh) {
        region.name.zh = simplified;
        report.simplifiedChinese++;
      }
    }
    for (const field of NAME_FIELDS) {
      const value = region.name[field];
      if (!value || !/[,，]/u.test(value)) continue;
      region.name[field] = value.replace(/\s*[,，]\s*/gu, ' · ');
      report.commasRemoved++;
    }
  }

  const byId = new Map(regions.map((region) => [region.id, region]));
  const childrenByParent = new Map<string, PipelineRegion[]>();
  for (const region of regions) {
    if (!region.parentId) continue;
    const children = childrenByParent.get(region.parentId) ?? [];
    children.push(region);
    childrenByParent.set(region.parentId, children);
  }
  const redundant = new Set<string>();
  for (const region of regions) {
    if (!region.parentId) continue;
    const parent = byId.get(region.parentId);
    if (!parent) continue;
    const duplicateAdministrativeRegion =
      region._settlementType === undefined &&
      (sameName(region.name.en, parent.name.en) ||
        (region.level === 'county' &&
          NAME_FIELDS.some((field) => sameName(region.name[field], parent.name[field]))) ||
        (region._wikidataQid !== undefined && region._wikidataQid === parent._wikidataQid));
    if (duplicateAdministrativeRegion) {
      for (const child of childrenByParent.get(region.id) ?? []) child.parentId = parent.id;
      redundant.add(region.id);
      continue;
    }
  }
  report.redundantChildrenRemoved = redundant.size;
  const normalized = regions.filter((region) => !redundant.has(region.id));

  const byQid = new Map<string, PipelineRegion[]>();
  for (const region of normalized) {
    if (!region._wikidataQid) continue;
    const matches = byQid.get(region._wikidataQid) ?? [];
    matches.push(region);
    byQid.set(region._wikidataQid, matches);
  }
  for (const [qid, matches] of byQid) {
    if (matches.length < 2) continue;
    const owner = [...matches].sort(
      (left, right) => scoreQidOwner(right, qid) - scoreQidOwner(left, qid)
    )[0];
    for (const region of matches) {
      if (region === owner) continue;
      region._wikidataQid = undefined;
      if (region._enrichmentMatch === 'wikidata') region._enrichmentMatch = undefined;
      report.duplicateWikidataIdsResolved++;
    }
  }

  return { regions: normalized, report };
}

function sameName(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\p{P}\p{Z}\p{S}]/gu, '');
  return normalize(left) === normalize(right);
}

function scoreQidOwner(region: PipelineRegion, qid: string): number {
  const stableMatch =
    region._enrichmentMatch === 'p442' ||
    region._enrichmentMatch === 'iso2' ||
    region._enrichmentMatch === 'iso3166_2';
  let score = stableMatch ? 10_000 : 0;
  const cached = cachedLabelsForQid(qid);
  if (cached) {
    if (cached.name_en && sameName(region.name.en, cached.name_en)) score += 2_000;
    if (cached.name_cn && sameName(region.name.zh, cached.name_cn)) score += 2_000;
    if (cached.name_ja && sameName(region.name.ja, cached.name_ja)) score += 1_000;
    if (cached.lat != null && cached.lon != null && region.location?.coordinates != null) {
      const lat = region.location.coordinates[1];
      const lon = region.location.coordinates[0];
      const distance = Math.hypot(lat - cached.lat, lon - cached.lon);
      score += Math.max(0, 1_000 - distance * 100);
    }
  }
  if (region.population != null) score += 100;
  if (region.area != null) score += 50;
  if (region.location != null) score += 25;
  score -= region.id.length / 100;
  return score;
}
