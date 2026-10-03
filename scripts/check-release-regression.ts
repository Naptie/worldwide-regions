import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BSON } from 'bson';

/**
 * Release guard: region IDs are hard-referenced by consumers (nearcade shops
 * store region-ID chains), so a release must never silently stop emitting an
 * ID the previous release had.
 *
 * Compares the freshly built regions-flat.bson against the previous release's
 * regions-flat.bson and fails when IDs were removed, unless they appear in
 * resources/regression-allowlist.json (intentional removals, e.g. the PH
 * same-QID duplicate filings dropped by the ingestion dedupe rule).
 *
 * Usage:
 *   npx tsx scripts/check-release-regression.ts <current.bson> <previous.bson>
 *   npx tsx scripts/check-release-regression.ts <current.bson> <previous.bson> --write-allowlist
 *
 * A missing previous file (first release, or no published release yet) passes
 * with a warning so the very first build is not blocked.
 */

const ALLOWLIST_PATH = resolve('resources', 'regression-allowlist.json');
interface Allowlist {
  comment: string;
  allowlistedIds: string[];
}

function loadBsonIds(path: string): Map<string, { level: string; name: Record<string, string> }> {
  const buffer = readFileSync(path);
  const ids = new Map<string, { level: string; name: Record<string, string> }>();
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const size = buffer.readInt32LE(offset);
    if (size <= 0 || offset + size > buffer.length) break;
    const doc = BSON.deserialize(buffer.subarray(offset, offset + size)) as {
      id?: string;
      level?: string;
      name?: Record<string, string>;
    };
    if (doc.id) ids.set(doc.id, { level: doc.level ?? '?', name: doc.name ?? {} });
    offset += size;
  }
  return ids;
}

function loadAllowlist(): Allowlist {
  if (!existsSync(ALLOWLIST_PATH)) return { comment: '', allowlistedIds: [] };
  return JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8')) as Allowlist;
}

function main(): number {
  const [currentPath, previousPath, ...flags] = process.argv.slice(2);
  if (!currentPath || !previousPath) {
    console.error(
      'Usage: check-release-regression.ts <current.bson> <previous.bson> [--write-allowlist]'
    );
    return 2;
  }

  const current = loadBsonIds(resolve(currentPath));
  console.log(`Current build: ${current.size} region IDs`);

  if (!existsSync(previousPath)) {
    console.warn(
      `[WARN] Previous release file not found at ${previousPath} — skipping ID regression check.`
    );
    return 0;
  }
  const previous = loadBsonIds(resolve(previousPath));
  console.log(`Previous release: ${previous.size} region IDs`);

  const removed = [...previous.keys()].filter((id) => !current.has(id));
  const added = [...current.keys()].filter((id) => !previous.has(id));
  console.log(`Added: ${added.length}, removed: ${removed.length}`);

  if (removed.length === 0) {
    console.log('[OK] No region IDs were removed.');
    return 0;
  }

  const allowlist = loadAllowlist();
  const allowlisted = new Set(allowlist.allowlistedIds);
  const unexpected = removed.filter((id) => !allowlisted.has(id));

  if (flags.includes('--write-allowlist')) {
    const merged = [...new Set([...allowlist.allowlistedIds, ...removed])].sort();
    const output: Allowlist = {
      comment:
        'Region IDs intentionally absent from new releases. The release guard ' +
        '(scripts/check-release-regression.ts) fails when any other previously published ' +
        'ID goes missing, because nearcade shops hard-reference region IDs. Every entry ' +
        'must be explained in the release notes.',
      allowlistedIds: merged
    };
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8');
    console.log(
      `Wrote ${merged.length} allowlisted IDs (added ${merged.length - allowlist.allowlistedIds.length} new) to ${ALLOWLIST_PATH}`
    );
    return 0;
  }

  if (unexpected.length === 0) {
    console.log(
      `[OK] ${removed.length} IDs removed, all covered by resources/regression-allowlist.json.`
    );
    return 0;
  }

  console.error(
    `\n[FATAL] ${unexpected.length} previously published region IDs are missing from this build ` +
      `and are not allowlisted. nearcade shops hard-reference region IDs; removing an ID ` +
      `orphans those references.\n`
  );
  for (const id of unexpected.slice(0, 40)) {
    const doc = previous.get(id)!;
    console.error(`  ${id} (${doc.level}, "${doc.name.en ?? '?'})"`);
  }
  if (unexpected.length > 40) console.error(`  … and ${unexpected.length - 40} more`);
  console.error(
    `\nIf these removals are intentional, add the IDs to resources/regression-allowlist.json ` +
      `(or re-run with --write-allowlist) and explain them in the release notes. ` +
      `Otherwise, investigate the source-data change before publishing.`
  );
  return 1;
}

process.exit(main());
