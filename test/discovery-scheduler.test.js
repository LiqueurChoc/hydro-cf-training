'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TrainingService } = require('../lib/service');
const c = require('../lib/core');

test('discovery index preserves full exposure results including order and time boundaries', () => {
  const at = 200000000;
  const base = { approved: true, historyComplete: true, lastSyncAt: at - 1000,
    status: 'ready', ratingHistory: [{ contestId: 4 }] };
  const records = Array.from({ length: 180 }, (_, i) => ({
    contestId: i % 8 + 1, problem: { contestId: i % 8 + 1, index: ['C', 'A', 'B'][i % 3] },
    creationTimeSeconds: at / 1000 + (i % 5 - 3),
    verdict: i % 3 ? 'WRONG_ANSWER' : 'OK',
    author: { participantType: ['PRACTICE', 'VIRTUAL', 'CONTESTANT', 'OUT_OF_COMPETITION'][i % 4] },
  }));
  const notices = [{ key: '9/B', createdAt: at - 1 }, { key: '9/A', createdAt: at - 1 },
    { key: '9/A', createdAt: at - 2 }, { key: 'contest:10', createdAt: at - 1 },
    { key: 'contest:11', createdAt: at }, { key: '11/C', createdAt: at + 1 }];
  for (const account of [base, undefined, { ...base, approved: false },
    { ...base, historyComplete: false }, { ...base, status: 'failed' },
    { ...base, lastSyncAt: at - 86400001 }, { ...base, status: 'syncing' }]) {
    const index = c.prepareExposure(account, records, notices, at);
    for (let contestId = 1; contestId <= 12; contestId++) {
      const problems = ['A', 'B', 'C', 'A'].map(index => ({ contestId, index }));
      assert.deepEqual(c.exposureFromIndex(index, contestId, problems),
        c.exposure(account, records, notices, contestId, problems, at));
    }
  }
});

test('discovery retains global clear filtering, conflict order and pagination', async t => {
  const service = new TrainingService({ collection: () => ({}) });
  t.after(() => service.close());
  const account = { uid: 2, bindingId: 'b', approved: true, historyComplete: true,
    lastSyncAt: Date.now(), status: 'ready', ratingHistory: [{ contestId: 5 }] };
  const records = [{ contestId: 4, problem: { contestId: 4, index: 'A' }, creationTimeSeconds: 1, verdict: 'OK' }];
  const state = { accounts: [account], notices: [{ uid: 2, key: '3/A', createdAt: 1 }] };
  const catalog = Array.from({ length: 7 }, (_, i) => ({ data: { id: i + 1, name: `Round ${i + 1}`, type: 'CF', durationSeconds: 7200 },
    problems: [{ contestId: i + 1, index: 'A' }] }));
  service.state = async () => state;
  let historyReads = 0;
  service.allRecords = async () => { historyReads++; return records; };
  service.catalog = { find: () => ({ toArray: async () => catalog }) };
  const all = await service.discover('d', [2], { mode: 'all', pageSize: 2, page: 3 });
  assert.equal(all.total, 7);
  assert.deepEqual(all.rows.map(row => row.id), [4, 3]);
  assert.deepEqual(all.rows[0].conflicts[0].accepted, ['4/A']);
  assert.equal(historyReads, 1);
  const clear = await service.discover('d', [2], { mode: 'clear', pageSize: 2, page: 2 });
  assert.equal(clear.total, 4);
  assert.deepEqual(clear.rows.map(row => row.id), [2, 1]);
  const search = await service.discover('d', [2], { query: 'ROUND 5' });
  assert.equal(search.rows[0].attended, 1);
  const unknown = await service.discover('d', [2, 99], { mode: 'clear' });
  assert.equal(unknown.total, 0);
});

function schedulerFixture(t) {
  const now = Date.now();
  const state = { _id: 'd', revision: 1, accounts: [], runs: [{ status: 'published', startAt: now - 120000,
    durationSeconds: 7200, members: [1, 2, 3, 4, 5, 6].map(uid => ({ uid })) }] };
  const service = new TrainingService({ collection: () => ({}) });
  t.after(() => service.close());
  const jobs = new Map();
  let reads = 0;
  service.states = { find: () => { reads++; return { toArray: async () => [structuredClone(state)] }; } };
  service.state = async () => structuredClone(state);
  service.change = async (_, apply) => {
    const copy = structuredClone(state);
    const result = await apply(copy);
    Object.assign(state, copy, { revision: state.revision + 1 });
    return result;
  };
  service.jobs = {
    find: () => ({ toArray: async () => [...jobs.values()].filter(j => j.kind === 'sync' && ['queued', 'running'].includes(j.status)) }),
    updateOne: async (filter, update) => {
      if (update.$set?.payload) jobs.set(filter._id, { _id: filter._id, ...update.$set });
      return { matchedCount: 1 };
    },
    updateMany: async () => ({}),
    findOneAndUpdate: async () => ({ _id: 'long-catalog-job', kind: 'catalog' }),
  };
  service.locks = { findOneAndUpdate: async () => ({ owner: service.instance }), updateOne: async () => ({}) };
  let busyProcessed = 0;
  service.syncCatalog = async () => { busyProcessed++; };
  const account = (uid, status = 'ready', age = 120000) => ({ uid, bindingId: `b${uid}`, status,
    historyComplete: true, lastSyncAt: now - age, syncGeneration: 7,
    syncRequest: { generation: 7, since: 0 }, cycle: status === 'syncing' ? { since: 0, cursor: 476 } : null });
  return { service, state, jobs, now, account, reads: () => reads, busyProcessed: () => busyProcessed };
}

test('busy worker schedules due active students without restarting pending or failed histories', async t => {
  const f = schedulerFixture(t);
  f.state.accounts = [f.account(1), f.account(2, 'syncing'), f.account(3, 'queued'),
    f.account(4, 'failed'), f.account(5, 'ready', 1000), f.account(6)];
  f.jobs.set('d:sync:b6', { _id: 'd:sync:b6', kind: 'sync', status: 'running' });
  const unchanged = structuredClone(f.state.accounts.slice(1));
  await f.service.tick();
  assert.equal(f.busyProcessed(), 1, 'the existing busy job still progresses');
  assert.equal(f.jobs.get('d:sync:b1').payload.generation, 8, 'due student enters before the queue is empty');
  assert.deepEqual(f.state.accounts.slice(1), unchanged, 'pending, failed and fresh accounts retain their requests');
  await f.service.tick();
  assert.equal(f.reads(), 1, 'scheduling scans are throttled while jobs continue');
  assert.equal(f.busyProcessed(), 2);
  await f.service.scheduleDueSyncs(f.now + 30000);
  assert.equal(f.state.accounts[0].syncGeneration, 8, 'a queued account is not restarted on the next scan');
});

test('automatic refresh rechecks readiness after a concurrent manual full-window request', async t => {
  const f = schedulerFixture(t);
  f.state.accounts = [f.account(1)];
  const change = f.service.change;
  f.service.change = async (domainId, apply) => {
    const a = f.state.accounts[0];
    a.status = 'queued'; a.syncGeneration = 8;
    a.syncRequest = { generation: 8, since: 42 };
    return change(domainId, apply);
  };
  await f.service.scheduleDueSyncs(f.now);
  assert.equal(f.state.accounts[0].syncGeneration, 8);
  assert.equal(f.state.accounts[0].syncRequest.since, 42);
  assert.equal(f.jobs.size, 0, 'the scheduler does not enqueue a replacement generation');
});
