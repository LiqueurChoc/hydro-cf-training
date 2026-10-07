'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { backup, restore } = require('../scripts/database-backup.cjs');
const storageManifest = require('../scripts/storage-manifest.cjs');
const { collections } = require('../scripts/recovery-contract.json');
test('backup format 2 preserves BSON index predicates without Mongo', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const temporaryParent = path.resolve(os.tmpdir());
  const temporaryRoot = fs.mkdtempSync(path.join(temporaryParent, 'cftrain-index-test-'));
  const cutoff = new Date('2025-01-01T00:00:00Z');
  const sourceIndex = {
    v: 2,
    name: 'synthetic_date_partial',
    key: { date: 1 },
    partialFilterExpression: { date: { $gte: cutoff } },
  };
  const restoredIndexes = [];
  function emptyCursor() {
    return { sort() { return this; }, async *[Symbol.asyncIterator]() {} };
  }
  function database(source) {
    return {
      listCollections: () => ({
        next: async () => ({ type: 'collection', options: {} }),
        toArray: async () => [],
      }),
      createCollection: async () => {},
      dropDatabase: async () => {},
      collection: () => ({
        find: emptyCursor,
        listIndexes: () => ({ toArray: async () => source ? [sourceIndex] : [] }),
        insertOne: async () => {},
        createIndexes: async indexes => { restoredIndexes.push(...indexes); },
      }),
    };
  }
  try {
    const directory = path.join(temporaryRoot, 'backup');
    await backup({ db: () => database(true) }, {
      database: 'synthetic_source_only',
      collections: Object.fromEntries(collections.map(name => [name, name])),
    }, directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'backup.json'), 'utf8'));
    assert.equal(manifest.format, 2);
    assert.match(manifest.entries[0].indexes[0], /\$date/);
    const restored = await restore({ db: () => database(false) }, directory);
    assert.match(restored, /^cftrain_restore_/);
    assert.equal(restoredIndexes.length, collections.length);
    const restoredCutoff = restoredIndexes[0].partialFilterExpression.date.$gte;
    assert.ok(restoredCutoff instanceof Date);
    assert.equal(restoredCutoff.getTime(), cutoff.getTime());
  } finally {
    const resolved = path.resolve(temporaryRoot);
    assert.equal(path.dirname(resolved), temporaryParent);
    assert.match(path.basename(resolved), /^cftrain-index-test-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('Mongo: offline backup restores mapped namespaces, indexes, settlement and T01-T08 fields into isolated database', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => {
  const { MongoClient, Long, ObjectId, Binary } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const name = `cftrain_test_${randomUUID().replaceAll('-', '')}`, db = client.db(name);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cftrain-backup-test-'));
  let restored;
  try {
    const manifest = storageManifest({ db, collection: n => db.collection(n === 'cftrain_state' ? 'mapped_state' : `school.${n}`) });
    const state = { _id: 'fixture', revision: 9, groups: [{ id: 'g', ownerId: 1, adminIds: [2] }],
      accounts: [{ uid: 2, bindingId: 'binding', syncGeneration: 3, syncRequest: { generation: 3, since: 100 },
        syncAttempt: 2, cycle: { generation: 3, cursor: 501 }, scanProofs: [{ generation: 2, bindingId: 'binding', startedAt: 300, completedAt: 400, coveredSince: 100 }] }],
      ratingBaselines: { 2: { rating: 1400, source: 'legacy' } },
      runs: [{ id: 'r', status: 'cancelled', cancelledAt: 500, cancelledBy: 1,
        screening: [{ evidence: [{ id: 'seen' }] }], exposureEvidence: { 2: [{ id: 'seen' }] },
        exposureCorrections: [{ uid: 2, evidenceIds: ['seen'], actor: 1, reason: 'fixture', at: 200 }] }],
      ledger: [{ runId: 'r', snapshot: 'ref', algorithm: 'fixture', inputs: [{ uid: 2, points: 10 }],
        scoreSnapshot: { rows: [{ uid: 2, points: 10 }] }, endAt: 400 }], audit: [{ action: 'cancel_draft' }] };
    for (const logical of collections) {
      const col = db.collection(manifest.collections[logical]);
      await col.insertOne(logical === 'cftrain_state' ? state : { _id: logical, account: 'binding', generation: 3, attempt: 2,
        data: { verdict: 'OK' }, rows: [{ rating: 1400 }], value: Long.fromString('9007199254740993'),
        date: new Date(2000), oid: new ObjectId(), binary: new Binary(Buffer.from('fixture')) });
      await col.createIndex({ account: 1 }, { name: 'account_lookup', sparse: true });
      await col.createIndex({ date: 1 }, { name: 'date_partial',
        partialFilterExpression: { date: { $gte: new Date(2000) } } });
    }
    const directory = path.join(root, 'backup');
    await backup(client, manifest, directory);
    restored = await restore(client, directory);
    assert.notEqual(restored, name);
    for (const logical of collections) {
      const physical = manifest.collections[logical];
      assert.deepEqual(await client.db(restored).collection(physical).find().toArray(), await db.collection(physical).find().toArray());
      assert.deepEqual(await client.db(restored).collection(physical).listIndexes().toArray(), await db.collection(physical).listIndexes().toArray());
    }
    assert.deepEqual(await db.collection('mapped_state').findOne({ _id: 'fixture' }), state, 'source untouched');
    fs.appendFileSync(path.join(directory, 'cftrain_submission.ejson'), '{}\n');
    await assert.rejects(restore(client, directory), /checksum mismatch/);
  } finally {
    if (restored) await client.db(restored).dropDatabase();
    await db.dropDatabase(); await client.close(); fs.rmSync(root, { recursive: true, force: true });
  }
});
