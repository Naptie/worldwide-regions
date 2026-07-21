/**
 * Phase 2: Geopolitical Pruning (PRC Compliance)
 *
 * Applies required mutations on the RoW (dr5hn) data before merging
 * with the China (modood) hierarchy. These deletions/reassignments
 * are legally mandated for PRC-compliant mapping services.
 */
import type { PipelineRegion } from './types.js';

interface ComplianceReport {
  removedTW: boolean;
  removedHK: boolean;
  removedMO: boolean;
  removedArunachalPradesh: boolean;
  removedKalayaan: boolean;
  removedHoangSa: boolean;
  removedTruongSa: boolean;
  reparentedKosovo: boolean;
  totalRemoved: number;
}

/**
 * Apply all PRC compliance mutations to the RoW region array.
 * Returns the mutated array and a report of what was changed.
 */
export function applyCompliancePruning(rowRegions: PipelineRegion[]): {
  regions: PipelineRegion[];
  report: ComplianceReport;
} {
  const report: ComplianceReport = {
    removedTW: false,
    removedHK: false,
    removedMO: false,
    removedArunachalPradesh: false,
    removedKalayaan: false,
    removedHoangSa: false,
    removedTruongSa: false,
    reparentedKosovo: false,
    totalRemoved: 0
  };

  let regions = [...rowRegions]; // shallow copy to mutate
  const initialCount = regions.length;

  // ── 0. Remove China (CN) from dr5hn — fully handled by modood ──
  console.log('[Compliance] Removing CN from RoW (handled by modood)...');
  regions = removeCountryCascade(regions, 'CN', () => {});

  // ── 1. Remove Taiwan, Hong Kong, Macau from RoW ─────────────────
  console.log('[Compliance] Removing TW, HK, MO from RoW...');
  regions = removeCountryCascade(regions, 'TW', () => {
    report.removedTW = true;
  });
  regions = removeCountryCascade(regions, 'HK', () => {
    report.removedHK = true;
  });
  regions = removeCountryCascade(regions, 'MO', () => {
    report.removedMO = true;
  });

  // ── 2. Remove Arunachal Pradesh (IN-AR) from India ──────────────
  console.log('[Compliance] Removing Arunachal Pradesh (IN-AR) from India...');
  regions = removeStateCascade(regions, 'IN-AR', () => {
    report.removedArunachalPradesh = true;
  });

  // ── 3. Remove South China Sea competing city claims ─────────────
  console.log('[Compliance] Removing SCS competing claims...');

  // Kalayaan Island Group — a municipality in Palawan, Philippines.
  // Scope by parent ID: the source also contains an unrelated Kalayaan in Laguna.
  regions = removeCityByParentAndName(regions, 'PH-PLW', 'Kalayaan', (count) => {
    if (count > 0) report.removedKalayaan = true;
  });

  // Hoang Sa / Hoàng Sa — in Da Nang, Vietnam (match both with/without diacritics)
  regions = removeCitiesByName(regions, 'Hoang Sa', (count) => {
    if (count > 0) report.removedHoangSa = true;
  });
  if (!report.removedHoangSa) {
    regions = removeCitiesByName(regions, 'Hoàng Sa', (count) => {
      if (count > 0) report.removedHoangSa = true;
    });
  }

  // Truong Sa / Trường Sa — in Khanh Hoa, Vietnam
  regions = removeCitiesByName(regions, 'Truong Sa', (count) => {
    if (count > 0) report.removedTruongSa = true;
  });
  if (!report.removedTruongSa) {
    regions = removeCitiesByName(regions, 'Trường Sa', (count) => {
      if (count > 0) report.removedTruongSa = true;
    });
  }

  // ── 4. Kosovo → Serbia reparenting ──────────────────────────────
  console.log('[Compliance] Reparenting Kosovo (XK) → Serbia (RS)...');
  const result = reparentKosovoToSerbia(regions);
  regions = result.regions;
  report.reparentedKosovo = result.didReparent;

  report.totalRemoved = initialCount - regions.length;
  console.log(`[Compliance] Done. Removed ${report.totalRemoved} regions.`);

  return { regions, report };
}

// ── Internal Helpers ──────────────────────────────────────────────

/**
 * Remove a country and ALL its descendants (states, cities) by country ISO2 code.
 */
