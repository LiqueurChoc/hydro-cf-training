'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { TrainingService } = require('../lib/service');
const c = require('../lib/core');

async function fixture(runTest) {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db = client.db(`cftrain_test_${randomUUID().replaceAll('-', '')}`);
  try {
    const service = new TrainingService(db);
    await service.init();
    await service.refs.insertMany([
      { _id: 'snapshot', contest: { type: 'CF' } },
      { _id: 'snapshot:0', snapshot: 'snapshot', rows: [
        { points: 500, penalty: 0, rating: 1800 },
        { points: 100, penalty: 0, rating: 1400 },
        { points: 0, penalty: 0, rating: 1000 },
      ] },
    ]);
    await runTest(service, db, client);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
}

function run(id, startAt) {
  return { id, title: id, contestId: 100, snapshot: 'snapshot', startAt,
    durationSeconds: 3600, rated: true, status: 'published',
    members: [{ uid: 2, handle: 'student', bindingId: 'binding' }], attendees: [2],
    rules: c.rules('CF'), slots: [{ index: 'A', points: 500,
      original: { contestId: 100, index: 'A' }, actual: { contestId: 100, index: 'A' } }] };
}

async function finish(service, since) {
  await service.queueSync('coverage', 2, since);
  const payload = (await service.jobs.findOne({ domainId: 'coverage', kind: 'sync' })).payload;
  let done = false;
  for (let page = 0; page < 10 && !done; page++) done = await service.syncPage('coverage', payload);
  assert.equal(done, true, 'fixture scan must reach the requested boundary or history end');
  await service.jobs.updateOne({ domainId: 'coverage', kind: 'sync' }, { $set: { status: 'done' } });
}

async function tickPage(service) {
  // Let one instance take the worker lock and process exactly one queued job,
  // so failures run through the real tick transition (job failed + account failed).
  await service.locks.updateOne({ _id: 'worker' }, { $set: { until: 0, owner: '' } });
  await service.tick();
}

function rejudgedHistory(now, oldStart) {
  const author = { members: [{ handle: 'student' }], participantType: 'PRACTICE' };
  const old = { id: 1, contestId: 100, creationTimeSeconds: Math.floor(oldStart / 1000) + 120,
    problem: { contestId: 100, index: 'A' }, verdict: 'OK', author };
  const remote = Array.from({ length: 500 }, (_, i) => ({ id: 1000 - i,
    creationTimeSeconds: Math.floor(now / 1000) - i * 350,
    problem: { contestId: 999, index: 'A' }, verdict: 'OK', author })).concat(old);
  return { remote, old };
}

test('Mongo: settlement needs post-end full-window evidence and current scoring input', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => fixture(async service => {
  const now = Date.now(), oldStart = now - 7 * 86400_000, recentStart = now - 12 * 3600_000;
  const old = { id: 1, contestId: 100, creationTimeSeconds: Math.floor(oldStart / 1000) + 120,
    problem: { contestId: 100, index: 'A' }, verdict: 'WRONG_ANSWER',
    author: { members: [{ handle: 'student' }], participantType: 'PRACTICE' } };
  const remote = Array.from({ length: 500 }, (_, i) => ({ id: 1000 - i,
    creationTimeSeconds: Math.floor(now / 1000) - i * 350,
    problem: { contestId: 999, index: 'A' }, verdict: 'OK',
    author: { members: [{ handle: 'student' }], participantType: 'PRACTICE' } })).concat(old);
  service.client = { call: async (method, args) => method === 'user.rating' ? []
    : method === 'user.status' ? remote.slice(args.from - 1, args.from - 1 + args.count) : [] };
  await service.change('coverage', s => {
    s.ratingBaselines = { 2: { rating: 1400 } };
    s.accounts.push({ uid: 2, handle: 'student', bindingId: 'binding', approved: true, verified: true,
      historyComplete: true, status: 'ready', lastSyncAt: now, ratingHistory: [] });
    s.runs.push(run('old', oldStart), run('recent', recentStart));
  });
  await service.records.insertOne({ _id: 'binding:1', account: 'binding', data: { ...old, verdict: 'OK' } });

  assert.equal((await service.preview('coverage', 'old')).complete, false, 'legacy lastSyncAt is not evidence');
  await finish(service, null);
  const narrow = (await service.state('coverage')).accounts[0].scanProofs.at(-1);
  assert.equal(narrow.reachedEnd, false);
  assert.ok(narrow.coveredSince > oldStart / 1000);
  assert.equal((await service.records.findOne({ _id: 'binding:1' })).data.verdict, 'OK');
  const stale = await service.preview('coverage', 'old');
  assert.equal(stale.complete, false);
  assert.match(stale.rows[0].completionIssues.join(' '), /覆盖开赛时间/);
  assert.equal((await service.preview('coverage', 'recent')).complete, true);
  await assert.rejects(service.settle('coverage', 'old', stale.token, 1), /覆盖开赛时间/);

  await finish(service, oldStart / 1000);
  const fresh = await service.preview('coverage', 'old');
  assert.equal(fresh.complete, true);
  assert.equal(fresh.rows[0].points, 0, 'rejudged WA replaces the earlier local AC');
  assert.equal(fresh.rows[0].scanProof.reachedEnd, true);
  old.verdict = 'OK';
  await finish(service, oldStart / 1000);
  assert.ok((await service.preview('coverage', 'old')).rows[0].points > 0);
  await assert.rejects(service.settle('coverage', 'old', fresh.token, 1), /预览已变化/);
  old.verdict = 'WRONG_ANSWER';
  await finish(service, oldStart / 1000);
  await finish(service, null);
  assert.equal((await service.preview('coverage', 'old')).complete, true, 'later narrow scans retain old-run evidence');
  assert.equal((await service.state('coverage')).accounts[0].scanProofs.length, 2);
  await assert.rejects(service.settle('coverage', 'old', fresh.token, 1), /预览已变化/);
  const beforePractice = await service.preview('coverage', 'old');
  await service.change('coverage', s => { s.runs[0].members[0].practice = true; });
  await assert.rejects(service.settle('coverage', 'old', beforePractice.token, 1), /预览已变化/);
  await service.change('coverage', s => { s.runs[0].members[0].practice = false; });
  // Even a cached scoring result must not turn a changed scan proof into a valid old token.
  const cached = await service.preview('coverage', 'old');
  const starts = service.ratingCache.starts;
  await finish(service, oldStart / 1000);
  await assert.rejects(service.settle('coverage', 'old', cached.token, 1), /预览已变化/);
  assert.equal(service.ratingCache.starts, starts, 'proof-only changes reuse scoring but never the confirmation token');
  const ready = await service.preview('coverage', 'old');
  await service.settle('coverage', 'old', ready.token, 1);
  await assert.rejects(service.settle('coverage', 'old', ready.token, 1), /已结算/);
  assert.equal((await service.result('coverage', 'old')).complete, true, 'settled snapshot stays frozen');
  await service.change('coverage', s => {
    s.runs[0].status = 'published';
    const event = s.ledger.find(e => e.runId === 'old' && !e.void);
    event.void = true; event.voidAt = Date.now();
  });
  assert.equal((await service.preview('coverage', 'old')).complete, false, 're-settlement needs a post-void scan');
  await finish(service, oldStart / 1000);
  assert.equal((await service.preview('coverage', 'old')).complete, true);
}));

test('Mongo: early, failed and empty scans cannot masquerade as coverage', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => fixture(async service => {
  const now = Date.now(), start = now - 3 * 3600_000;
  await service.change('coverage', s => {
    s.ratingBaselines = { 2: { rating: 1400 } };
    s.accounts.push({ uid: 2, handle: 'student', bindingId: 'binding', approved: true, verified: true,
      historyComplete: true, status: 'ready', lastSyncAt: now, ratingHistory: [],
      syncGeneration: 1, syncRequest: { uid: 2, bindingId: 'binding', generation: 1, since: start / 1000 },
      cycle: { generation: 1, cursor: 1, since: start / 1000, startedAt: start + 1000 } });
    s.runs.push(run('empty', start));
  });
  service.client = { call: async method => method === 'user.rating' ? [] : [] };
  await service.syncPage('coverage', { uid: 2, bindingId: 'binding', generation: 1, since: start / 1000 });
  let preview = await service.preview('coverage', 'empty');
  assert.equal(preview.complete, false, 'scan started before competition end');
  assert.equal((await service.state('coverage')).accounts[0].scanProofs[0].reachedEnd, true);

  service.client = { call: async method => { if (method === 'user.status') throw Error('network interrupted'); return []; } };
  await service.queueSync('coverage', 2, start / 1000);
  const failed = (await service.jobs.findOne({ domainId: 'coverage', kind: 'sync' })).payload;
  await assert.rejects(service.syncPage('coverage', failed), /network interrupted/);
  await service.change('coverage', s => { s.accounts[0].status = 'failed'; });
  preview = await service.preview('coverage', 'empty');
  assert.equal(preview.complete, false);
  assert.equal((await service.state('coverage')).accounts[0].scanProofs.length, 1);

  service.client = { call: async () => [] };
  await finish(service, start / 1000);
  preview = await service.preview('coverage', 'empty');
  assert.equal(preview.complete, true, 'empty history is complete only after reading its end');
  assert.equal(preview.rows[0].scanProof.coveredSince, 0);
  await service.change('coverage', s => { s.accounts[0].bindingId = 'replacement'; });
  assert.match((await service.preview('coverage', 'empty')).rows[0].completionIssues.join(' '), /账号已更换/);
}));

test('Mongo: a failed full-window request keeps its range through normal retry and restart', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => fixture(async (service, db) => {
  const now = Date.now(), oldStart = now - 7 * 86400_000;
  const { remote, old } = rejudgedHistory(now, oldStart);
  let failStatus = false;
  const api = { call: async (method, args) => {
    if (method === 'user.rating') return [];
    if (method === 'user.status') {
      if (failStatus) throw new Error('network interrupted');
      return remote.slice(args.from - 1, args.from - 1 + args.count);
    }
    return [];
  } };
  service.client = api;
  await service.change('coverage', s => {
    s.ratingBaselines = { 2: { rating: 1400 } };
    s.accounts.push({ uid: 2, handle: 'student', bindingId: 'binding', approved: true, verified: true,
      historyComplete: true, status: 'ready', lastSyncAt: now, ratingHistory: [] });
    s.runs.push(run('old', oldStart));
  });
  // g1: a successful full-window scan makes the run settleable on the old AC.
  await finish(service, oldStart / 1000);
  const before = await service.preview('coverage', 'old');
  assert.equal(before.complete, true);
  assert.ok(before.rows[0].points > 0);
  // CF rejudges the old AC into WA; the coach's full refresh fails on its first page request.
  old.verdict = 'WRONG_ANSWER';
  await service.queueSync('coverage', 2, oldStart / 1000);
  failStatus = true;
  await tickPage(service);
  let account = (await service.state('coverage')).accounts[0];
  assert.equal(account.status, 'failed');
  assert.equal(account.cycle ?? null, null, 'no cycle is persisted before the first page');
  assert.equal(account.syncRequest.since, oldStart / 1000);
  assert.equal((await service.preview('coverage', 'old')).complete, false, 'failed sync blocks settlement');
  // A restarted service instance must keep the pending full-window requirement.
  failStatus = false;
  const restarted = new TrainingService(db, { client: api });
  try {
    await restarted.init();
    account = (await restarted.state('coverage')).accounts[0];
    assert.equal(account.status, 'failed');
    assert.equal(account.syncRequest.since, oldStart / 1000);
    // Student "refresh history" / coach plain "sync": the retry must inherit the failed range.
    await restarted.queueSync('coverage', 2);
    const retry = (await restarted.jobs.findOne({ domainId: 'coverage', kind: 'sync' })).payload;
    assert.equal(retry.since, oldStart / 1000, 'normal retry keeps the failed full-window range');
    const queued = await restarted.preview('coverage', 'old');
    assert.equal(queued.complete, false, 'settlement stays rejected until the retry actually finishes');
    assert.match(queued.rows[0].completionIssues.join(' '), /队列|扫描/);
    let done = false;
    for (let page = 0; page < 10 && !done; page++) done = await restarted.syncPage('coverage', retry);
    assert.equal(done, true);
    await restarted.jobs.updateOne({ domainId: 'coverage', kind: 'sync' }, { $set: { status: 'done' } });
    const after = await restarted.preview('coverage', 'old');
    assert.equal(after.complete, true);
    assert.equal(after.rows[0].points, 0, 'the rejudged WA replaces the stale local AC');
    assert.equal((await restarted.records.findOne({ _id: 'binding:1' })).data.verdict, 'WRONG_ANSWER');
    assert.ok(after.rows[0].scanProof.generation >= retry.generation, 'settlement uses the new scan proof');
    // With nothing pending, a plain refresh is narrow again yet keeps the old-run evidence.
    await restarted.queueSync('coverage', 2);
    const narrow = (await restarted.jobs.findOne({ domainId: 'coverage', kind: 'sync' })).payload;
    assert.ok(narrow.since > oldStart / 1000, 'satisfied requests no longer widen plain refreshes');
    done = false;
    for (let page = 0; page < 10 && !done; page++) done = await restarted.syncPage('coverage', narrow);
    assert.equal(done, true);
    await restarted.jobs.updateOne({ domainId: 'coverage', kind: 'sync' }, { $set: { status: 'done' } });
    const retained = await restarted.preview('coverage', 'old');
    assert.equal(retained.complete, true, 'later narrow scans retain the old-run evidence');
    assert.equal(retained.rows[0].points, 0);
  } finally { restarted.close(); }
}));

test('Mongo: a mid-pagination failure keeps the full-window range for the retry', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => fixture(async service => {
  const now = Date.now(), oldStart = now - 7 * 86400_000;
  const { remote, old } = rejudgedHistory(now, oldStart);
  let failStatus = false;
  service.client = { call: async (method, args) => {
    if (method === 'user.rating') return [];
    if (method === 'user.status') {
      if (failStatus) throw new Error('network interrupted');
      return remote.slice(args.from - 1, args.from - 1 + args.count);
    }
    return [];
  } };
  await service.change('coverage', s => {
    s.ratingBaselines = { 2: { rating: 1400 } };
    s.accounts.push({ uid: 2, handle: 'student', bindingId: 'binding', approved: true, verified: true,
      historyComplete: true, status: 'ready', lastSyncAt: now, ratingHistory: [] });
    s.runs.push(run('old', oldStart));
  });
  await finish(service, oldStart / 1000);
  old.verdict = 'WRONG_ANSWER';
  // g2 survives its first page, then the second page request fails mid-scan.
  await service.queueSync('coverage', 2, oldStart / 1000);
  const g2 = (await service.jobs.findOne({ domainId: 'coverage', kind: 'sync' })).payload;
  assert.equal(await service.syncPage('coverage', g2), false, 'a full first page keeps the scan going');
  failStatus = true;
  await tickPage(service);
  const account = (await service.state('coverage')).accounts[0];
  assert.equal(account.status, 'failed');
  assert.equal(account.cycle.since, oldStart / 1000, 'the persisted cycle survives the failure');
  // A plain retry must still scan the full window instead of only recent history.
  failStatus = false;
  await service.queueSync('coverage', 2);
  const retry = (await service.jobs.findOne({ domainId: 'coverage', kind: 'sync' })).payload;
  assert.equal(retry.since, oldStart / 1000);
  let done = false;
  for (let page = 0; page < 10 && !done; page++) done = await service.syncPage('coverage', retry);
  assert.equal(done, true);
  await service.jobs.updateOne({ domainId: 'coverage', kind: 'sync' }, { $set: { status: 'done' } });
  const after = await service.preview('coverage', 'old');
  assert.equal(after.complete, true);
  assert.equal(after.rows[0].points, 0, 'the retry rereads the rejudged WA');
  assert.equal((await service.records.findOne({ _id: 'binding:1' })).data.verdict, 'WRONG_ANSWER');
}));
