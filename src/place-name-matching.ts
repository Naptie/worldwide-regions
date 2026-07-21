const POLITICAL_COUNTRY_PREFIXES = new Set([
  'arab',
  'democratic',
  'federal',
  'federated',
  'great',
  'islamic',
  'kingdom',
  'of',
  'people',
  'peoples',
  'plurinational',
  'republic',
  'socialist',
  'state',
  'states',
  'the',
  'united'
]);

const POLITICAL_COUNTRY_CORES = new Set(['america', 'china', 'korea', 'netherlands']);

const PLACE_QUALIFIERS = new Set([
  'administrative',
  'amphoe',
  'area',
  'autonomous',
  'bandar',
  'bandaraya',
  'capital',
  'chang',
  'city',
  'comunidad',
  'county',
  'daerah',
  'department',
  'departamento',
  'district',
  'do',
  'federal',
  'fu',
  'governorate',
  'greater',
  'gu',
  'gun',
  'ibukota',
  'kabupaten',
  'ken',
  'khusus',
  'kota',
  'metropolitan',
  'mueang',
  'municipal',
  'municipality',
  'prefecture',
  'province',
  'region',
  'regional',
  'regency',
  'republic',
  'shi',
  'si',
  'special',
  'state',
  'tambon',
  'to',
  'town',
  'village',
  'ward',
  'wat',
  'wilayah'
]);

function words(value: string): string[] {
  return (
    value
      .normalize('NFKD')
      .toLocaleLowerCase()
      .replace(/\p{M}/gu, '')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** Accent-, punctuation-, wrapper-, and qualifier-insensitive forms for place matching. */
export function placeNameForms(value: string | undefined): Set<string> {
  if (!value) return new Set();
  const normalized = value.normalize('NFKD').toLocaleLowerCase().replace(/\p{M}/gu, '');
  const segments = [
    normalized,
    normalized.replace(/\([^)]*\)/g, ' '),
    ...[...normalized.matchAll(/\(([^()]*)\)/g)].map((match) => match[1]),
    ...normalized.split(/[·,/;|]+/u)
  ];
  const forms = new Set<string>();
  for (const segment of segments) {
    const tokens = words(segment);
    if (tokens.length === 0) continue;
    forms.add(tokens.join(''));
    const core = tokens.filter((token) => !PLACE_QUALIFIERS.has(token));
    if (core.length > 0) forms.add(core.join(''));
  }
  return forms;
}

/** Derive ordinary and short political forms without maintaining country aliases. */
export function countryNameForms(value: string | undefined): Set<string> {
  if (!value) return new Set();
  const normalized = value.normalize('NFKD').toLocaleLowerCase().replace(/\p{M}/gu, '');
  const segments = [
    normalized,
    normalized.replace(/\([^)]*\)/g, ' '),
    ...[...normalized.matchAll(/\(([^()]*)\)/g)].map((match) => match[1])
  ];
  const forms = new Set<string>();
  for (const segment of segments) {
    const tokens = words(segment);
    if (tokens.length === 0) continue;
    forms.add(tokens.join(''));
    const political = tokens.filter((token) => POLITICAL_COUNTRY_PREFIXES.has(token));
    const ordinary = tokens.filter((token) => !POLITICAL_COUNTRY_PREFIXES.has(token));
    if (political.length > 0 && ordinary.length > 0) forms.add(ordinary.join(''));
    for (const core of ordinary.filter((token) => POLITICAL_COUNTRY_CORES.has(token))) {
      forms.add(core);
    }
    const connector = tokens.indexOf('of');
    if (connector > 1) forms.add(tokens.slice(0, connector).join(''));
  }
  return forms;
}

export function levenshteinSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}
