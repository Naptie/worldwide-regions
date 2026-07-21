import { BSON } from 'bson';
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const URI = process.env.MONGO_URI;
if (!URI) {
  console.error('[FATAL] MONGO_URI environment variable is not set');
  process.exit(1);
}

const url = new URL(URI);
const DB = url.searchParams.get('dbName');
if (!DB) {
  console.error('[FATAL] MONGO_URI does not contain a dbName query parameter');
  process.exit(1);
}

const COLLECTION = 'regions';
const BSON_PATH = resolve(process.argv[2] ?? 'output/regions-flat.bson');

const buffer = readFileSync(BSON_PATH);
const documents: Record<string, unknown>[] = [];
let offset = 0;
while (offset + 4 <= buffer.length) {
  const size = buffer.readInt32LE(offset);
  if (size <= 0 || offset + size > buffer.length) {
    console.warn(`Skipping ${buffer.length - offset} trailing bytes at offset ${offset} (size=${size})`);
    break;
  }
  const doc = BSON.deserialize(Buffer.from(buffer.subarray(offset, offset + size))) as Record<string, unknown>;
  documents.push(doc);
  offset += size;
}
console.log(`Read ${documents.length} documents from ${BSON_PATH}`);

const client = new MongoClient(URI, { appName: 'worldwide-regions-import', retryWrites: true });
await client.connect();
try {
  const db = client.db(DB);
  const collections = await db.listCollections({ name: COLLECTION }).toArray();
  if (collections.length > 0) {
    console.log(`Dropping existing collection "${COLLECTION}"...`);
    await db.collection(COLLECTION).drop();
  }
  await db.createCollection(COLLECTION);
  const coll = db.collection(COLLECTION);

  const BATCH = 5000;
  for (let i = 0; i < documents.length; i += BATCH) {
    const batch = documents.slice(i, i + BATCH);
    await coll.insertMany(batch, { ordered: false });
    console.log(`  Inserted ${i + batch.length}/${documents.length}`);
  }

  const count = await coll.countDocuments();
  console.log(`Imported ${count} documents into ${DB}.${COLLECTION}`);

  const indexes = [
    { key: { level: 1 } },
    { key: { parentId: 1 } },
    { key: { _wikidataQid: 1 }, sparse: true }
  ];
  for (const idx of indexes) {
    await coll.createIndex(idx.key, { ...idx, background: true } as never);
  }
  console.log('Created indexes: level, parentId, _wikidataQid');

  const sample = await coll.findOne({ level: 'country' });
  const name = sample?.name as Record<string, string> | undefined;
  console.log('Sample country:', name?.en, `(${sample?.id})`);
} finally {
  await client.close();
}
