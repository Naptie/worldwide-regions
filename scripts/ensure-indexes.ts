import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;
if (!uri) { console.error('[FATAL] MONGO_URI not set'); process.exit(1); }

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  try {
    const dbName = new URL(uri).searchParams.get('dbName') ?? 'nearcade-prep';
    const coll = c.db(dbName).collection('regions');

    const existing = await coll.indexes();
    console.log('Existing indexes:', existing.map(i => ({ name: i.name, key: i.key })));

    if (!existing.some(i => i.name === 'id_1')) {
      await coll.createIndex({ id: 1 }, { background: true });
      console.log('Created: id');
    } else console.log('Already exists: id');

    if (!existing.some(i => i.name === 'level_1')) {
      await coll.createIndex({ level: 1 }, { background: true });
      console.log('Created: level');
    } else console.log('Already exists: level');

    if (!existing.some(i => i.name === 'parentId_1')) {
      await coll.createIndex({ parentId: 1 }, { background: true });
      console.log('Created: parentId');
    } else console.log('Already exists: parentId');

    const final = await coll.indexes();
    console.log('Final indexes:', final.map(i => ({ name: i.name, key: i.key })));
  } finally { await c.close(); }
}
main();
