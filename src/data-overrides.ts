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
  /** Replacement display names, when the source label itself is wrong. */
  name?: { en: string; zh?: string; ja?: string };
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
  // The same dr5hn wrong-parent class found while auditing UK seaside arcades:
  // each record's own coordinates place it in the correct county, so these are
  // misfilings rather than same-name confusions.
  'GB:50297': {
    expectName: 'Leysdown-on-Sea',
    parentId: 'GB-KEN',
    reason: 'Leysdown-on-Sea is on the Isle of Sheppey, Kent (0.92,51.40) — not Southend-on-Sea'
  },
  'GB:48950': {
    expectName: 'Chertsey',
    parentId: 'GB-SRY',
    reason: 'Chertsey is in Runnymede, Surrey (-0.51,51.39) — not Hounslow'
  },
  'GB:51398': {
    expectName: 'St Ives',
    parentId: 'GB-CON',
    reason: 'St Ives is the Cornwall coastal town (-5.49,50.21) — not the Isles of Scilly'
  },
  'GB:51742': {
    expectName: 'Walton-on-the-Naze',
    parentId: 'GB-ESS',
    reason: 'Walton-on-the-Naze is in Tendring, Essex (1.27,51.85) — not Suffolk'
  },
  // dr5hn stores Barcelona, Spain coordinates on Barceloneta, Puerto Rico
  // (lat/lon belong to the wrong continent); the record is otherwise correct
  // (parent PR-017 Barceloneta municipality).
  'PR:153557': {
    expectName: 'Barceloneta',
    location: { type: 'Point', coordinates: [-66.538611, 18.450556] },
    wikidataQid: 'Q2025087',
    reason: 'source coords are Barcelona, Spain; real location from Wikidata Q2025087'
  },
  // Three Chinese counties whose Wikidata-enriched coordinates sit tens to
  // hundreds of kilometres from the county seat (wrong entity matched or bad
  // P625). Verified against AMap district centers during the nearcade
  // addr-audit follow-up; shops in these counties were flagged ~60-110 km off.
  'CN-360783': {
    expectName: 'Longnan',
    location: { type: 'Point', coordinates: [114.804474, 24.901216] },
    reason: 'Wikidata coords landed ~110 km north of the 龙南市 seat; AMap district center'
  },
  'CN-340124': {
    expectName: 'Lujiang County',
    location: { type: 'Point', coordinates: [117.288165, 31.256978] },
    reason: 'Wikidata coords landed on Hefei; AMap district center for 庐江县'
  },
  'CN-450126': {
    expectName: 'Binyang County',
    location: { type: 'Point', coordinates: [108.810336, 23.217771] },
    reason: 'Wikidata coords landed on Nanning; AMap district center for 宾阳县'
  },
  // dr5hn's 2026-10 refresh labels MA-06 "Fès Meknès" while MA-03 already is
  // "Fès-Meknès"; every MA-06 child (Casablanca, Mohammedia, Settat, El
  // Jadida…) belongs to Casablanca-Settat. Wikidata Q19843788: P300 = MA-06.
  'MA-06': {
    expectName: 'Fès Meknès',
    location: { type: 'Point', coordinates: [-7.58333, 33.5333] },
    name: { en: 'Casablanca-Settat', zh: '卡萨布兰卡-塞塔特大区', ja: 'カサブランカ＝セタット地方' },
    reason: 'MA-06 is Casablanca-Settat (Wikidata Q19843788 P300=MA-06); dr5hn labeled it like MA-03 Fès-Meknès'
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
    if (override.name) {
      region.name.en = override.name.en;
      if (override.name.zh) region.name.zh = override.name.zh;
      if (override.name.ja) region.name.ja = override.name.ja;
    }
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
