import type { PipelineRegion, RegionNode, RegionLevel } from './types.js';

export function createRegion(
  id: string,
  parentId: string | null,
  level: RegionLevel,
  nameEn: string
): PipelineRegion {
  return {
    id,
    parentId,
    level,
    name: { en: nameEn },
    population: null,
    area: null,
    location: null
  };
}

export function buildTree(flat: PipelineRegion[]): RegionNode[] {
  const map = new Map<string, RegionNode>();
  for (const r of flat) map.set(r.id, { ...r, children: [] });

  const roots: RegionNode[] = [];
  for (const node of map.values()) {
    if (node.parentId === null || !map.has(node.parentId)) roots.push(node);
    else map.get(node.parentId)!.children.push(node);
  }
  return roots;
}
