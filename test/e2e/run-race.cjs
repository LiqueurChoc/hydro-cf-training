'use strict';
// Real templates with constructed API responses; no Hydro or student data.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { template } = require('./ui.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const errors = [], writes = [];
    const runs = ['A', 'B'].map(id => ({ id, title: 'Training ' + id, status: 'draft',
      startAt: Date.now() + 3600000, durationSeconds: 3600, rated: true,
      attendees: [], members: [], slots: [] }));
    let releaseA, startedA;
    const pendingA = new Promise(resolve => { releaseA = resolve; });
    const sawA = new Promise(resolve => { startedA = resolve; });
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.accept());
    await page.route('http://fixture.test/', route => route.fulfill({
      contentType: 'text/html', body: template(true),
    }));
    await page.route('http://fixture.test/api**', async route => {
      const request = route.request();
      const args = request.method() === 'POST' ? request.postDataJSON()
        : Object.fromEntries(new URL(request.url()).searchParams);
      let result;
      if (args.action === 'dashboard') {
        result = { isCoach: true, uid: 1, accounts: [], groups: [], runs,
          ledger: [], jobs: [], notices: [] };
      } else if (args.action === 'run') {
        if (args.id === 'A') { startedA(); await pendingA; }
        result = { run: runs.find(r => r.id === args.id), rows: [], absent: [] };
      } else if (args.action === 'cancel_draft') {
        writes.push(args);
        const run = runs.find(r => r.id === args.id);
        run.status = 'cancelled';
        run.cancelledAt = Date.now();
        run.cancelledBy = 1;
        result = {};
      } else throw new Error(`Unexpected action ${args.action}`);
      await route.fulfill({ contentType: 'application/json',
        body: JSON.stringify({ ok: true, result }) });
    });
    await page.goto('http://fixture.test/');
    await page.locator('[data-open="A"]').click();
    await sawA;
    // The old UI exposed both list entries while loading. Drive the same rapid
    // navigation path even though the fixed UI now shows a loading detail view.
    await page.evaluate(() => document.querySelector('[data-open="B"]').click());
    await page.waitForFunction(() => document.getElementById('ct-run-title').textContent === 'Training B');
    releaseA();
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#ct-run-title').innerText(), 'Training B');
    await Promise.all([
      page.waitForResponse(response => response.request().method() === 'POST'),
      page.locator('[data-action="cancel_draft"]').click(),
    ]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].action, 'cancel_draft');
    assert.equal(writes[0].id, 'B', 'write must target the rendered run');
    assert.deepEqual(errors, []);
    console.log('PASS: run detail race — late response dropped and action targets rendered run');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
