import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('[FATAL] MONGO_URI not set');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const prep = client.db('nearcade-prep').collection('regions');
    const dev = client.db('nearcade-dev').collection('regions');

    const [prepCount, devCount] = await Promise.all([prep.countDocuments(), dev.countDocuments()]);
    console.log('nearcade-prep.regions:', prepCount, 'documents');
    console.log('nearcade-dev.regions:', devCount, 'documents');

    const prepIds = new Set<string>();
    const prepById = new Map<string, Record<string, unknown>>();
    for await (const doc of prep
      .find()
      .project({ id: 1, name: 1, level: 1, parentId: 1, population: 1, area: 1 })) {
      prepIds.add(doc.id as string);
      prepById.set(doc.id as string, doc);
    }

    const devIds = new Set<string>();
    const devById = new Map<string, Record<string, unknown>>();
    for await (const doc of dev
      .find()
      .project({ id: 1, name: 1, level: 1, parentId: 1, population: 1, area: 1 })) {
      devIds.add(doc.id as string);
      devById.set(doc.id as string, doc);
    }

    const onlyPrep = [...prepIds].filter((id) => !devIds.has(id)).sort();
    const onlyDev = [...devIds].filter((id) => !prepIds.has(id)).sort();

    console.log('\nOnly in nearcade-prep:', onlyPrep.length);
    for (const id of onlyPrep.slice(0, 30)) {
      const doc = prepById.get(id)!;
      console.log(`  ${id} level=${doc.level} name=${JSON.stringify(doc.name)}`);
    }
    if (onlyPrep.length > 30) console.log(`  ... and ${onlyPrep.length - 30} more`);

    console.log('\nOnly in nearcade-dev:', onlyDev.length);
    for (const id of onlyDev.slice(0, 30)) {
      const doc = devById.get(id)!;
      console.log(`  ${id} level=${doc.level} name=${JSON.stringify(doc.name)}`);
    }
    if (onlyDev.length > 30) console.log(`  ... and ${onlyDev.length - 30} more`);

    const common = [...prepIds].filter((id) => devIds.has(id));
    console.log('\nCommon IDs:', common.length);

    let diffs = 0;
    const fieldDiffs: Record<string, number> = {};
    for (const id of common) {
      const p = prepById.get(id)!;
      const d = devById.get(id)!;
      for (const key of ['name', 'level', 'parentId', 'population', 'area']) {
        const pv = JSON.stringify(p[key] ?? null);
        const dv = JSON.stringify(d[key] ?? null);
        if (pv !== dv) {
          diffs++;
          fieldDiffs[key] = (fieldDiffs[key] ?? 0) + 1;
          if (diffs <= 20)
            console.log(
              `  DIFF ${id} [${key}]: prep=${pv.slice(0, 120)} | dev=${dv.slice(0, 120)}`
            );
        }
      }
    }
    console.log('Total differing fields:', diffs);
    console.log('Per-field breakdown:', JSON.stringify(fieldDiffs));

    console.log('\nPrep level breakdown:');
    for (const l of await prep
      .aggregate([{ $group: { _id: '$level', count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
      .toArray()) {
      console.log(`  ${l._id}`, l.count);
    }
    console.log('Dev level breakdown:');
    for (const l of await dev
      .aggregate([{ $group: { _id: '$level', count: { $sum: 1 } } }, { $sort: { _id: 1 } }])
      .toArray()) {
      console.log(`  ${l._id}`, l.count);
    }
  } finally {
    await client.close();
  }
}
main();
