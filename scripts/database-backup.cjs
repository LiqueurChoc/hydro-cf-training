'use strict';
// Offline plugin-only backup. Restore ALWAYS creates an independent random database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { collections } = require('./recovery-contract.json');
function mapping(manifest) {
  if (!manifest.database || !manifest.collections || collections.some(k => typeof manifest.collections[k] !== 'string')
    || new Set(Object.values(manifest.collections)).size !== collections.length) throw new Error('Invalid storage manifest');
  return manifest;
}
async function backup(client, manifest, directory) {
  const { EJSON } = require('mongodb').BSON;
  mapping(manifest);
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 }); // Never overwrite a backup.
  const db = client.db(manifest.database), entries = [];
  for (const logical of collections) {
    const physical = manifest.collections[logical];
    const info = await db.listCollections({ name: physical }).next();
    if (info && (info.type !== 'collection' || Object.keys(info.options || {}).length)) throw new Error('Custom collection options require native mongodump/mongorestore');
    const file = `${logical}.ejson`, hash = crypto.createHash('sha256');
    const fd = fs.openSync(path.join(directory, file), 'wx', 0o600);
    let count = 0;
    try {
      for await (const doc of db.collection(physical).find({}, { promoteValues: false }).sort({ _id: 1 })) {
        const line = EJSON.stringify(doc, { relaxed: false }) + '\n';
        fs.writeSync(fd, line); hash.update(line); count++;
      }
    } finally { fs.closeSync(fd); }
    const indexes = info ? await db.collection(physical).listIndexes().toArray() : [];
    entries.push({ logical, physical, file, count, exists: !!info, sha256: hash.digest('hex'),
      // Keep index predicates such as Date/Long/ObjectId values in extended JSON.
      // Plain JSON would silently turn BSON values into strings/numbers on restore.
      indexes: indexes.map(index => EJSON.stringify(index, { relaxed: false })) });
  }
  fs.writeFileSync(path.join(directory, 'backup.json'), JSON.stringify({ format: 2, createdAt: new Date().toISOString(), manifest, entries }, null, 2), { flag: 'wx', mode: 0o600 });
}
async function restore(client, directory) {
  const { EJSON } = require('mongodb').BSON;
  const meta = JSON.parse(fs.readFileSync(path.join(directory, 'backup.json'), 'utf8'));
  mapping(meta.manifest);
  if (![1, 2].includes(meta.format) || meta.entries.length !== collections.length
    || new Set(meta.entries.map(e => e.logical)).size !== collections.length) throw new Error('Invalid backup manifest');
  for (const e of meta.entries) {
    if (!collections.includes(e.logical) || e.file !== `${e.logical}.ejson`
      || e.physical !== meta.manifest.collections[e.logical]) throw new Error('Invalid backup entry');
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(path.join(directory, e.file))) hash.update(chunk);
    if (hash.digest('hex') !== e.sha256) throw new Error(`Backup checksum mismatch: ${e.logical}`);
  }
  const name = `cftrain_restore_${crypto.randomUUID().replaceAll('-', '')}`, db = client.db(name);
  if ((await db.listCollections().toArray()).length) throw new Error('Restore target already exists');
  try {
    for (const e of meta.entries) {
      if (e.exists) await db.createCollection(e.physical);
      let count = 0;
      const lines = readline.createInterface({ input: fs.createReadStream(path.join(directory, e.file)), crlfDelay: Infinity });
      for await (const line of lines) { await db.collection(e.physical).insertOne(EJSON.parse(line, { relaxed: false })); count++; }
      if (count !== e.count) throw new Error('Backup count mismatch');
      for (const encoded of e.indexes) {
        // Format 2 stores each index as EJSON. Format 1 remains readable for
        // existing primitive-only backups; take a new format 2 backup before
        // recovering BSON index predicates from a legacy backup.
        const { v, ns, ...index } = typeof encoded === 'string'
          ? EJSON.parse(encoded, { relaxed: false }) : encoded;
        if (index.name !== '_id_') await db.collection(e.physical).createIndexes([index]);
      }
      const hash = crypto.createHash('sha256');
      for await (const doc of db.collection(e.physical).find({}, { promoteValues: false }).sort({ _id: 1 })) hash.update(EJSON.stringify(doc, { relaxed: false }) + '\n');
      if (hash.digest('hex') !== e.sha256) throw new Error(`Restored data mismatch: ${e.logical}`);
    }
    return name;
  } catch (e) { await db.dropDatabase(); throw e; }
}
module.exports = { backup, restore, mapping };
if (require.main === module) (async () => {
  const [mode, directory, manifestFile, ack] = process.argv.slice(2);
  if (!['backup', 'restore-isolated'].includes(mode)) throw new Error('Use backup or restore-isolated');
  if (mode === 'backup' && ack !== '--writers-stopped') throw new Error('Stop ALL Hydro/CLI writers before taking offline backup');
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_BACKUP_MONGO_URL);
  try {
    if (mode === 'backup') await backup(client, JSON.parse(fs.readFileSync(manifestFile, 'utf8')), directory);
    else console.log(`Verified isolated restore database: ${await restore(client, directory)}`);
  } finally { await client.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
