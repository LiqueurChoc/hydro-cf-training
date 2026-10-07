'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TrainingService } = require('../lib/service');
const c = require('../lib/core');
const exposure = require('../lib/exposure');

function fixture(t) {
  const now = Date.now(), startAt = now - 7200000;
  let state = { _id: 'evidence', revision: 1, accounts: [{ uid: 2, handle: 'student', bindingId: 'b',
    approved: true, verified: true, historyComplete: true, lastSyncAt: now, status: 'ready', ratingHistory: [],
    scanProofs: [{ bindingId: 'b', generation: 1, startedAt: now, completedAt: now, coveredSince: 0 }] }],
  groups: [], notices: [], ledger: [], ratingBaselines: { 2: { rating: 1400 } }, runs: [{
    id: 'run', title: 'fixture', status: 'published', contestId: 100, snapshot: 'ref', startAt,
    durationSeconds: 3600, rated: true, attendees: [2], members: [{ uid: 2, handle: 'student', bindingId: 'b' }],
    rules: c.rules('CF'), slots: [{ index: 'A', points: 500, original: { contestId: 100, index: 'A' },
      actual: { contestId: 100, index: 'A' } }],
    screening: [{ uid: 2, unknown: false, attended: false, touched: ['100/A'], accepted: [] }],
  }] };
  const service = new TrainingService({ collection: () => ({ find: () => ({ toArray: async () => [] }) }) });
  service.state = async () => structuredClone(state);
  service.change = async (_, apply) => { const next = structuredClone(state); const result = await apply(next); next.revision++; state = next; return result; };
  service.allRecords = async () => [];
  service.refs = { findOne: async () => ({ contest: { type: 'CF' } }), find: () => ({ toArray: async () => [
    { rows: [{ points: 500, penalty: 0, rating: 1800 }, { points: 0, penalty: 0, rating: 1200 }] },
  ] }) };
  t.after(() => service.close());
  return service;
}

test('published exposure remains after the personal notice has been deleted', async t => {
  const service = fixture(t);
  const result = await service.result('evidence', 'run');
  assert.equal(result.rows[0].eligible, false, 'publication evidence must survive deletion');
  assert.deepEqual(result.rows[0].history.touched, ['100/A']);
});

test('unknown clears, legacy positives survive, and missing snapshots do not invent evidence', async t => {
  const service = fixture(t);
  await service.change('evidence', s => { s.runs[0].screening = [{ uid: 2, unknown: true, touched: [] }]; });
  assert.equal((await service.result('evidence', 'run')).rows[0].eligible, true);
  await service.change('evidence', s => { s.runs[0].screening[0].attended = true; });
  assert.equal((await service.result('evidence', 'run')).rows[0].eligible, false);
  await service.change('evidence', s => { delete s.runs[0].screening; });
  const row = (await service.result('evidence', 'run')).rows[0];
  assert.equal(row.eligible, true);
  assert.equal(row.history.publicationMissing, true);
});

test('publication screening retains public submission and participation despite missing live records', async t => {
  const service = fixture(t), at = Date.now();
  service.allRecords = async () => [{ id: 77, contestId: 100, problem: { contestId: 100, index: 'A' },
    creationTimeSeconds: at / 1000 - 10000, verdict: 'WRONG_ANSWER', author: { participantType: 'VIRTUAL' } }];
  const checks = await service.screening('evidence', [2], 100, [{ contestId: 100, index: 'A' }], at);
  await service.change('evidence', s => { s.runs[0].screening = checks; });
  service.allRecords = async () => [];
  const row = (await service.result('evidence', 'run')).rows[0];
  assert.equal(row.eligible, false);
  assert.equal(row.history.attended, true);
  assert.deepEqual(row.history.evidence.map(e => e.source).sort(), ['participation', 'submission']);
});

test('coach correction is scoped, audited, cannot waive other conditions, and rejects stale tokens', async t => {
  const service = fixture(t);
  await service.change('evidence', s => { s.runs.push({ ...structuredClone(s.runs[0]), id: 'other' }); });
  const before = await service.preview('evidence', 'run');
  const ids = before.rows[0].history.evidence.map(e => e.id);
  await assert.rejects(service.correctExposure('evidence', 'run', 2, ids, '  ', 1), /理由/);
  await assert.rejects(service.correctExposure('evidence', 'run', 2, ['invented'], '核对误报', 1), /证据已变化/);
  await service.correctExposure('evidence', 'run', 2, ids, '核对误报', 1);
  let state = await service.state('evidence');
  assert.deepEqual(state.audit[0].evidenceIds, ids);
  assert.equal(state.audit[0].actor, 1);
  assert.equal(state.audit[0].reason, '核对误报');
  assert.ok(state.audit[0].at > 0);
  assert.equal((await service.result('evidence', 'other')).rows[0].eligible, false);
  assert.equal((await service.result('evidence', 'run')).rows[0].eligible, true);
  await assert.rejects(service.settle('evidence', 'run', before.token, 1), /预览已变化/);
  for (const condition of ['practice', 'unknown', 'absent', 'coverage']) {
    await service.change('evidence', s => {
      s.runs[0].members[0].practice = condition === 'practice';
      s.runs[0].attendees = condition === 'absent' ? [] : [2];
      s.accounts[0].approved = condition !== 'unknown';
      if (condition === 'coverage') s.accounts[0].scanProofs = [];
    });
    const result = await service.result('evidence', 'run');
    if (condition === 'coverage') assert.equal(result.complete, false);
    else assert.equal([...result.rows, ...result.absent][0].eligible, false);
  }
});