function removeCountryCascade(
  regions: PipelineRegion[],
  countryCode: string,
  onRemoved: () => void
): PipelineRegion[] {
  const before = regions.length;

  // Collect all descendant ids
  const toRemove = new Set<string>();

  // The country node itself
  const countryNode = regions.find((r) => r.id === countryCode);
  if (!countryNode) return regions;
  toRemove.add(countryCode);

  // All direct children (states/provinces) whose parent is this country
  for (const r of regions) {
    if (r.parentId === countryCode) {
      toRemove.add(r.id);
      // And all grandchildren (cities) whose parent is this state
      for (const r2 of regions) {
        if (r2.parentId === r.id) {
          toRemove.add(r2.id);
        }
      }
    }
  }

  const result = regions.filter((r) => !toRemove.has(r.id));
  if (result.length < before) onRemoved();

  return result;
}

/**
 * Remove a specific state and ALL its child cities by composite state id (e.g. "IN-AR").
 */
function removeStateCascade(
  regions: PipelineRegion[],
  stateId: string,
  onRemoved: () => void
): PipelineRegion[] {
  const toRemove = new Set<string>();
  toRemove.add(stateId);

  // Find all cities whose parent is this state
  for (const r of regions) {
    if (r.parentId === stateId) {
      toRemove.add(r.id);
    }
  }

  const result = regions.filter((r) => !toRemove.has(r.id));
  if (result.length < regions.length) onRemoved();

  return result;
}

/**
 * Remove a city only when both its source parent and name identify the target.
 */
function removeCityByParentAndName(
  regions: PipelineRegion[],
  parentId: string,
  cityName: string,
  onRemoved: (count: number) => void
): PipelineRegion[] {
  const lower = cityName.toLowerCase();
  const result = regions.filter(
    (region) =>
      region.level !== 'city' ||
      region.parentId !== parentId ||
      region.name.en.toLowerCase() !== lower
  );
  const removed = regions.length - result.length;
  if (removed > 0) onRemoved(removed);
  return result;
}

/**
 * Remove city-level regions matching a name across the source hierarchy.
 */
function removeCitiesByName(
  regions: PipelineRegion[],
  cityName: string,
  onRemoved: (count: number) => void
): PipelineRegion[] {
  const lower = cityName.toLowerCase();
  const result = regions.filter(
    (region) => region.level !== 'city' || region.name.en.toLowerCase() !== lower
  );
  const removed = regions.length - result.length;
  if (removed > 0) onRemoved(removed);
  return result;
}

/**
 * Reparent Kosovo (XK) to Serbia (RS):
 * 1. Delete the XK country node.
 * 2. Move all XK's child states to RS (update parentId).
 * 3. Move all child cities accordingly (parentId update cascades through state id change).
 */
function reparentKosovoToSerbia(regions: PipelineRegion[]): {
  regions: PipelineRegion[];
  didReparent: boolean;
} {
  const kosovoIdx = regions.findIndex((r) => r.id === 'XK');
  if (kosovoIdx === -1) return { regions, didReparent: false };

  // Find Serbia
  const serbiaExists = regions.some((r) => r.id === 'RS');
  if (!serbiaExists) {
    console.warn('[Compliance] WARNING: Serbia (RS) not found — cannot reparent Kosovo');
    return { regions, didReparent: false };
  }

  // Step 1: Find all Kosovo states (children of XK)
  const kosovoStateIds = new Set<string>();
  for (const r of regions) {
    if (r.parentId === 'XK') {
      kosovoStateIds.add(r.id);
    }
  }

  // Step 2: Check for state_code collisions with existing RS states.
  // Kosovo states use "XK-XX" ids; we need to re-id them to "RS-XX" format.
  // dr5hn Kosovo state codes might overlap with Serbia's, so we use unique suffixes.
  const stateIdMap = new Map<string, string>(); // oldId → newId

  for (const oldId of kosovoStateIds) {
    // Extract the state_code portion (after "XK-")
    const stateCode = oldId.slice(3);
    const newId = `RS-${stateCode}`;

    // If collision, append a suffix
    if (regions.some((r) => r.id === newId)) {
      stateIdMap.set(oldId, `${newId}-XK`);
    } else {
      stateIdMap.set(oldId, newId);
    }
  }

  // Step 3: Reparent states to RS and re-id
  const result = regions
    .filter((r) => r.id !== 'XK') // remove the XK country node
    .map((r) => {
      // Reparent state nodes
      if (kosovoStateIds.has(r.id)) {
        const newId = stateIdMap.get(r.id)!;
        return { ...r, id: newId, parentId: 'RS' };
      }

      // Reparent city nodes whose parent was a Kosovo state
      if (r.parentId && stateIdMap.has(r.parentId)) {
        const oldParent = r.parentId;
        const newParent = stateIdMap.get(oldParent)!;
        // Also update the city id to match new state prefix
        const oldPrefix = oldParent;
        const newCityId = r.id.replace(oldPrefix, newParent);
        return { ...r, id: newCityId, parentId: newParent };
      }

      return r;
    });

  return { regions: result, didReparent: true };
}
