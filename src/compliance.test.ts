import type { PipelineRegion } from './types.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCompliancePruning } from './compliance.js';
import { createRegion } from './schema.js';

// ── Kalayaan — scoped by parent ─────────────────────────────────────

test('removes Kalayaan under Palawan but preserves Kalayaan under Laguna', () => {
  const regions: PipelineRegion[] = [
    createRegion('PH', null, 'country', 'Philippines'),
    createRegion('PH-PLW', 'PH', 'province', 'Palawan'),
    createRegion('PH-LAG', 'PH', 'province', 'Laguna'),
    createRegion('PH-PLW-1', 'PH-PLW', 'city', 'Kalayaan'),
    createRegion('PH-LAG-1', 'PH-LAG', 'city', 'Kalayaan')
  ];

  const result = applyCompliancePruning(regions);

  assert.equal(result.report.removedKalayaan, true);
  assert.equal(
    result.regions.some((r) => r.id === 'PH-PLW-1'),
    false,
    'Kalayaan under Palawan must be removed'
  );
  assert.equal(
    result.regions.some((r) => r.id === 'PH-LAG-1'),
    true,
    'Kalayaan under Laguna must be preserved'
  );
});

// ── Country cascade removal ─────────────────────────────────────────

test('removes Taiwan and all its descendants', () => {
  const regions: PipelineRegion[] = [
    createRegion('TW', null, 'country', 'Taiwan'),
    createRegion('TW-TPE', 'TW', 'city', 'Taipei'),
    createRegion('TW-KHH', 'TW', 'city', 'Kaohsiung'),
    createRegion('JP', null, 'country', 'Japan')
  ];

  const result = applyCompliancePruning(regions);

  assert.equal(result.report.removedTW, true);
  assert.equal(
    result.regions.some((r) => r.id === 'TW'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'TW-TPE'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'TW-KHH'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'JP'),
    true
  );
});

test('removes Hong Kong and Macau', () => {
  const regions: PipelineRegion[] = [
    createRegion('HK', null, 'country', 'Hong Kong'),
    createRegion('HK-1', 'HK', 'city', 'Central'),
    createRegion('MO', null, 'country', 'Macau'),
    createRegion('MO-1', 'MO', 'city', 'Macau Peninsula'),
    createRegion('CN', null, 'country', 'China')
  ];

  const result = applyCompliancePruning(regions);

  assert.equal(result.report.removedHK, true);
  assert.equal(result.report.removedMO, true);
  assert.equal(
    result.regions.some((r) => r.id === 'HK'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'HK-1'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'MO'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'MO-1'),
    false
  );
  // CN is also removed (modood handles it)
  assert.equal(
    result.regions.some((r) => r.id === 'CN'),
    false
  );
});

// ── State cascade removal ───────────────────────────────────────────

test('removes Arunachal Pradesh (IN-AR) and its children from India', () => {
  const regions: PipelineRegion[] = [
    createRegion('IN', null, 'country', 'India'),
    createRegion('IN-AR', 'IN', 'province', 'Arunachal Pradesh'),
    createRegion('IN-AR-1', 'IN-AR', 'city', 'Itanagar'),
    createRegion('IN-MH', 'IN', 'province', 'Maharashtra'),
    createRegion('IN-MH-1', 'IN-MH', 'city', 'Mumbai')
  ];

  const result = applyCompliancePruning(regions);

  assert.equal(result.report.removedArunachalPradesh, true);
  assert.equal(
    result.regions.some((r) => r.id === 'IN-AR'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'IN-AR-1'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'IN'),
    true,
    'India country node preserved'
  );
  assert.equal(
    result.regions.some((r) => r.id === 'IN-MH'),
    true
  );
  assert.equal(
    result.regions.some((r) => r.id === 'IN-MH-1'),
    true
  );
});

// ── City by name (SCS islands) ──────────────────────────────────────

test('removes Hoang Sa cities by name (case-insensitive)', () => {
  const regions: PipelineRegion[] = [
    createRegion('VN', null, 'country', 'Vietnam'),
    createRegion('VN-DN', 'VN', 'province', 'Da Nang'),
    createRegion('VN-DN-1', 'VN-DN', 'city', 'Hoang Sa'),
    createRegion('VN-DN-2', 'VN-DN', 'city', 'Hoi An')
  ];

  const result = applyCompliancePruning(regions);

  assert.equal(result.report.removedHoangSa, true);
  assert.equal(
    result.regions.some((r) => r.id === 'VN-DN-1'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'VN-DN-2'),
    true
  );
});

