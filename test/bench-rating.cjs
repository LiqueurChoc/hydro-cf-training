'use strict';
// Synthetic, isolated performance probe; no Hydro, MongoDB or CF requests.
const os = require('node:os');
const assert = require('node:assert/strict');
const { TrainingService } = require('../lib/service');
const { ratingInput, replayOriginal } = require('../lib/rating');
const c = require('../lib/core');
const referenceCount = 20946, studentCount = 100, runCount = 10;
const reference = Array.from({ length: referenceCount }, (_, i) => ({
  rating: 800 + i % 2000, points: referenceCount - i, penalty: 0,
}));
const inputs = Array.from({ length: studentCount }, (_, i) => ({
  uid: i + 1, handle: `fixture${i}`, points: 5000 + i, penalty: 0,
}));
const state = { _id: 'synthetic-benchmark',
  ratingBaselines: Object.fromEntries(inputs.map(x => [x.uid, { rating: 1600 }])),
  ledger: Array.from({ length: runCount }, (_, i) => ({
    runId: String(i), snapshot: 'synthetic-pool', endAt: i, inputs, algorithm: c.VERSION,
  })),
};
const service = new TrainingService({ collection: () => ({}) });
service.refs = { findOne: async () => ({ contest: { type: 'CF' } }),
  find: () => ({ toArray: async () => [{ rows: reference }] }) };
(async () => {
  let ticks = 0, maxTimerGapMs = 0, previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now(); maxTimerGapMs = Math.max(maxTimerGapMs, now - previous); previous = now; ticks++;
  }, 10);
  try {
    const start = performance.now();
    const cold = await service.replay(state, { wait: false });
    const coldReadMs = performance.now() - start;
    assert.equal(cold.status, 'computing');
    const report = await service.replay(state);
    const rebuildMs = performance.now() - start;
    const startHot = performance.now();
    const hot = await service.replay(state, { wait: false });
    const hotReadMs = performance.now() - startHot;
    assert.deepEqual(hot, report); assert.equal(service.ratingCache.starts, 1); assert.ok(ticks > 0);
    clearInterval(timer);
    // Full-size differential check using the original scoring path.
    const expected = await replayOriginal(ratingInput(state), () => service.reference('synthetic-pool'));
    assert.deepEqual(report.ratings, expected.ratings);
    assert.deepEqual(report.ledger.map(({ runId, changes }) => ({ runId, changes })), expected.ledger);
    console.log(JSON.stringify({ fixture: 'synthetic; no external IO', node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30),
      referenceCount, studentCount, runCount, coldReadMs, rebuildMs, hotReadMs,
      timerIntervalMs: 10, ticks, maxTimerGapMs, workerStarts: service.ratingCache.starts,
      originalReplayEqual: true }, null, 2));
  } finally { clearInterval(timer); service.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
