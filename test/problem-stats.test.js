'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/core');
const { TrainingService } = require('../lib/service');
const { aggregateProblemHistory, problemHistory } = require('../lib/history');

const sub = (id, contestId, index, verdict, time, data = {}) => ({ id, creationTimeSeconds: time,
  problem: { contestId, index, ...data }, verdict });

test('full history aggregation deduplicates identities, includes Gym, and chooses valid metadata deterministically', () => {
  const records = [
    sub(1, 10, 'a', 'OK', 100, { rating: 1200, tags: ['dp', ' math ', 'dp'] }),
    sub(3, 10, 'A', 'WRONG_ANSWER', 300, { rating: 0, tags: [null, '  '] }),
    sub(2, 10, 'A', 'OK', 300, { rating: 1300, tags: ['math'] }),
    sub(4, 11, 'A', 'OK', 100, { name: 'Other contest' }),
    sub(5, 100001, 'B', 'OK', 100),
    sub(6, 12, 'C', 'WRONG_ANSWER', 400),
    sub(7, 0, 'D', 'OK', 500),
    sub(8, 13, 'bad-index', 'OK', 600),
  ];
  const rows = aggregateProblemHistory(records);
  const byKey = new Map(rows.map(row => [row.key, row]));
  assert.deepEqual([...byKey.keys()].sort(), ['10/A', '100001/B', '11/A', '12/C']);
  assert.equal(byKey.get('10/A').ac, 2);
  assert.equal(byKey.get('10/A').rating, 1300); // Same timestamp: larger submission ID wins.
  assert.deepEqual(byKey.get('10/A').tags, ['math']); // Most recent non-empty tag set, not a union.
  assert.equal(byKey.get('100001/B').ac, 1);
  assert.deepEqual(problemHistory(records).counts, { all: 4, solved: 3, attempted: 1 });
  assert.deepEqual(aggregateProblemHistory(records.slice().reverse()).map(r => [r.key,r.rating,r.tags,r.ac]).sort(),
    rows.map(r => [r.key,r.rating,r.tags,r.ac]).sort());
});

test('rating and tag distributions preserve denominators, unknown identity, and stable ordering', () => {
  const problems = [
    { rating: 1200, tags: ['dp', 'math', 'dp'] },
    { rating: 1400, tags: ['math'] },
    { rating: null, tags: [] },
    { rating: 0, tags: ['<x>', ''] },
    { rating: 1.5, tags: [{ name: 'ignored' }, 'dp'] },
  ];
  const rating = c.ratingHistogram(problems);
  assert.deepEqual(rating, { bins: [{min:1200,max:1299,count:1},{min:1400,max:1499,count:1}], unrated:3, total:5 });
  const tags = c.tagPie(problems);
  assert.equal(tags.total, 6);
  assert.deepEqual(tags.rows, [
    {kind:'tag',tag:'dp',count:2}, {kind:'tag',tag:'math',count:2},
    {kind:'tag',tag:'<x>',count:1}, {kind:'unknown',tag:null,count:1},
  ]);
  assert.deepEqual(c.tagPie([]), { rows: [], total: 0 });
  assert.deepEqual(c.ratingHistogram([]), { bins: [], unrated: 0, total: 0 });
});

test('student stats uses all AC history, catalog wins field by field, and batch loads only related problems', async () => {
  const service = Object.create(TrainingService.prototype);
  service.state = async () => ({ accounts: [{ uid: 7, handle: 'Coder', bindingId: 'binding', historyComplete: false,
    status: 'syncing', lastSyncAt: 123 }] });
  const records = [
    sub(1, 1000, 'A', 'OK', 10, { rating: 1200, tags: ['old'] }),
    sub(2, 1000, 'A', 'OK', 20, { tags: ['fallback', 'fallback'] }),
    ...Array.from({length: 505}, (_, i) => sub(i + 3, 2000 + i, 'B', 'OK', 30 + i, i === 0 ? { tags: ['fallback'] } : {})),
    sub(90, 9000, 'Z', 'WRONG_ANSWER', 200, { rating: 1900, tags: ['ignored'] }),
  ];
  service.allRecords = async binding => { assert.equal(binding, 'binding'); return records; };
  let queries = 0, queriedIds = [];
  service.catalog = {
    find: filter => ({ toArray: async () => {
      queries++;
      queriedIds.push(...filter._id.$in);
      return filter._id.$in.includes('problem:1000/A')
        ? [{_id:'problem:1000/A',data:{rating:1600,tags:[' catalog ', 'catalog', 3]}}] : [];
    } }),
    findOne: async filter => filter._id === 'meta' ? { syncedAt: 456 } : null,
  };
  const result = await service.studentProblemStats('domain', 7);
  assert.equal(queries, 2);
  assert.equal(queriedIds.length, 506);
  assert.equal(result.solvedTotal, 506);
  assert.equal(result.rating.bins.find(b => b.min === 1600).count, 1);
  assert.equal(result.rating.unrated, 505);
  assert.equal(result.tagDistribution.rows.find(r => r.tag === 'catalog').count, 1);
  assert.equal(result.tagDistribution.rows.find(r => r.tag === 'fallback').count, 1);
  assert.equal(result.tagDistribution.rows.find(r => r.kind === 'unknown').count, 504);
  assert.equal(result.account.bindingId, 'binding');
  assert.equal(result.account.historyComplete, false);
  assert.equal(result.catalogSyncedAt, 456);
  assert.equal((await service.studentProblemStats('domain', 8)).solvedTotal, 0);
});

test('stats refuses to return records after the account is rebound during aggregation', async () => {
  const service = Object.create(TrainingService.prototype);
  let reads = 0;
  service.state = async () => ({ accounts: [{ uid: 7, handle: 'Coder', bindingId: ++reads === 1 ? 'old' : 'new', status: 'ready' }] });
  service.allRecords = async () => [];
  service.catalog = { findOne: async () => null };
  await assert.rejects(service.studentProblemStats('domain', 7), /账号已更换/);
});
