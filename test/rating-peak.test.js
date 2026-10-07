'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { TrainingService } = require('../lib/service');
const c = require('../lib/core');

// Execute the production statistics renderer against real replay output.
const app = fs.readFileSync(require.resolve('../templates/cf_training_app.html'), 'utf8');
function render(state, report, uid = 2) {
  const host = { innerHTML: '' };
  const context = { data: { uid, ledger: report.ledger, ratingStatus: report.status },
    mine: { rating: report.ratings[uid] ?? null, ratingBaseline: state.ratingBaselines?.[uid] },
    $: () => host, ratingPending: d => d.ratingStatus !== 'ready', ratingMessage: () => '计算中',
    bandOf: () => ['', '#008000', 'Pupil'], esc: String, signed: String, deltaClass: () => '',
    ratingDetails: () => '', drawRatingChart() {} };
  vm.runInNewContext(app.slice(app.indexOf('  function renderRating('), app.indexOf('  function ratingDetails('))
    + '\nrenderRating(mine);', context);
  const values = [...host.innerHTML.matchAll(/<strong[^>]*>([^<]*)<\/strong>/g)].map(m => m[1]);
  return { html: host.innerHTML, current: values[0], peak: values[1] };
}

test('A: explicit label, 1400 → 1500 → void, baseline maximum and uninitialized display', () => {
  const state = { ratingBaselines: { 2: { rating: 1400 } } };
  const report = { status: 'ready', ratings: { 2: 1500 }, ledger: [{ runId: 'a', endAt: 1,
    changes: [{ uid: 2, oldRating: 1400, newRating: 1500, delta: 100 }] }] };
  assert.equal(render(state, report).peak, '1500');
  assert.match(render(state, report).html, /有效训练历史最高/);
  assert.match(render(state, report).html, /撤销.*下降/);
  report.ledger = []; report.ratings[2] = 1400;
  assert.equal(render(state, report).peak, '1400');
  report.ledger = [{ runId: 'b', endAt: 2, changes: [{ uid: 2, oldRating: 1400, newRating: 1300, delta: -100 }] }];
  report.ratings[2] = 1300;
  assert.equal(render(state, report).peak, '1400');
  assert.equal(render({}, { status: 'ready', ratings: {}, ledger: [] }).peak, '待同步');
  assert.equal(render(state, { ...report, status: 'computing' }).peak, undefined);
});

test('A: worker/cache replay follows early void, resettlement, cold rebuild and baseline initialization', async () => {
  const service = new TrainingService({ collection: () => ({}) });
  const rows = Array.from({ length: 30 }, (_, i) => ({ rating: 1000 + i * 30, points: i * 50, penalty: 0 }));
  service.refs = { findOne: async () => ({ contest: { type: 'CF' } }), find: () => ({ toArray: async () => [{ rows }] }) };
  const state = { _id: 'peak-fixture', ratingBaselines: { 2: { rating: 1400 } }, ledger: [] };
  const event = (runId, endAt, points) => ({ runId, title: runId, endAt, snapshot: 'ref', algorithm: c.VERSION,
    inputs: [{ uid: 2, handle: 'fixture', points, penalty: 0 }] });
  const engine = c.referenceEngine(rows, 'CF');
  try {
    assert.equal(render(state, await service.replay(state)).peak, '1400');
    // Store out of order to verify end-time replay, not insertion order.
    state.ledger = [event('late', 2, 800), event('early', 1, 2000)];
    const first = engine(state.ledger[1].inputs[0], 1400).newRating;
    assert.ok(first > 1400);
    const second = engine(state.ledger[0].inputs[0], first).newRating;
    const before = await service.replay(state);
    assert.equal(render(state, before).peak, String(Math.max(1400, first, second)));
    state.ledger[1].void = true;
    const after = await service.replay(state);
    const remaining = engine(state.ledger[0].inputs[0], 1400).newRating;
    assert.notEqual(after.version, before.version);
    assert.notEqual(remaining, second, 'later rating changes after early void');
    assert.deepEqual(after.ledger.map(e => e.runId), ['late']);
    assert.equal(render(state, after).peak, String(Math.max(1400, remaining)));
    const starts = service.ratingCache.starts;
    assert.deepEqual(await service.replay(state), after);
    assert.equal(service.ratingCache.starts, starts, 'hot read reuses the valid version');
    state.ledger[1] = event('early', 1, 0); // corrected resettlement
    const correctedFirst = engine(state.ledger[1].inputs[0], 1400).newRating;
    const correctedSecond = engine(state.ledger[0].inputs[0], correctedFirst).newRating;
    const corrected = await service.replay(state);
    assert.equal(render(state, corrected).peak, String(Math.max(1400, correctedFirst, correctedSecond)));
    service.ratingCache.entries.clear(); service.ratingCache.bytes = 0;
    assert.deepEqual(await service.replay(state), corrected, 'cold rebuild keeps the same semantics');
    state.ledger.forEach(e => { e.void = true; });
    assert.equal(render(state, await service.replay(state)).peak, '1400');
    delete state.ratingBaselines[2];
    assert.equal(render(state, await service.replay(state)).peak, '待同步');
    state.ratingBaselines[2] = { rating: 1800 };
    assert.equal(render(state, await service.replay(state)).peak, '1800');
  } finally { service.close(); }
});