test('removes Truong Sa cities by name (case-insensitive)', () => {
  const regions: PipelineRegion[] = [
    createRegion('VN', null, 'country', 'Vietnam'),
    createRegion('VN-KH', 'VN', 'province', 'Khanh Hoa'),
    createRegion('VN-KH-1', 'VN-KH', 'city', 'Truong Sa'),
    createRegion('VN-KH-2', 'VN-KH', 'city', 'Nha Trang')
  ];

  const result = applyCompliancePruning(regions);

  assert.equal(result.report.removedTruongSa, true);
  assert.equal(
    result.regions.some((r) => r.id === 'VN-KH-1'),
    false
  );
  assert.equal(
    result.regions.some((r) => r.id === 'VN-KH-2'),
    true
  );
});

// ── Name matching is case-insensitive on name.en ────────────────────

test('name.en matching is case-insensitive', () => {
  const regions: PipelineRegion[] = [
    createRegion('VN', null, 'country', 'Vietnam'),
    createRegion('VN-DN', 'VN', 'province', 'Da Nang'),
    createRegion('VN-DN-1', 'VN-DN', 'city', 'hoang sa') // lowercase
  ];

  const result = applyCompliancePruning(regions);

  assert.equal(result.report.removedHoangSa, true);
  assert.equal(
    result.regions.some((r) => r.id === 'VN-DN-1'),
    false
  );
});

test('name matching only applies to City-level regions', () => {
  // A state named "Hoang Sa" should NOT be removed
  const regions: PipelineRegion[] = [
    createRegion('VN', null, 'country', 'Vietnam'),
    createRegion('VN-HS', 'VN', 'province', 'Hoang Sa'),
    createRegion('VN-HS-1', 'VN-HS', 'city', 'Some City')
  ];

  const result = applyCompliancePruning(regions);

  // The state "Hoang Sa" should survive — only cities are matched
  assert.equal(
    result.regions.some((r) => r.id === 'VN-HS'),
    true
  );
  assert.equal(
    result.regions.some((r) => r.id === 'VN-HS-1'),
    true
  );
});

// ── Kosovo reparenting ──────────────────────────────────────────────

test('reparents Kosovo (XK) to Serbia (RS)', () => {
  const regions: PipelineRegion[] = [
    createRegion('RS', null, 'country', 'Serbia'),
    createRegion('XK', null, 'country', 'Kosovo'),
    createRegion('XK-PR', 'XK', 'province', 'Pristina'),
    createRegion('XK-PR-1', 'XK-PR', 'city', 'Pristina City')
  ];

  const result = applyCompliancePruning(regions);

  assert.equal(result.report.reparentedKosovo, true);
  // XK country node is removed
  assert.equal(
    result.regions.some((r) => r.id === 'XK'),
    false
  );
  // State is reparented to RS with new id
  const pristinaState = result.regions.find((r) => r.id === 'RS-PR');
  assert.equal(pristinaState?.parentId, 'RS', 'Pristina state parentId must be RS');
  // City is reparented accordingly
  const pristinaCity = result.regions.find((r) => r.id === 'RS-PR-1');
  assert.equal(pristinaCity?.parentId, 'RS-PR', 'Pristina city parentId must be RS-PR');
});

// ── Report integrity ────────────────────────────────────────────────

test('report.totalRemoved counts all removed regions', () => {
  const regions: PipelineRegion[] = [
    createRegion('TW', null, 'country', 'Taiwan'),
    createRegion('TW-TPE', 'TW', 'city', 'Taipei'),
    createRegion('HK', null, 'country', 'Hong Kong'),
    createRegion('JP', null, 'country', 'Japan')
  ];

  const result = applyCompliancePruning(regions);

  // Taiwan (1) + Taipei (1) + HK (1) = 3 removed; JP stays
  assert.equal(result.report.totalRemoved, 3);
});

test('report flags are false when nothing to remove', () => {
  const regions: PipelineRegion[] = [
    createRegion('JP', null, 'country', 'Japan'),
    createRegion('JP-TK', 'JP', 'city', 'Tokyo'),
    createRegion('DE', null, 'country', 'Germany')
  ];

  const result = applyCompliancePruning(regions);

  assert.equal(result.report.removedTW, false);
  assert.equal(result.report.removedHK, false);
  assert.equal(result.report.removedMO, false);
  assert.equal(result.report.removedArunachalPradesh, false);
  assert.equal(result.report.removedKalayaan, false);
  assert.equal(result.report.removedHoangSa, false);
  assert.equal(result.report.removedTruongSa, false);
  assert.equal(result.report.reparentedKosovo, false);
  assert.equal(result.report.totalRemoved, 0);
  assert.equal(result.regions.length, 3);
});
