import type { GeoPoint, PipelineRegion } from './types.js';

/**
 * Verified corrections for source-data defects that cannot be fixed by a
 * generic rule because the record has no correct duplicate to dedupe against.
 * Each entry asserts facts checked against Wikidata/GeoNames; the expected
 * name guard keeps stale overrides from silently re-applying if the source
 * record is later renamed (which would mean the defect is gone and the
 * override must be re-reviewed).
 */
interface RegionOverride {
  /** Expected English source name at the time the override was verified. */
  expectName: string;
  parentId?: string;
  location?: GeoPoint;
  wikidataQid?: string;
  /** Why the override exists — kept next to the data for future audits. */
  reason: string;
}

export const REGION_OVERRIDES: Record<string, RegionOverride> = {
  // dr5hn files Margate (Kent) under the London Borough of Tower Hamlets;
  // there is no duplicate to dedupe against. GB-KEN Kent exists in the same
  // source; Thanet has no ISO code and no dr5hn state, so Margate hangs off
  // the county directly (matching every other UK settlement).
  'GB:50496': {
    expectName: 'Margate',
    parentId: 'GB-KEN',
    reason: 'Margate is in Kent (Wikidata Q618045 P131 = Thanet, Kent), not Tower Hamlets'
  },
  // dr5hn stores Barcelona, Spain coordinates on Barceloneta, Puerto Rico
  // (lat/lon belong to the wrong continent); the record is otherwise correct
  // (parent PR-017 Barceloneta municipality).
  'PR:153557': {
    expectName: 'Barceloneta',
    location: { type: 'Point', coordinates: [-66.538611, 18.450556] },
    wikidataQid: 'Q2025087',
    reason: 'source coords are Barcelona, Spain; real location from Wikidata Q2025087'
  }
};

/**
 * Regions that must never be offered as a selectable leaf. Currently the
 * Singapore capital leaf: Singapore is a city-state, so country-only text and
 * the coordinate fallback both collapse onto it instead of a planning area
 * (SG:153459–153482 under the CDC provinces).
 */
export const NON_SELECTABLE_REGIONS: Record<string, string> = {
  'SG:104057': 'co-extensive with its own country; selection should land on a planning area'
};

export interface DataOverrideReport {
  overridesApplied: number;
  nonSelectableMarked: number;
  skippedStale: string[];
}

export function applyDataOverrides(regions: PipelineRegion[]): DataOverrideReport {
  const report: DataOverrideReport = {
    overridesApplied: 0,
    nonSelectableMarked: 0,
    skippedStale: []
  };
  const byId = new Map(regions.map((region) => [region.id, region]));

  for (const [id, override] of Object.entries(REGION_OVERRIDES)) {
    const region = byId.get(id);
    if (!region) continue;
    if (region.name.en !== override.expectName) {
      report.skippedStale.push(
        `${id} (name is now "${region.name.en}", expected "${override.expectName}")`
      );
      continue;
    }
    if (override.parentId) region.parentId = override.parentId;
    if (override.location) region.location = override.location;
    if (override.wikidataQid) region._wikidataQid = override.wikidataQid;
    report.overridesApplied++;
  }

  for (const id of Object.keys(NON_SELECTABLE_REGIONS)) {
    const region = byId.get(id);
    if (!region) continue;
    region.selectable = false;
    report.nonSelectableMarked++;
  }

  return report;
}
