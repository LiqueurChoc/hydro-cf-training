'use strict';
// Real templates, constructed responses only; no Hydro/Mongo/CF access.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { template } = require('./ui.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 850 } });
    const errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message));
    const run = { id: 'run', title: '接触证据回归', status: 'published', startAt: Date.now() - 7200000,
      durationSeconds: 3600, rated: true, attendees: [7], members: [{ uid: 7, handle: 'student' }],
      slots: [{ index: 'A', points: 500, original: { contestId: 100, index: 'A' }, actual: { contestId: 100, index: 'A' } }] };
    const history = { publicationMissing: true, corrections: [], evidence: [
      { id: 'notice:100/A', source: 'manual', key: '100/A' },
      { id: 'submission:77:problem', source: 'submission', key: '100/A' },
    ] };
    await page.route('http://fixture.test/', r => r.fulfill({ contentType: 'text/html', body: template(true) }));
    await page.route('http://fixture.test/api**', async route => {
      const req = route.request(), args = req.method() === 'POST' ? req.postDataJSON()
        : Object.fromEntries(new URL(req.url()).searchParams);
      let result;
      if (args.action === 'dashboard') result = { isCoach: true, uid: 1, accounts: [], groups: [],
        runs: [run], ledger: [], jobs: [], notices: [] };
      else if (args.action === 'run') result = { run, absent: [], rows: [{ uid: 7, handle: 'student', rank: 1,
        points: 0, penalty: 0, problems: [], reason: '已有接触记录', complete: true, history }] };
      else if (args.action === 'correct_exposure') {
        writes.push(args);
        history.corrections.push({ uid: 7, actor: 1, at: Date.now(), reason: args.reason, evidenceIds: args.evidenceIds });
        result = {};
      } else throw new Error(`Unexpected action ${args.action}`);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, result }) });
    });
    await page.goto('http://fixture.test/');
    await page.locator('[data-tab="home"]').first().click();
    await page.locator('[data-open="run"]').click();
    await page.getByText('本场接触证据与误报纠正', { exact: true }).click();
    const form = page.locator('[data-correct-exposure="7"]');
    assert.match(await form.innerText(), /缺少发布检查快照/);
    assert.equal(await form.locator('[name="reason"]').getAttribute('required'), '');
    await form.locator('[value="notice:100/A"]').check();
    await form.locator('[name="reason"]').fill('已核实 <img src=x onerror=alert(1)>');
    await form.getByRole('button', { name: '纠正所选证据' }).click();
    await page.waitForFunction(() => document.querySelector('[data-correct-exposure]').textContent.includes('教练 UID 1'));
    assert.deepEqual(writes[0].evidenceIds, ['notice:100/A']);
    assert.equal(writes[0].uid, 7);
    assert.equal(await form.locator('[value="notice:100/A"]').isDisabled(), true);
    assert.equal(await form.locator('[value="submission:77:problem"]').isDisabled(), false);
    assert.equal(await form.locator('img').count(), 0, 'audit text is escaped');
    run.status = 'settled';
    await page.locator('[data-reload]').click();
    await page.waitForFunction(() => document.querySelector('[data-correct-exposure] input').disabled);
    assert.equal(await form.locator('button').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: exposure template — scoped selection, required reason, escaped audit and settled lock');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
