import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('[FATAL] MONGO_URI not set');
  process.exit(1);
}

async function main() {
  const c = new MongoClient(uri);
  await c.connect();
  try {
    const prep = c.db('nearcade-prep').collection('regions');
    const dev = c.db('nearcade-dev').collection('regions');

    // Get all field names from both collections
    const fieldSet = new Set<string>();
    for await (const doc of prep.find().limit(1000))
      for (const k of Object.keys(doc)) fieldSet.add(k);
    for await (const doc of dev.find().limit(1000))
      for (const k of Object.keys(doc)) fieldSet.add(k);
    console.log('All fields found:', [...fieldSet].sort());

    // Check _nameSources, _wikidataQid, _enrichmentMatch, _settlementType, _adminType
    const prepSample = await prep.findOne({ _nameSources: { $exists: true } });
    const devSample = await dev.findOne({ _nameSources: { $exists: true } });
    console.log('\nPrep has _nameSources:', !!prepSample);
    console.log('Dev has _nameSources:', !!devSample);

    // Count docs with _wikidataQid
    const prepQidCount = await prep.countDocuments({ _wikidataQid: { $exists: true } });
    const devQidCount = await dev.countDocuments({ _wikidataQid: { $exists: true } });
    console.log('\nDocs with _wikidataQid: prep=', prepQidCount, 'dev=', devQidCount);

    // Count docs with _enrichmentMatch
    const prepMatchCount = await prep.countDocuments({ _enrichmentMatch: { $exists: true } });
    const devMatchCount = await dev.countDocuments({ _enrichmentMatch: { $exists: true } });
    console.log('Docs with _enrichmentMatch: prep=', prepMatchCount, 'dev=', devMatchCount);

    // Count docs with location
    const prepLocCount = await prep.countDocuments({ location: { $exists: true } });
    const devLocCount = await dev.countDocuments({ location: { $exists: true } });
    console.log('Docs with location: prep=', prepLocCount, 'dev=', devLocCount);

    // Count docs with population
    const prepPopCount = await prep.countDocuments({ population: { $exists: true, $ne: null } });
    const devPopCount = await dev.countDocuments({ population: { $exists: true, $ne: null } });
    console.log('Docs with population: prep=', prepPopCount, 'dev=', devPopCount);

    // Count docs with area
    const prepAreaCount = await prep.countDocuments({ area: { $exists: true, $ne: null } });
    const devAreaCount = await dev.countDocuments({ area: { $exists: true, $ne: null } });
    console.log('Docs with area: prep=', prepAreaCount, 'dev=', devAreaCount);

    // Sample a doc from each to see structure
    const prepDoc = await prep.findOne({ id: 'CN-510112' });
    const devDoc = await dev.findOne({ id: 'CN-510112' });
    console.log('\nSample CN-510112:');
    console.log('prep:', JSON.stringify(prepDoc, null, 2));
    console.log('dev:', JSON.stringify(devDoc, null, 2));
  } finally {
    await c.close();
  }
}
main();
