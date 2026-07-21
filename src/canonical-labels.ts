import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DisplayNameSource, PipelineRegion } from './types.js';

interface CanonicalLabel {
  qid?: string;
  name_en?: string | null;
  name_cn?: string | null;
  name_ja?: string | null;
  source: DisplayNameSource;
}

interface CanonicalLabelFile {
  labels: Record<string, CanonicalLabel>;
}

const CRAWLED_LABELS_PATH = join(process.cwd(), 'resources', 'canonical-labels.json');

/** Official-name residue where Wikidata topology has no unique match. */
const TERRITORY_OVERRIDES: Record<string, CanonicalLabel> = {
  'CN-7108': { name_en: 'Hsinchu City', source: 'source' },
  'CN-710801': { name_en: 'East District', source: 'source' },
  'CN-710802': { name_en: 'North District', source: 'source' },
  'CN-7109': { name_en: 'Chiayi City', source: 'source' },
  'CN-710901': { name_en: 'East District', source: 'source' },
  'CN-710902': { name_en: 'West District', source: 'source' },
  'CN-7110': { name_en: 'Hsinchu County', source: 'source' },
  'CN-711101': { name_en: 'Toufen City', source: 'source' },
  'CN-710306': { name_en: 'Luzhu District', source: 'source' },
  'CN-710309': { name_en: 'Daxi District', source: 'source' },
  'CN-710311': { name_en: 'Guanyin District', source: 'source' },
  'CN-710312': { name_en: 'Xinwu District', source: 'source' },
  'CN-710313': { name_en: 'Fuxing District', source: 'source' },
  'CN-8101': {
    name_en: 'Hong Kong Island',
    name_cn: '香港岛',
    name_ja: '香港島',
    source: 'official-hk-had'
  },
  'CN-8202': {
    name_en: 'Macao Islands',
    name_cn: '澳门外岛',
    name_ja: 'マカオ離島',
    source: 'official-macao'
  },
  'CN-820201': {
    name_en: 'Our Lady of Carmel Parish (Taipa)',
    name_cn: '嘉模堂区（氹仔）',
    name_ja: '嘉模堂区（タイパ）',
    source: 'official-macao'
  },
  'CN-820202': {
    name_en: 'St. Francis Xavier Parish (Coloane)',
    name_cn: '圣方济各堂区（路环）',
    name_ja: '聖フランシスコ・ザビエル堂区（コロアネ）',
    source: 'official-macao'
  }
};

let crawledLabels: Record<string, CanonicalLabel> | null = null;

function loadCrawledLabels(): Record<string, CanonicalLabel> {
  if (crawledLabels) return crawledLabels;
  if (!existsSync(CRAWLED_LABELS_PATH)) return {};
  const data = JSON.parse(readFileSync(CRAWLED_LABELS_PATH, 'utf8')) as CanonicalLabelFile;
  crawledLabels = data.labels;
  return crawledLabels;
}

export function applyCanonicalLabel(region: PipelineRegion): boolean {
  const label = loadCrawledLabels()[region.id] ?? TERRITORY_OVERRIDES[region.id];
  if (!label) return false;

  if (label.qid) region._wikidataQid = label.qid;
  if (label.name_en) region.name.en = label.name_en;
  if (label.name_cn) region.name.zh = label.name_cn;
  if (label.name_ja) region.name.ja = label.name_ja;
  region._nameSources = {
    en: label.name_en ? label.source : (region._nameSources?.en ?? 'source'),
    cn: label.name_cn ? label.source : (region._nameSources?.cn ?? 'source'),
    ja: label.name_ja ? label.source : (region._nameSources?.ja ?? 'source')
  };
  return true;
}
