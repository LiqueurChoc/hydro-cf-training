'use strict';
// Real templates and production projection; constructed data, no Hydro/Mongo/CF.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { template } = require('./ui.cjs');
const { studentRunResponse } = require('../../lib/student-response');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 850 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const run = { id: 'run', title: '学生响应回归', status: 'published', startAt: Date.now() + 60000,
      durationSeconds: 3600, rated: true, attendees: [],
      rules: { type: 'CF', decayMinutes: 300, wrongPenalty: 25, minimumFraction: 0.3 },
      slots: [{ index: 'A', points: 500, actual: { contestId: 100, index: 'A', name: 'Actual problem' } }] };
    const rows = [7, 8].map(uid => ({ uid, handle: `student${uid}`, rank: uid - 6, points: 500,
      penalty: 0, complete: true, reason: uid === 7 ? '教练设为练习' : '已有接触记录',
      problems: [{ index: 'A', solved: true, points: 500 }], history: { touched: ['SECRET'] } }));
    await page.route('http://fixture.test/', r => r.fulfill({ contentType: 'text/html', body: template(false) }));
    await page.route('http://fixture.test/api**', async route => {
      const req = route.request(), args = req.method() === 'POST' ? req.postDataJSON()
        : Object.fromEntries(new URL(req.url()).searchParams);
      let result;
      if (args.action === 'dashboard') result = { isCoach: false, uid: 7, accounts: [], groups: [],
        runs: [run], ledger: [], jobs: [], notices: [] };
      else if (args.action === 'run') result = studentRunResponse({ run, rows }, 7);
      else if (args.action === 'attend') { run.attendees.push(7); result = {}; }
      else if (args.action === 'problems') result = { rows: [], counts: { all: 0, solved: 0, attempted: 0 }, page: 1, pages: 1 };
      else if (args.action === 'problem_stats') result = { account: null, solvedTotal: 0 };
      else throw new Error(`Unexpected action ${args.action}`);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, result }) });
    });
    await page.goto('http://fixture.test/');
    await page.locator('[data-open="run"]').click();
    await page.getByText('题目将在开赛后显示。签到不会改变统一开赛时间。', { exact: true }).waitFor();
    assert.match(await page.locator('#ct-run-body').innerText(), /题目将在开赛后显示/);
    assert.match(await page.locator('[data-scoring-rules]').innerText(), /CF 计分.*300 分钟.*25 分.*30%/);
    assert.equal(await page.locator('#ct-run-body a').count(), 0);
    await page.locator('[data-action="attend"]').click();
    await page.getByRole('button', { name: '已签到', exact: true }).waitFor();
    for (const status of ['published', 'settled']) {
      run.startAt = Date.now() - 60000; run.status = status;
      if (status === 'settled') run.rules = { type: 'ICPC', icpcPenalty: 20 };
      await page.locator('[data-reload]').click();
      await page.getByRole('link', { name: /Actual problem/ }).waitFor();
      assert.match(await page.getByRole('link', { name: /Actual problem/ }).getAttribute('href'), /100\/A/);
      const text = await page.locator('#ct-run-body').innerText();
      assert.match(text, /student7/); assert.match(text, /student8/);
      assert.match(text, /A ✓ 500/); assert.match(text, /教练设为练习/);
      assert.doesNotMatch(text, /已有接触记录|SECRET|发布时的旧题检查|误报纠正/);
      if (status === 'settled') {
        await page.waitForFunction(() => !document.querySelector('[data-action="attend"]'));
        assert.match(await page.locator('[data-scoring-rules]').innerText(), /ICPC 计分.*20 分钟/);
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS: student response template — hidden problems, check-in, actual links, board and settled view');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
