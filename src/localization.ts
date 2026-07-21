import OpenCC from 'opencc-js';
import { pinyin } from 'pinyin-pro';
import { applyCanonicalLabel } from './canonical-labels.js';
import type { PipelineRegion, DisplayNameSource } from './types.js';

const toJapaneseShinjitai = OpenCC.Converter({ from: 'cn', to: 'jp' });
const CHINESE_DISPLAY = /^[\p{Script=Han}\p{N}\p{P}\p{Zs}]+$/u;
const JAPANESE_DISPLAY =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{N}\p{P}\p{Zs}]+$/u;
const HAN = /\p{Script=Han}/u;

export interface ChinaLocalizationReport {
  total: number;
  canonical: number;
  fallbackEnglish: number;
  fallbackChinese: number;
  fallbackJapanese: number;
}

/**
 * Complete PRC display names after identified-source enrichment. Wikidata labels
 * remain untouched; source Chinese names provide deterministic script-safe fallbacks.
 */
export function completeChinaLocalization(regions: PipelineRegion[]): ChinaLocalizationReport {
  const byId = new Map(regions.map((region) => [region.id, region]));
  const report: ChinaLocalizationReport = {
    total: 0,
    canonical: 0,
    fallbackEnglish: 0,
    fallbackChinese: 0,
    fallbackJapanese: 0
  };

  for (const region of regions) {
    if (!isChinaRegion(region, byId)) continue;
    report.total++;
    region._nameSources ??= defaultNameSources(region);
    if (applyCanonicalLabel(region)) report.canonical++;

    if (!region.name.zh || !CHINESE_DISPLAY.test(region.name.zh)) {
      if (!CHINESE_DISPLAY.test(region.name.en)) {
        throw new Error(`China region ${region.id} has no valid Chinese display name`);
      }
      region.name.zh = region.name.en;
      report.fallbackChinese++;
    }

    if (!region.name.ja || !JAPANESE_DISPLAY.test(region.name.ja)) {
      region.name.ja = toJapaneseShinjitai(region.name.zh);
      report.fallbackJapanese++;
      region._nameSources.ja = 'opencc-japanese-fallback';
    }

    if (!region.name.en || HAN.test(region.name.en)) {
      region.name.en = fallbackEnglishName(region.name.zh, region.id);
      report.fallbackEnglish++;
      region._nameSources.en = 'hanyu-pinyin-fallback';
    }

    if (
      !region.name.zh ||
      !region.name.ja ||
      !CHINESE_DISPLAY.test(region.name.zh) ||
      !JAPANESE_DISPLAY.test(region.name.ja)
    ) {
      throw new Error(`China region ${region.id} failed locale script validation`);
    }
  }

  return report;
}

export function hasValidChineseDisplayName(value: string | null): boolean {
  return value !== null && value.length > 0 && CHINESE_DISPLAY.test(value);
}

export function hasValidJapaneseDisplayName(value: string | null): boolean {
  return value !== null && value.length > 0 && JAPANESE_DISPLAY.test(value);
}

function defaultNameSources(region: PipelineRegion): Record<string, DisplayNameSource> {
  const wikidata = region._enrichmentMatch !== undefined;
  return {
    en: wikidata ? 'wikidata' : 'source',
    cn: wikidata ? 'wikidata' : 'source',
    ja: wikidata ? 'wikidata' : 'source'
  };
}

function fallbackEnglishName(nameCn: string, id: string): string {
  const romanized = pinyin(nameCn, { toneType: 'none', type: 'array' })
    .map((syllable) => syllable.charAt(0).toUpperCase() + syllable.slice(1))
    .join(' ');
  const territory = id.slice(3, 5);
  if (territory === '71' || territory === '81' || territory === '82') {
    throw new Error(`HMT region ${id} lacks a canonical English label`);
  }
  return romanized;
}

function isChinaRegion(region: PipelineRegion, byId: Map<string, PipelineRegion>): boolean {
  let current: PipelineRegion | undefined = region;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.id === 'CN') return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}
