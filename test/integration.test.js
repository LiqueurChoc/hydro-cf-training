'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { TrainingService } = require('../lib/service');
const c = require('../lib/core');
const groups = require('../lib/groups');

for (const oldResult of ['empty', 'last-page', 'failure']) test(`Mongo: old ${oldResult} cannot clear a later full-window request`, {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db = client.db(`cftrain_test_${randomUUID().replaceAll('-', '')}`);
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const api = { async call(method) {
    if (method === 'user.status') {
      entered(); await blocked;
      if (oldResult === 'failure') throw new Error('old request failed');
      return oldResult === 'empty' ? [] : [{ id: 1, creationTimeSeconds: 2000, verdict: 'OK' }];
    }
    return [];
  } };
  try {
    const service = new TrainingService(db, { client: api });
    await service.init();
    await service.change('race', s => {
      s.ratingBaselines = { 2: { rating: 1400 } };
      s.accounts.push({ uid: 2, handle: 'student', bindingId: 'binding', verified: true,
        historyComplete: true, lastSyncAt: Date.now(), status: 'ready' });
    });
    await service.queueSync('race', 2);
    const oldPage = service.syncPage('race', { uid: 2, bindingId: 'binding' });
    await waiting;
    await service.queueSync('race', 2, 1000);
    release();
    if (oldResult === 'failure') await assert.rejects(oldPage, /old request failed/);
    else await oldPage;
    const account = (await service.state('race')).accounts[0];
    assert.equal(account.status, 'queued');
    assert.equal(account.syncRequest.since, 1000);
    assert.equal(account.lastSyncAt > 0, true);
    assert.equal(await service.records.countDocuments({}), 0);
  } finally {
    release?.();
    await db.dropDatabase();
    await client.close();
  }
});

for (const sameGeneration of [false, true]) test(`Mongo: a newer verdict survives an old ${sameGeneration ? 'lease' : 'request'} write`, {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db = client.db(`cftrain_test_${randomUUID().replaceAll('-', '')}`);
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let verdict = 'WRONG_ANSWER';
  const froms = [];
  const api = { async call(method, args) {
    if (method === 'user.status') { froms.push(args.from); return [{ id: 1, creationTimeSeconds: 2000, verdict }]; }
    return [];
  } };
  try {
    const service = new TrainingService(db, { client: api });
    await service.init();
    await service.change('race', s => {
      s.ratingBaselines = { 2: { rating: 1400 } };
      s.accounts.push({ uid: 2, handle: 'student', bindingId: 'binding', verified: true,
        historyComplete: !sameGeneration, cursor: 476, lastSyncAt: Date.now(), status: 'ready' });
    });
    await service.queueSync('race', 2);
    const originalWrite = service.records.bulkWrite.bind(service.records);
    let first = true;
    service.records.bulkWrite = async writes => {
      if (first) { first = false; entered(); await blocked; }
      return originalWrite(writes);
    };
    const oldPage = service.syncPage('race', (await service.jobs.findOne({})).payload);
    await waiting;
    verdict = 'OK';
    if (!sameGeneration) await service.queueSync('race', 2, 1000);
    const currentJob = await service.jobs.findOne({});
    await service.syncPage('race', { ...currentJob.payload, attempt: sameGeneration ? 1 : 0 });
    release();
    await oldPage;
    assert.equal((await service.records.findOne({ _id: 'binding:1' })).data.verdict, 'OK');
    assert.equal((await service.state('race')).accounts[0].status, 'ready');
    assert.deepEqual(froms, [1, 1]);
  } finally {
    release?.();
    await db.dropDatabase();
    await client.close();
  }
});

