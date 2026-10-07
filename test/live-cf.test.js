'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { TrainingService } = require('../lib/service');

// Opt-in: talks to public CF API and uses a freshly named disposable Mongo database.
test('live CF API: catalog, complete historical reference, submissions and prediction', {
  skip: !process.env.CFTRAIN_LIVE_TEST || !process.env.CFTRAIN_TEST_MONGO_URL,
  timeout: 240000,
}, async () => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const name = `cftrain_test_${randomUUID().replaceAll('-', '')}`;
  try {
    const svc = new TrainingService(client.db(name));
    await svc.init();
    await svc.syncCatalog();
    assert.ok(await svc.catalog.countDocuments({ kind: 'contest' }) > 500);
    const meta = await svc.importContest(1919);
    assert.equal(meta.contest.type, 'CF');
    assert.equal(meta.referenceCount, meta.ratedCount, 'all rated historical rows are represented');
    assert.ok(meta.referenceCount > 1000);
    assert.ok(meta.slots.every(s => s.points > 0));
    const engine = await svc.reference(meta._id);
    const prediction = engine({ points: 1000, penalty: 0 }, 1400);
    assert.ok(Number.isInteger(prediction.newRating));
    const submissions = await svc.client.call('user.status', { handle: 'tourist', from: 1, count: 2 });
    assert.equal(submissions.length, 2);
    assert.ok(submissions.every(s => Number.isInteger(s.id) && s.problem && s.author));
    console.log(JSON.stringify({ contest: meta.contest.name, referenceCount: meta.referenceCount,
      slots: meta.slots.length, prediction, submissions: submissions.length }));
  } finally {
    assert.match(name, /^cftrain_test_[a-f0-9]{32}$/);
    await client.db(name).dropDatabase();
    await client.close();
  }
});
