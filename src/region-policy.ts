import type { PipelineRegion, Region } from './types.js';

interface HmtEntity {
  qid: string;
  admin_type: string;
  name_en?: string;
  name_cn?: string;
  name_ja?: string;
}

const HMT_ENTITY_BY_REGION_ID: Record<string, HmtEntity> = {
  'CN-71': {
    qid: 'Q57251',
    admin_type: 'province',
    name_en: 'Taiwan Province',
    name_cn: '台湾省',
    name_ja: '台湾省'
  },
  'CN-81': {
    qid: 'Q8646',
    admin_type: 'special administrative region',
    name_en: 'Hong Kong Special Administrative Region',
    name_cn: '香港特别行政区',
    name_ja: '香港特別行政区'
  },
  'CN-82': {
    qid: 'Q14773',
    admin_type: 'special administrative region',
    name_en: 'Macao Special Administrative Region',
    name_cn: '澳门特别行政区',
    name_ja: 'マカオ特別行政区'
  }
};

const TAIWAN_P300_BY_REGION_ID: Record<string, string> = {
  'CN-7101': 'TW-TPE',
  'CN-7102': 'TW-NWT',
  'CN-7103': 'TW-TAO',
  'CN-7104': 'TW-TXG',
  'CN-7105': 'TW-TNN',
  'CN-7106': 'TW-KHH',
  'CN-7107': 'TW-KEE',
  'CN-7108': 'TW-HSZ',
  'CN-7109': 'TW-CYI',
  'CN-7110': 'TW-HSQ',
  'CN-7111': 'TW-MIA',
  'CN-7112': 'TW-CHA',
  'CN-7113': 'TW-NAN',
  'CN-7114': 'TW-YUN',
  'CN-7115': 'TW-CYQ',
  'CN-7116': 'TW-PIF',
  'CN-7117': 'TW-ILA',
  'CN-7118': 'TW-HUA',
  'CN-7119': 'TW-TTT',
  'CN-7120': 'TW-PEN'
};

function applyHmtNames(region: PipelineRegion, entity: HmtEntity): void {
  if (entity.name_en) region.name.en = entity.name_en;
  if (entity.name_cn) region.name.zh = entity.name_cn;
  if (entity.name_ja) region.name.ja = entity.name_ja;
  region._adminType = entity.admin_type;
}

export function hmtEntityFor(region: Region): HmtEntity | undefined {
  return HMT_ENTITY_BY_REGION_ID[region.id];
}

export function taiwanP300For(region: Region): string | undefined {
  return TAIWAN_P300_BY_REGION_ID[region.id];
}

export function applyHmtDisplayName(region: PipelineRegion): void {
  const entity = hmtEntityFor(region);
  if (entity) applyHmtNames(region, entity);
}