test('Mongo: repeated full refresh survives worker lease recovery on another instance', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db = client.db(`cftrain_test_${randomUUID().replaceAll('-', '')}`);
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let statusCalls = 0;
  const api = { async call(method) {
    if (method !== 'user.status') return [];
    if (++statusCalls === 1) { entered(); await blocked; return []; }
    if (statusCalls === 2) return Array.from({ length: 500 }, (_, i) =>
      ({ id: 1000 - i, creationTimeSeconds: 2000 - i }));
    return [];
  } };
  try {
    const first = new TrainingService(db, { client: api });
    await first.init();
    await first.change('race', s => {
      s.ratingBaselines = { 2: { rating: 1400 } };
      s.accounts.push({ uid: 2, handle: 'student', bindingId: 'binding', verified: true,
        historyComplete: true, lastSyncAt: Date.now(), status: 'syncing',
        cycle: { cursor: 476, since: 900, startedAt: Date.now() } });
    });
    await first.queueSync('race', 2);
    const oldTick = first.tick();
    await waiting;
    await first.queueSync('race', 2, 2000);
    await first.queueSync('race', 2, 1000);
    assert.equal((await first.jobs.findOne({})).payload.since, 900);
    release();
    await oldTick;
    assert.equal((await first.jobs.findOne({})).status, 'queued');
    const second = new TrainingService(db, { client: api });
    await second.init();
    // Simulate a worker that died after claiming the persisted request.
    await second.jobs.updateOne({}, { $set: { status: 'running', lease: 'dead-worker',
      updatedAt: Date.now() - 181000 } });
    await second.locks.updateOne({ _id: 'worker' }, { $set: { until: 0 } });
    await second.tick();
    assert.equal((await second.state('race')).accounts[0].cycle.since, 900);
    assert.equal((await second.jobs.findOne({})).status, 'queued');
    await second.jobs.updateOne({}, { $set: { nextAt: 0 } });
    await second.locks.updateOne({ _id: 'worker' }, { $set: { until: 0 } });
    await second.tick();
    assert.equal((await second.jobs.findOne({})).status, 'done');
    assert.equal((await second.state('race')).accounts[0].status, 'ready');
    assert.equal(statusCalls, 3);
  } finally {
    release?.();
    await db.dropDatabase();
    await client.close();
  }
});

test('Mongo: concurrent enqueue and restart keep the newest persisted request', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db = client.db(`cftrain_test_${randomUUID().replaceAll('-', '')}`);
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  try {
    const service = new TrainingService(db);
    await service.init();
    await service.change('race', s => {
      s.ratingBaselines = { 2: { rating: 1400 } };
      s.accounts.push({ uid: 2, handle: 'student', bindingId: 'binding', verified: true,
        historyComplete: true, lastSyncAt: Date.now(), status: 'ready' });
    });
    const originalUpdate = service.jobs.updateOne.bind(service.jobs);
    service.jobs.updateOne = async (filter, update, options) => {
      if (update.$set?.payload?.generation === 1) { entered(); await blocked; }
      return originalUpdate(filter, update, options);
    };
    const first = service.queueSync('race', 2, 2000);
    await waiting;
    await service.queueSync('race', 2, 1000);
    release();
    await first;
    assert.equal((await service.jobs.findOne({})).payload.generation, 2);
    assert.equal((await service.jobs.findOne({})).payload.since, 1000);
    await service.jobs.updateOne({}, { $set: { status: 'done', 'payload.generation': 1 } });
    const restarted = new TrainingService(db);
    await restarted.init();
    assert.equal((await restarted.jobs.findOne({})).status, 'queued');
    assert.equal((await restarted.jobs.findOne({})).payload.since, 1000);
  } finally {
    release?.();
    await db.dropDatabase();
    await client.close();
  }
});

