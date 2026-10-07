'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TrainingService } = require('../lib/service');
const c = require('../lib/core');

function fixture() {
  const service = new TrainingService({ collection: () => ({}) });
  const reference = Array.from({ length: 100 }, (_, i) => ({ rating: 1000 + i * 10, points: i * 50, penalty: 0 }));
  service.refs = { findOne: async () => ({ contest: { type: 'CF' } }),
    find: () => ({ toArray: async () => [{ rows: reference }] }) };
  const state = { _id: 'rating-test', revision: 1, ratingBaselines: { 2: { rating: 1400 } },
    ledger: [{ runId: 'a', snapshot: 'ref', endAt: 1, algorithm: c.VERSION,
      inputs: [{ uid: 2, handle: 'student', points: 1000, penalty: 0 }] }] };
  return { service, state, reference };
}

test('cold replay yields to the event loop before rating computation completes', async () => {
  const { service, state } = fixture();
  let yielded = false;
  const immediate = setImmediate(() => { yielded = true; });
  try {
    await service.replay(state);
    assert.equal(yielded, true, 'rating computation blocked the request event loop');
  } finally { clearImmediate(immediate); service.close?.(); }
});

async function original(service, state) {
  const ratings = new Map(Object.entries(state.ratingBaselines || {}).map(([uid, b]) => [Number(uid), b.rating]));
  const ledger = [];
  for (const event of state.ledger.filter(e => !e.void).sort((a, b) => a.endAt - b.endAt || a.runId.localeCompare(b.runId))) {
    const engine = await service.reference(event.snapshot), changes = [];
    for (const row of event.inputs) {
      const rating = engine(row, ratings.get(row.uid) ?? 1400);
      ratings.set(row.uid, rating.newRating); changes.push({ uid: row.uid, handle: row.handle, ...rating });
    }
    ledger.push({ ...event, changes });
  }
  return { ratings: Object.fromEntries(ratings), ledger };
}

test('worker equals the original replay: legacy defaults, ties, baselines, void and resettlement', async () => {
  const { service, state } = fixture();
  try {
    delete state.ledger[0].algorithm; // saved events predating explicit algorithm metadata
    state.ledger.unshift({ ...structuredClone(state.ledger[0]), runId: 'z' });
    state.ledger[0].inputs.push({ uid: 3, handle: 'legacy', points: 0, penalty: 0 });
    for (const change of [() => {}, () => { state.ratingBaselines[3] = { rating: 1800 }; },
      () => { state.ledger[1].void = true; },
      () => { state.ledger[1].void = false; state.ledger[1].inputs[0].points = 4000; }]) {
      change();
      const expected = await original(service, state), actual = await service.replay(state);
      assert.deepEqual({ ratings: actual.ratings, ledger: actual.ledger }, expected);
      assert.equal(actual.status, 'ready');
    }
    const before = service.ratingCache.starts;
    state.revision++;
    state.accounts = [{ status: 'syncing', lastSyncAt: Date.now() }];
    state.groups = [{ name: 'renamed' }];
    state.ratingBaselines[3].source = 'cf';
    state.ledger[0].title = 'new display title';
    service.refs.findOne = () => { throw new Error('cache hit must not load or score references'); };
    const hot = await service.replay(state);
    assert.equal(hot.ledger.find(e => e.runId === 'z').title, 'new display title');
    assert.equal(service.ratingCache.starts, before);
    hot.ratings[2] = -999; hot.ledger[0].changes[0].delta = -999;
    assert.notEqual((await service.replay(state)).ratings[2], -999);
    assert.notEqual((await service.replay(state)).ledger[0].changes[0].delta, -999);
  } finally { service.close(); }
});

