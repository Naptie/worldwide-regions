import type { PipelineRegion } from './types.js';

export type SelectorKind = 'country' | 'admin_region' | 'settlement' | 'district';

export interface SelectorRegion extends PipelineRegion {
  kind: SelectorKind;
}

/**
 * Produce the customer-facing place index. China retains authoritative NBS
 * city and county/district levels; other countries expose typed settlements only.
 */
export function createSelectorRegions(regions: PipelineRegion[]): SelectorRegion[] {
  const byId = new Map(regions.map((region) => [region.id, region]));
  const selected = regions.filter((region) => {
    if (region.level === 'country' || region.level === 'province') return true;
    if (region._settlementType !== undefined) return region.level === 'city';
    return (
      isChinaAdministrativeRegion(region, byId) &&
      (region.level === 'city' || region.level === 'county')
    );
  });

  return selected
    .map((region) => ({ ...region, kind: selectorKind(region) }))
    .sort(compareSelectorRegions);
}

function isChinaAdministrativeRegion(
  region: PipelineRegion,
  byId: Map<string, PipelineRegion>
): boolean {
  let current: PipelineRegion | undefined = region;
  for (let depth = 0; current && depth < 4; depth++) {
    if (current.id === 'CN') return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

function selectorKind(region: PipelineRegion): SelectorKind {
  if (region.level === 'country') return 'country';
  if (region.level === 'province') return 'admin_region';
  if (region.level === 'county') return 'district';
  return 'settlement';
}

function compareSelectorRegions(a: SelectorRegion, b: SelectorRegion): number {
  const kindOrder: Record<SelectorKind, number> = {
    country: 0,
    admin_region: 1,
    settlement: 2,
    district: 3
  };
  const kindDifference = kindOrder[a.kind] - kindOrder[b.kind];
  if (kindDifference !== 0) return kindDifference;
  if (a.kind === 'settlement') {
    const populationDifference = (b.population ?? -1) - (a.population ?? -1);
    if (populationDifference !== 0) return populationDifference;
  }
  return a.name.en.localeCompare(b.name.en, 'en');
}
