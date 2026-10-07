'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { problemHistory } = require('../lib/history');
const { TrainingService } = require('../lib/service');

test('submission history groups by problem, keeps AC and counts every other submission as attempted', () => {
  const records = [
    { problem: { contestId: 2000, index: 'A', name: 'Alpha', rating: 1200 }, verdict: 'WRONG_ANSWER', creationTimeSeconds: 1 },
    { problem: { contestId: 2000, index: 'A', name: 'Alpha', rating: 1200 }, verdict: 'OK', creationTimeSeconds: 2 },
    { problem: { contestId: 2000, index: 'A', name: 'Alpha', rating: 1200 }, verdict: 'WRONG_ANSWER', creationTimeSeconds: 3 },
    { problem: { contestId: 2001, index: 'B', name: 'Beta' }, verdict: 'COMPILATION_ERROR', creationTimeSeconds: 4 },
    { problem: { contestId: 100001, index: 'C', name: 'Gym' }, creationTimeSeconds: 5 },
    { problem: { index: 'D' }, verdict: 'OK', creationTimeSeconds: 6 },
  ];
  const all = problemHistory(records, { pageSize: 2 });
  assert.deepEqual(all.counts, { all: 3, solved: 1, attempted: 2 });
  assert.deepEqual(all.rows.map(p => p.key), ['100001/C', '2001/B']);
  assert.equal(all.pages, 2);
  assert.equal(problemHistory(records, { page: 2, pageSize: 2 }).rows[0].status, 'solved');
  assert.equal(problemHistory(records, { status: 'solved' }).rows[0].ac, 1);
  assert.equal(problemHistory(records, { status: 'solved' }).rows[0].submissions, 3);
  assert.deepEqual(problemHistory(records, { status: 'attempted' }).rows.map(p => p.key), ['100001/C', '2001/B']);
  assert.throws(() => problemHistory(records, { status: 'pending' }), /未知题目状态/);
});

test('student problem history reads only the current account binding', async () => {
  const service = Object.create(TrainingService.prototype);
  service.state = async () => ({ accounts: [{ uid: 2, bindingId: 'new-binding' }] });
  service.allRecords = async bindingId => {
    assert.equal(bindingId, 'new-binding');
    return [{ problem: { contestId: 3000, index: 'A' }, verdict: 'OK', creationTimeSeconds: 1 }];
  };
  assert.deepEqual((await service.studentProblems('domain', 2)).rows.map(row => row.key), ['3000/A']);
  assert.equal((await service.studentProblems('domain', 3)).counts.all, 0);
});

test('student history rejects an account changed while its records were loading', async () => {
  const service = Object.create(TrainingService.prototype);
  let bindingId = 'old';
  service.state = async () => ({ accounts: [{ uid: 2, bindingId }] });
  service.allRecords = async () => {
    bindingId = 'new';
    return [{ problem: { contestId: 3000, index: 'A' }, verdict: 'OK' }];
  };
  await assert.rejects(service.studentProblems('domain', 2), /账号已更换/);
});
