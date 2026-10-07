'use strict';
// Real templates with constructed API responses; no Hydro or student data.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { template } = require('./ui.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 850 } });
    const errors = [], writes = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.accept());
    const run = { id: 'expired', title: '过期草稿', status: 'draft', startAt: Date.now() - 86400_000,
      durationSeconds: 3600, rated: true, attendees: [], members: [{ uid: 7, handle: 'student' }],
      rules: { type: 'CF', decayMinutes: 400, wrongPenalty: 75, minimumFraction: 0.3 },
      slots: [{ index: 'A', points: 500, original: { contestId: 100, index: 'A' },
        actual: { contestId: 100, index: 'A', name: 'Problem A' } }] };
    await page.route('http://fixture.test/', r => r.fulfill({ contentType: 'text/html', body: template(true) }));
    await page.route('http://fixture.test/api**', async route => {
      const req = route.request(), args = req.method() === 'POST' ? req.postDataJSON()
        : Object.fromEntries(new URL(req.url()).searchParams);
      let result;
      if (args.action === 'dashboard') result = { isCoach: true, uid: 1, accounts: [], groups: [],
        runs: [run], ledger: [], jobs: [], notices: [] };
      else if (args.action === 'run') result = { run, rows: [], absent: [] };
      else if (args.action === 'reschedule_draft') {
        writes.push(args); run.startAt = Date.parse(args.startAt); result = {};
      } else if (args.action === 'cancel_draft') {
        writes.push(args); run.status = 'cancelled'; run.cancelledAt = Date.now(); run.cancelledBy = 1; result = {};
      } else throw new Error(`Unexpected action ${args.action}`);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, result }) });
    });
    await page.goto('http://fixture.test/');
    await page.locator('[data-open="expired"]').click();
    await page.getByText('草稿已过开赛时间，请先改期。').waitFor();
    assert.match(await page.locator('[data-scoring-rules]').innerText(), /CF 计分.*400 分钟.*75 分.*30%/);
    assert.match(await page.locator('#ct-run-body').innerText(), /草稿已过开赛时间，请先改期/);
    assert.equal(await page.locator('[data-action="publish"]').count(), 0);
    await page.locator('#ct-reschedule-draft [name="startAt"]').fill('2030-01-02T12:00');
    await page.locator('#ct-reschedule-draft button').click();
    await page.locator('[data-action="publish"]').waitFor();
    assert.equal(writes[0].action, 'reschedule_draft');
    await page.locator('[data-action="cancel_draft"]').click();
    await page.getByText('此草稿已于', { exact: false }).waitFor();
    assert.equal(writes[1].action, 'cancel_draft');
    assert.equal(await page.locator('#ct-reschedule-draft').count(), 0);
    assert.equal(await page.locator('[data-action="refresh_run"]').count(), 0);
    assert.equal(await page.locator('[data-action="publish"]').count(), 0);
    assert.match(await page.locator('#ct-runs').innerText(), /已取消/);
    assert.deepEqual(errors, []);
    console.log('PASS: draft lifecycle template — expired reschedule, cancellation and archived detail');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