test('late public evidence is independent of corrected manual evidence; void/re-settle preserves both', async t => {
  const service = fixture(t);
  const initial = await service.preview('evidence', 'run');
  await service.correctExposure('evidence', 'run', 2, initial.rows[0].history.evidence.map(e => e.id), '误报', 1);
  const corrected = await service.preview('evidence', 'run');
  await service.change('evidence', s => exposure.capture(s, 2, [{ id: 88, contestId: 100,
    creationTimeSeconds: s.runs[0].startAt / 1000 - 1, problem: { contestId: 100, index: 'A' } }]));
  await assert.rejects(service.settle('evidence', 'run', corrected.token, 1), /预览已变化/);
  const exposed = await service.preview('evidence', 'run');
  assert.equal(exposed.rows[0].eligible, false);
  await service.settle('evidence', 'run', exposed.token, 1);
  await assert.rejects(service.correctExposure('evidence', 'run', 2, ['submission:88:problem'], '误报', 1), /撤销/);
  await service.change('evidence', s => {
    const now = Date.now();
    s.ledger[0].void = true; s.ledger[0].voidAt = now;
    s.runs[0].status = 'published';
    s.accounts[0].scanProofs = [{ bindingId: 'b', generation: 2, startedAt: now + 1, completedAt: now + 1, coveredSince: 0 }];
  });
  assert.equal((await service.preview('evidence', 'run')).rows[0].eligible, false);
  await service.correctExposure('evidence', 'run', 2, ['submission:88:problem'], '复核公开证据', 1);
  const again = await service.preview('evidence', 'run');
  assert.equal(again.rows[0].eligible, true);
  await service.settle('evidence', 'run', again.token, 1);
  assert.equal((await service.state('evidence')).ledger.filter(e => !e.void).length, 1);
});

test('manual correction survives delete/re-add and concurrent state change refuses correction', async t => {
  const service = fixture(t);
  await service.change('evidence', s => {
    s.runs[0].screening = [];
    s.notices.push({ uid: 2, key: '100/A', createdAt: 1 });
    exposure.capture(s, 2);
  });
  await service.correctExposure('evidence', 'run', 2, ['notice:100/A'], '误报', 1);
  await service.change('evidence', s => {
    s.notices = [];
    exposure.capture(s, 2);
    s.notices.push({ uid: 2, key: '100/A', createdAt: 2 });
    exposure.capture(s, 2);
  });
  assert.equal((await service.result('evidence', 'run')).rows[0].eligible, true);
  const original = service.result.bind(service);
  service.result = async (...args) => {
    const result = await original(...args);
    await service.change('evidence', s => { s.runs[0].members[0].practice = true; });
    return result;
  };
  await assert.rejects(service.correctExposure('evidence', 'run', 2, ['notice:100/A'], '竞态', 1), /档案已变化/);
  assert.equal((await service.state('evidence')).audit.length, 1);
});

test('successful sync page retains pre-start evidence even when later history no longer contains it', async t => {
  const service = fixture(t), state = await service.state('evidence');
  await service.change('evidence', s => { s.runs[0].screening = []; });
  service.records.bulkWrite = async () => {};
  service.client = { call: async method => method === 'user.rating' ? [] : [{ id: 91, contestId: 100,
    problem: { contestId: 100, index: 'A' }, creationTimeSeconds: Math.floor(state.runs[0].startAt / 1000) - 10,
    author: { participantType: 'VIRTUAL' }, verdict: 'WRONG_ANSWER' }] };
  assert.equal(await service.syncPage('evidence', { bindingId: 'b', since: 0 }), true);
  const row = (await service.result('evidence', 'run')).rows[0];
  assert.equal(row.eligible, false);
  assert.equal(row.history.attended, true);
  assert.equal(row.history.evidence.length, 2);
});

test('Mongo: sync persists later pre-start public evidence and corrections across service restart', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async t => {
  const { MongoClient } = require('mongodb');
  const { randomUUID } = require('node:crypto');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db = client.db(`cftrain_test_${randomUUID().replaceAll('-', '')}`);
  const service = new TrainingService(db), restarted = new TrainingService(db);
  try {
    await service.init();
    const seed = await fixture(t).state('evidence');
    seed.runs[0].screening = [{ uid: 2, unknown: true, touched: [] }];
    await db.collection('cftrain_state').insertOne(seed);
    service.client = { call: async method => method === 'user.rating' ? [] : [{ id: 7, contestId: 100,
      problem: { contestId: 100, index: 'A' }, creationTimeSeconds: Math.floor(seed.runs[0].startAt / 1000) - 60,
      author: { participantType: 'PRACTICE' }, verdict: 'WRONG_ANSWER' }] };
    await service.queueSync('evidence', 2, 0);
    const job = await service.jobs.findOne({ domainId: 'evidence' });
    assert.equal(await service.syncPage('evidence', job.payload), true);
    await service.jobs.updateOne({ _id: job._id }, { $set: { status: 'done' } });
    assert.equal((await service.result('evidence', 'run')).rows[0].eligible, false);
    await service.records.deleteMany({ account: 'b' });
    await restarted.init();
    assert.equal((await restarted.result('evidence', 'run')).rows[0].eligible, false);
    await restarted.correctExposure('evidence', 'run', 2, ['submission:7:problem'], '核实误报', 1);
    assert.equal((await service.result('evidence', 'run')).rows[0].eligible, true);
    assert.equal((await service.state('evidence')).audit[0].actor, 1);
  } finally {
    service.close(); restarted.close();
    await db.dropDatabase(); await client.close();
  }
});