test('Mongo: concurrent multi-class membership and leaderboard use current bindings', {skip: !process.env.CFTRAIN_TEST_MONGO_URL}, async()=>{
  const {MongoClient}=require('mongodb');
  const client=await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db=client.db(`cftrain_test_${randomUUID().replaceAll('-','')}`);
  try {
    const service=new TrainingService(db);await service.init();
    await service.change('classes',s=>{
      s.accounts=[2,3,4].map(uid=>({uid,handle:`fixture${uid}`,bindingId:`binding${uid}`,historyComplete:true,status:'ready'}));
      s.ratingBaselines={2:{rating:1500},3:{rating:1500},4:{rating:1600}};
      s.groups=[{id:'a',name:'A',ownerId:1,adminIds:[],uids:[2]},{id:'b',name:'B',ownerId:1,adminIds:[],uids:[]}];
    });
    const permissions={actor:1,coach:true,root:false,validateUser:async()=>{}};
    await Promise.all([3,4].map(uid=>service.change('classes',s=>groups.changeGroup(s,{action:'group_members',ids:['a','b'],uids:[uid],mode:'add'},permissions))));
    const state=await service.state('classes');
    assert.deepEqual([...state.groups[0].uids].sort(),[2,3,4]);
    assert.deepEqual([...state.groups[1].uids].sort(),[3,4]);
    await service.records.insertMany([
      {account:'binding2',data:{verdict:'OK',problem:{contestId:100,index:'A'}}},
      {account:'binding2',data:{verdict:'OK',problem:{contestId:100,index:'a'}}},
      {account:'binding2',data:{verdict:'WRONG_ANSWER',problem:{contestId:100,index:'B'}}},
      {account:'binding3',data:{verdict:'OK',contestId:100001,problem:{index:'A'}}},
      {account:'other-domain-binding',data:{verdict:'OK',problem:{contestId:100,index:'A'}}},
    ]);
    const cold=await service.groupLeaderboard('classes','a',2);
    assert.equal(cold.ratingStatus,'computing');
    assert.ok(cold.rows.every(row=>row.rank===null&&row.rating===null));
    await service.replay(await service.state('classes'));
    const board=await service.groupLeaderboard('classes','a',2);
    assert.equal(board.ratingStatus,'ready');
    assert.deepEqual(board.rows.map(r=>[r.uid,r.rank,r.solvedTotal]),[[4,1,0],[2,2,1],[3,2,1]]);
    await service.change('classes',s=>{s.accounts[0].bindingId='replacement';});
    assert.equal((await service.groupLeaderboard('classes','a',2)).rows.find(r=>r.uid===2).solvedTotal,0);
    await assert.rejects(service.change('classes',s=>groups.changeGroup(s,{action:'group_members',ids:['a','unknown'],uids:[2],mode:'remove'},permissions)),groups.GroupAccessDenied);
    assert.equal((await service.state('classes')).groups[0].uids.length,3);
    await assert.rejects(service.groupLeaderboard('other-domain','a',2),groups.GroupAccessDenied);
  } finally {await db.dropDatabase();await client.close();}
});

test('Mongo: rating versions follow atomic state across services, migration and a restarted service', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db = client.db(`cftrain_test_${randomUUID().replaceAll('-', '')}`);
  const first = new TrainingService(db), second = new TrainingService(db), restarted = new TrainingService(db);
  try {
    await first.refs.insertMany([{ _id: 'r', contest: { type: 'CF' } }, { _id: 'r:0', snapshot: 'r', rows: [
      { points: 0, rating: 1400, penalty: 0 }, { points: 500, rating: 1800, penalty: 0 },
    ] }]);
    await first.change('ratings', s => { s.ledger.push({ runId: 'a', snapshot: 'r', endAt: 1,
      inputs: [{ uid: 2, handle: 'fixture', points: 100, penalty: 0 }] }); });
    const legacy = await first.replay(await first.state('ratings'));
    await second.init(); // old stored events get their original 1400 baseline atomically
    const migrated = await second.replay(await second.state('ratings'));
    assert.deepEqual(legacy.ratings, migrated.ratings);
    assert.notEqual(legacy.version, migrated.version);
    assert.deepEqual(await first.replay(await first.state('ratings')), migrated);
    await second.change('ratings', s => { s.ledger[0].void = true; });
    const revoked = await first.replay(await first.state('ratings'));
    assert.equal(revoked.ratings[2], 1400); assert.equal(revoked.ledger.length, 0);
    assert.notEqual(revoked.version, migrated.version);
    await restarted.init();
    assert.deepEqual(await restarted.replay(await restarted.state('ratings')), revoked);
    await first.change('ratings', s => { s.ledger[0].void = false; s.ledger[0].inputs[0].points = 500; });
    const resettled = await second.replay(await second.state('ratings'));
    assert.notEqual(resettled.version, migrated.version);
    assert.deepEqual(await restarted.replay(await restarted.state('ratings')), resettled);
  } finally {
    first.close(); second.close(); restarted.close();
    await db.dropDatabase(); await client.close();
  }
});

