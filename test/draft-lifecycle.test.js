'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { TrainingService } = require('../lib/service');

test('Mongo: expired draft cancellation releases rebind and concurrent publish has one legal outcome', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db = client.db(`cftrain_test_${randomUUID().replaceAll('-', '')}`);
  const service = new TrainingService(db, { client: { call: async () => [] } });
  try {
    await service.init();
    await service.change('test', s => {
      s.accounts.push({ uid: 2, handle: 'old_handle', bindingId: 'binding', approved: true, status: 'ready' });
      s.runs.push({ id: 'expired', status: 'draft', startAt: Date.now() - 86400_000,
        members: [{ uid: 2, handle: 'old_handle', bindingId: 'binding' }], slots: [{ index: 'A' }], attendees: [] });
    });
    await assert.rejects(service.bind('test', 2, 'new_handle', 9), /草稿/);
    await service.cancelDraft('test', 'expired', 9);
    const once = await service.state('test');
    await service.cancelDraft('test', 'expired', 9);
    assert.equal((await service.state('test')).revision, once.revision, 'repeat cancel makes no write');
    assert.equal(once.audit.filter(x => x.action === 'cancel_draft').length, 1);
    assert.equal(once.runs[0].cancelledBy, 9);
    await service.bind('test', 2, 'new_handle', 9);
    assert.equal((await service.state('test')).accounts[0].handle, 'new_handle');
    await assert.rejects(service.result('test', 'expired'), /已取消/);
    await assert.rejects(service.preview('test', 'expired'), /只有已发布/);

    await service.change('test', s => {
      s.runs.push({ id: 'active', status: 'draft', startAt: Date.now() + 86400_000,
        members: [{ uid: 2, bindingId: s.accounts[0].bindingId }], slots: [], attendees: [] });
    });
    const results = await Promise.allSettled([
      service.cancelDraft('test', 'active', 9),
      service.change('test', s => {
        const run = s.runs.find(r => r.id === 'active');
        if (run.status !== 'draft') throw new Error('not a draft');
        run.status = 'published';
      }),
      service.bind('test', 2, 'third_handle', 9),
    ]);
    const active = (await service.state('test')).runs.find(r => r.id === 'active');
    assert.equal(results.slice(0, 2).filter(x => x.status === 'fulfilled').length, 1);
    assert(['cancelled', 'published'].includes(active.status));
    if (active.status === 'published') {
      assert.equal(results[2].status, 'rejected');
      assert.equal((await service.state('test')).accounts[0].handle, 'new_handle');
    } else {
      if (results[2].status === 'rejected') await service.bind('test', 2, 'third_handle', 9);
      assert.equal((await service.state('test')).accounts[0].handle, 'third_handle');
    }
  } finally {
    await service.close();
    await db.dropDatabase();
    await client.close();
  }
});

test('Mongo: expired draft can move to future without changing configuration; live draft still locks binding', {
  skip: !process.env.CFTRAIN_TEST_MONGO_URL,
}, async () => {
  const { MongoClient } = require('mongodb');
  const client = await MongoClient.connect(process.env.CFTRAIN_TEST_MONGO_URL);
  const db = client.db(`cftrain_test_${randomUUID().replaceAll('-', '')}`);
  const service = new TrainingService(db, { client: { call: async () => [] } });
  try {
    await service.init();
    const slots = [{ index: 'A', actual: { contestId: 2000, index: 'B' } }];
    const originalStartAt = Date.now() - 86400_000;
    await service.change('test', s => {
      s.accounts.push({ uid: 2, handle: 'old_handle', bindingId: 'binding', approved: true, status: 'ready' });
      s.runs.push({ id: 'expired', status: 'draft', startAt: originalStartAt,
        members: [{ uid: 2, bindingId: 'binding', practice: true }], slots, attendees: [],
        screening: [{ uid: 2 }], configHash: 'stale' });
    });
    const future = Date.now() + 86400_000;
    await service.rescheduleDraft('test', 'expired', future, 9);
    const s = await service.state('test');
    assert.equal(s.runs[0].startAt, future);
    assert.deepEqual(s.runs[0].slots, slots);
    assert.equal(s.runs[0].members[0].practice, true);
    assert.equal(s.runs[0].screening, undefined);
    assert.equal(s.runs[0].configHash, undefined);
    assert.deepEqual({ from: s.audit[0].previousStartAt, to: s.audit[0].startAt },
      { from: originalStartAt, to: future });
    await assert.rejects(service.bind('test', 2, 'new_handle', 9), /草稿/);
    await assert.rejects(service.rescheduleDraft('test', 'expired', Date.now() - 1, 9), /未来/);
    await service.change('test', state => { state.runs[0].status = 'published'; });
    await assert.rejects(service.rescheduleDraft('test', 'expired', future + 1000, 9), /只能修改草稿/);
    await assert.rejects(service.cancelDraft('test', 'expired', 9), /只能取消草稿/);
  } finally {
    await service.close();
    await db.dropDatabase();
    await client.close();
  }
});
