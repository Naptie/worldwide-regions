import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BSON } from 'bson';
import type { PipelineRegion, RegionNode } from './types.js';
import { createSelectorRegions } from './selector.js';
import type { SelectorRegion } from './selector.js';
import { buildTree } from './schema.js';

const OUTPUT_DIR = join(process.cwd(), 'output');
function ensureOutputDir() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ── production projection: strip pipeline-only fields ──
interface ProductionRegion {
  id: string;
  parentId: string | null;
  level: string;
  name: Record<string, string>;
  population: number | null;
  area: number | null;
  location: { type: 'Point'; coordinates: [number, number] } | null;
}

function toProduction(node: PipelineRegion): ProductionRegion {
  return {
    id: node.id,
    parentId: node.parentId,
    level: node.level,
    name: node.name,
    population: node.population,
    area: node.area,
    location: node.location
  };
}

// ── hierarchical JSON ──
function serializeNode(node: RegionNode): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const p = toProduction(node);
  obj.id = p.id;
  obj.parentId = p.parentId;
  obj.level = p.level;
  obj.name = p.name;
  if (p.population !== null) obj.population = p.population;
  if (p.area !== null) obj.area = p.area;
  if (p.location !== null) obj.location = p.location;
  if (node.children.length > 0) obj.children = node.children.map(serializeNode);
  return obj;
}

export function writeHierarchicalJson(regions: PipelineRegion[]): string {
  console.log('[Serialize] Building hierarchical JSON...');
  const tree = buildTree(regions);
  const data = tree.map(serializeNode);
  const path = join(OUTPUT_DIR, 'regions-hierarchical.json');
  writeFileSync(path, JSON.stringify(data), 'utf-8');
  const sizeMB = (Buffer.byteLength(JSON.stringify(data)) / 1_048_576).toFixed(2);
  console.log(`[Serialize] Wrote ${path} (${sizeMB} MB, ${data.length} top-level nodes)`);
  return path;
}

// ── selector hierarchy ──
interface SelectorNode extends SelectorRegion {
  children: SelectorNode[];
}

function serializeSelectorNode(node: SelectorNode): Record<string, unknown> {
  const obj = serializeNode(node);
  obj.kind = node.kind;
  if (node.children.length > 0) obj.children = node.children.map(serializeSelectorNode);
  return obj;
}

export function writeSelectorHierarchy(regions: PipelineRegion[]): string {
  console.log('[Serialize] Building settlement selector hierarchy...');
  const byId = new Map<string, SelectorNode>();
  for (const region of createSelectorRegions(regions)) {
    byId.set(region.id, { ...region, children: [] });
  }
  const roots: SelectorNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const path = join(OUTPUT_DIR, 'place-selector-hierarchy.json');
  writeFileSync(path, JSON.stringify(roots.map(serializeSelectorNode)), 'utf-8');
  console.log(`[Serialize] Wrote ${path} (${byId.size} selector records)`);
  return path;
}

// ── flat CSV ──
function csvEscape(value: string | number | null): string {
  if (value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n'))
    return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function writeFlatCsv(regions: PipelineRegion[]): string {
  console.log('[Serialize] Building flat CSV...');
  const header = 'id,parentId,level,name,population,area,location';
  const rows = regions.map((r) =>
    [
      csvEscape(r.id),
      csvEscape(r.parentId),
      csvEscape(r.level),
      csvEscape(JSON.stringify(r.name)),
      csvEscape(r.population),
      csvEscape(r.area),
      csvEscape(r.location ? JSON.stringify(r.location) : null)
    ].join(',')
  );
  const csv = [header, ...rows].join('\n');
  const path = join(OUTPUT_DIR, 'regions-flat.csv');
  writeFileSync(path, csv, 'utf-8');
  console.log(`[Serialize] Wrote ${path} (${regions.length} rows)`);
  return path;
}

// ── BSON ──
export function writeFlatBson(regions: PipelineRegion[]): string {
  console.log('[Serialize] Building BSON for MongoDB...');
  const buffers: Uint8Array[] = [];
  for (const region of regions) {
    const p = toProduction(region);
    buffers.push(BSON.serialize(p));
  }
  const bsonBuffer = Buffer.concat(buffers);
  const path = join(OUTPUT_DIR, 'regions-flat.bson');
  writeFileSync(path, bsonBuffer);
  const sizeMB = (bsonBuffer.length / 1_048_576).toFixed(2);
  console.log(`[Serialize] Wrote ${path} (${sizeMB} MB, ${regions.length} documents)`);
  return path;
}

// ── entry point ──
export function serializeAll(regions: PipelineRegion[]) {
  ensureOutputDir();
  return {
    jsonPath: writeHierarchicalJson(regions),
    csvPath: writeFlatCsv(regions),
    bsonPath: writeFlatBson(regions),
    selectorPath: writeSelectorHierarchy(regions)
  };
}