test('Mongo: pagination, resumption, CAS, queue lease and rating ledger', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const name = `cftrain_test_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  try {
    const now = Date.now();
    const records = Array.from({ length: 501 }, (_, i) => ({ id: 1000 - i,
      contestId: 10, creationTimeSeconds: Math.floor(now / 1000) - i,
      problem: { contestId: 10, index: 'A' }, verdict: 'OK',
      author: { members: [{ handle: 'student' }], participantType: 'PRACTICE' } }));
    const calls = [];
    let failPage = false;
    let infoRating = 1678;
    const api = { async call(method, args) {
      calls.push({ method, args });
      if (method === 'user.info') return [{ handle: 'student', rating: infoRating }];
      if (method === 'user.rating') return [];
      if (method === 'user.status') {
        if (failPage) throw new Error('network interrupted');
        return records.slice(args.from - 1, args.from - 1 + args.count);
      }
      throw new Error(`Unexpected API: ${method}`);
    } };
    const service = new TrainingService(db, { client: api });
    await service.init();
    await service.bind('test', 2, 'student');
    await assert.rejects(service.bind('test', 2, 'other'), /只能绑定一次/);
    await assert.rejects(service.bind('test', 2, 'student'), /只能绑定一次/);
    await service.bind('binding-test', 9, 'old_handle');
    await service.change('binding-test', s => { s.ratingBaselines = {9:{rating:1700}}; });
    await service.bind('binding-test', 9, 'new_handle', 1);
    const rebound = await service.state('binding-test');
    assert.equal(rebound.accounts[0].approved, false);
    assert.equal(rebound.ratingBaselines[9].rating, 1700);
    assert.equal(rebound.audit[0].actor, 1);
    await service.change('binding-test', s => { s.runs.push({status:'draft',members:[{uid:9}]}); });
    await assert.rejects(service.bind('binding-test', 9, 'third_handle', 1), /草稿/);
    await service.jobs.deleteMany({domainId:'binding-test'});
    await service.states.deleteOne({_id:'binding-test'});
    await service.catalog.insertMany(Array.from({length:85}, (_,i)=>({_id:`fixture:${i}`,kind:'contest',
      data:{id:10000+i,name:'Search Fixture Div. 2',type:'CF',durationSeconds:7200},problems:[{contestId:10000+i,index:'A'}]})));
    const first = await service.discover('test', [2], {query:'  SEARCH fixture ',mode:'all',pageSize:20});
    assert.equal(first.total,85); assert.equal(first.pages,5); assert.equal(first.rows.length,20);
    const last = await service.discover('test', [2], {query:'fixture',page:5,pageSize:20});
    assert.equal(last.rows.length,5); assert.equal(last.rows[4].id,10000);
    assert.equal((await service.discover('test',[2],{query:'10042'})).total,1);
    assert.equal((await service.discover('test',[2],{query:'missing'})).total,0);
    assert.equal((await service.discover('test',[2],{mode:'clear'})).total,0);
    await assert.rejects(service.discover('test',[2],{page:0}), /页码/);

    const payload = (await service.jobs.findOne({})).payload;
    assert.equal(await service.syncPage('test', payload), false);
    assert.equal((await service.state('test')).accounts[0].cursor, 476);
    assert.equal((await service.replay(await service.state('test'))).ratings[2], 1678);
    infoRating = 1900;
    failPage = true;
    await assert.rejects(service.syncPage('test', payload), /network interrupted/);
    assert.equal((await service.state('test')).accounts[0].historyComplete, false);
    failPage = false;
    assert.equal(await service.syncPage('test', payload), true);
    await service.jobs.updateMany({}, { $set: { status: 'done' } });
    assert.equal(await service.records.countDocuments({}), 501);
    assert.equal((await service.state('test')).accounts[0].historyComplete, true);
    await Promise.all(Array.from({ length: 5 }, () => service.change('test', s => { s.counter = (s.counter || 0) + 1; })));
    assert.equal((await service.state('test')).counter, 5);
    await service.queueSync('test', 2);
    assert.equal(await service.jobs.countDocuments({}), 1, 'queue deduplicates repeated requests');
    const second = new TrainingService(db, { client: api });
    const beforeCalls = calls.length;
    await Promise.all([service.tick(), second.tick()]);
    assert.equal(calls.length - beforeCalls, 2, 'one lease holder calls rating and submissions');
    assert.equal((await service.jobs.findOne({})).status, 'queued', '500-item page is requeued for continuation');
    const currentJob = await service.jobs.findOne({domainId:'test'});
    assert.equal(await service.syncPage('test', { ...currentJob.payload, attempt: currentJob.attempt }), true);
    await service.jobs.updateMany({}, { $set: { status: 'done' } });

    await service.refs.insertMany([{ _id: 'snapshot', contest: { type: 'CF' } },
      { _id: 'snapshot:0', snapshot: 'snapshot', rows: [
        { points: 500, penalty: 0, rating: 1800 },
        { points: 100, penalty: 0, rating: 1400 },
        { points: 0, penalty: 0, rating: 1000 },
      ] }]);
    const start = now - 600000;
    const slot = { index: 'A', points: 500, original: { contestId: 100, index: 'A' }, actual: { contestId: 100, index: 'A' } };
    await service.change('test', s => {
      const a = s.accounts[0];
      a.approved = true;
      s.runs.push({ id: 'run', title: 'fixture', contestId: 100, snapshot: 'snapshot',
        startAt: start, durationSeconds: 300, rated: true, status: 'published',
        members: [{ uid: 2, handle: 'student', bindingId: a.bindingId }],
        attendees: [2], rules: c.rules('CF'), slots: [slot] });
    });
    const binding = (await service.state('test')).accounts[0].bindingId;
    records.push({
      ...records[0], id: 2000, contestId: 100, problem: slot.actual,
      creationTimeSeconds: Math.floor(start / 1000) + 120,
    });
    records.sort((a, b) => b.creationTimeSeconds - a.creationTimeSeconds);
    await service.queueSync('test', 2, start / 1000);
    const runSync = (await service.jobs.findOne({ domainId: 'test', kind: 'sync' })).payload;
    assert.equal(await service.syncPage('test', runSync), false);
    assert.equal(await service.syncPage('test', runSync), true);
    await service.jobs.updateOne({ domainId: 'test', kind: 'sync' }, { $set: { status: 'done' } });
    assert.equal((await service.state('test')).accounts[0].scanProofs.at(-1).coveredSince, 0);
    const preview = await service.preview('test', 'run');
    assert.equal(preview.complete, true);
    assert.equal(preview.changes.length, 1);
    await service.change('test', s => { s.testMutation = true; });
    await assert.rejects(service.settle('test', 'run', preview.token, 1), /预览已变化/);
    const current = await service.preview('test', 'run');
    await service.change('test', s => { s.accounts[0].status = 'syncing'; });
    assert.equal((await service.preview('test', 'run')).complete, false, 'active sync blocks settlement');
    await service.change('test', s => { s.accounts[0].status = 'ready'; });
    const ready = await service.preview('test', 'run');
    await service.settle('test', 'run', ready.token, 1);
    await assert.rejects(service.settle('test', 'run', current.token, 1), /已结算/);
    const settled = await service.state('test');
    assert.equal(settled.ledger.length, 1);
    await service.records.updateOne({ _id: `${binding}:2000` }, { $set: { 'data.verdict': 'WRONG_ANSWER' } });
    assert.equal((await service.result('test', 'run')).rows[0].points, current.rows[0].points, 'settled scores stay frozen until revoked');
    const expected = (await service.reference('snapshot'))(current.event.inputs[0], 1678);
    assert.equal((await service.replay(settled)).ratings[2], expected.newRating);
    settled.ledger.push({ ...settled.ledger[0], runId: 'second', endAt: now });
    const two = await service.replay(settled);
    assert.equal(two.ledger[1].changes[0].oldRating, expected.newRating);
    settled.ledger[0].void = true;
    const revoked = await service.replay(settled);
    assert.equal(revoked.ledger.length, 1);
    assert.equal(revoked.ledger[0].changes[0].oldRating, 1678);
    assert.equal(revoked.ratings[2], expected.newRating);
    assert.equal((await service.state('test')).ratingBaselines[2].rating, 1678, 'later CF changes do not overwrite baseline');
    await service.change('legacy', s => { s.ledger = settled.ledger; });
    await service.init();
    assert.equal((await service.state('legacy')).ratingBaselines[2].rating, 1400, 'legacy ledger retains old baseline');
    for (const [domain, value, expectedRating, source] of [
      ['zero', 0, 0, 'cf'], ['unrated', undefined, 1400, 'unrated-default'],
    ]) {
      infoRating = value;
      await service.bind(domain, 3, 'student');
      const a = (await service.state(domain)).accounts[0];
      assert.equal((await service.replay(await service.state(domain))).ratings[3], undefined, 'no fabricated rating before sync');
      await service.syncPage(domain, { uid: 3, bindingId: a.bindingId });
      const baseline = (await service.state(domain)).ratingBaselines[3];
      assert.equal(baseline.rating, expectedRating);
      assert.equal(baseline.source, source);
    }
  } finally {
    assert.match(name, /^cftrain_test_[a-f0-9]{32}$/);
    await client.db(name).dropDatabase();
    await client.close();
  }
});
