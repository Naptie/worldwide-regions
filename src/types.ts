// ── Production Region Schema ─────────────────────────────────────

export type RegionLevel = 'country' | 'province' | 'city' | 'county';

export interface GeoPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

/** Production fields emitted to output. */
export interface Region {
  id: string;
  parentId: string | null;
  level: RegionLevel;
  /** Locale-keyed display names. `en` is always present. */
  name: Record<string, string>;
  population: number | null;
  area: number | null;
  location: GeoPoint | null;
}

// ── Pipeline-only enrichment fields ──────────────────────────────

export type DisplayNameSource =
  | 'source'
  | 'wikidata'
  | 'wikidata-territory-crawl'
  | 'official-hk-had'
  | 'official-macao'
  | 'hanyu-pinyin-fallback'
  | 'opencc-japanese-fallback';

export interface PipelineFields {
  /** Source classification; undefined = administrative, set = populated place. */
  _settlementType?: string;
  /** Official administrative kind, when known. */
  _adminType?: string;
  /** Provenance of each localized label. */
  _nameSources?: Record<string, DisplayNameSource>;
  /** Stable Wikidata entity selected during enrichment. */
  _wikidataQid?: string;
  /** Resolver tier. */
  _enrichmentMatch?: 'p442' | 'iso2' | 'iso3166_2' | 'unique-country-name' | 'wikidata';
}

export type PipelineRegion = Region & PipelineFields;

/** A region with optional children for tree construction. */
export type RegionNode = PipelineRegion & { children: RegionNode[] };

// ── Wikidata SPARQL types ────────────────────────────────────────

export interface SparqlBinding {
  type: 'uri' | 'literal' | 'bnode';
  value: string;
  'xml:lang'?: string;
  datatype?: string;
}

export interface SparqlResult {
  head: { vars: string[] };
  results: { bindings: Record<string, SparqlBinding>[] };
}

export interface WikidataEnrichment {
  qid: string;
  name: Record<string, string | null>;
  population: number | null;
  area: number | null;
  lat: number | null;
  lon: number | null;
}