test('same-version readers coalesce; old completion cannot publish a newer version', async () => {
  const { service, state } = fixture();
  let release, enter;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const find = service.refs.findOne;
  service.refs.findOne = async (...args) => { enter(); await blocked; return find(...args); };
  try {
    const pending = await service.replay(state, { wait: false });
    assert.equal(pending.status, 'computing'); assert.deepEqual(pending.ratings, {});
    const old = service.replay(state), duplicate = service.replay(state);
    await entered;
    const changed = structuredClone(state); changed.ratingBaselines[2].rating = 1800;
    const next = await service.replay(changed, { wait: false });
    assert.notEqual(next.version, pending.version);
    release();
    assert.deepEqual(await old, await duplicate);
    const current = await service.replay(changed);
    assert.equal(current.version, next.version);
    assert.notDeepEqual(current.ratings, (await old).ratings);
    assert.equal(service.ratingCache.starts, 2);
    assert.equal((await service.replay(changed)).version, next.version);
  } finally { release(); service.close(); }
});

test('worker exit is visible and retryable; task and result caches are bounded', async () => {
  const { service, state } = fixture();
  const cache = service.ratingCache, workerFile = cache.workerFile;
  try {
    cache.workerFile = require.resolve('../lib/core'); // exits without a result
    await assert.rejects(service.replay(state), /worker.*退出/);
    const failed = await service.replay(state, { wait: false });
    assert.equal(failed.status, 'failed'); assert.deepEqual(failed.ratings, {});
    cache.workerFile = workerFile;
    await new Promise(resolve => setTimeout(resolve, 1050));
    assert.equal((await service.replay(state)).status, 'ready');
    cache.maxTasks = 1; cache.maxEntries = 2;
    const newer = structuredClone(state); newer.ratingBaselines[2].rating++;
    const work = service.replay(newer);
    const newest = structuredClone(newer); newest.ratingBaselines[2].rating++;
    assert.equal((await service.replay(newest, { wait: false })).status, 'busy');
    await assert.rejects(service.replay(newest), /队列已满/);
    await work; await service.replay(newest);
    assert.equal(cache.entries.size, 2); assert.ok(cache.bytes <= cache.maxBytes);
    cache.maxBytes = 1;
    const over = structuredClone(newest); over.ratingBaselines[2].rating++;
    await assert.rejects(service.replay(over), /超出缓存容量/);
  } finally { service.close(); }
});

test('independent instances and restart rebuild from saved inputs, never depend on a local invalidation flag', async () => {
  const first = fixture(), second = fixture();
  try {
    assert.deepEqual(await first.service.replay(first.state), await second.service.replay(first.state));
    first.state.ledger[0].void = true;
    const expected = await first.service.replay(first.state);
    assert.deepEqual(await second.service.replay(first.state), expected);
    second.service.close();
    const restarted = fixture();
    try { assert.deepEqual(await restarted.service.replay(first.state), expected); }
    finally { restarted.service.close(); }
  } finally { first.service.close(); second.service.close(); }
});

test('preview issues no token while computing and rejects changes during worker execution', async () => {
  const { service, state } = fixture();
  service.state = async () => structuredClone(state);
  service.result = async () => ({ run: { id: 'a', snapshot: 'ref', title: 'a', slots: [],
    startAt: 0, durationSeconds: 1, status: 'published' },
    rows: [{ ...state.ledger[0].inputs[0], eligible: true, checked: true, complete: true, scanProof: { generation: 1 } }],
    complete: true });
  let release, enter;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const find = service.refs.findOne;
  service.refs.findOne = async (...args) => { enter(); await blocked; return find(...args); };
  try {
    const pending = await service.preview(state._id, 'a', { wait: false });
    assert.equal(pending.token, null); assert.equal(pending.ratingStatus, 'computing');
    const computing = service.preview(state._id, 'a');
    await entered;
    state.revision++; // a new scan/practice/qualification mutation while awaiting the worker
    release();
    await assert.rejects(computing, /档案已变化/);
    const ready = await service.preview(state._id, 'a', { wait: false });
    assert.equal(ready.ratingStatus, 'ready'); assert.ok(ready.token);
    assert.equal(ready.revision, state.revision);
  } finally { release(); service.close(); }
});
