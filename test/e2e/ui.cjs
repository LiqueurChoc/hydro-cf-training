'use strict';
// Real plugin templates with constructed API data; no Hydro server or student data is used.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = path.resolve(__dirname, '../..');
const app = fs.readFileSync(path.join(base, 'templates/cf_training_app.html'), 'utf8');
function template(coach) {
  // The page only uses these flat role conditionals and four interpolations.
  let html = fs.readFileSync(path.join(base, 'templates/cf_training.html'), 'utf8')
    .replace(/{% if (not )?cfCoach %}([\s\S]*?){% endif %}/g, (_, not, body) => {
      const [yes, no = ''] = body.split('{% else %}');
      return (not ? !coach : coach) ? yes : no;
    })
    .replace(/{{ '([^']*)' if cfCoach else '([^']*)' }}/g, (_, yes, no) => coach ? yes : no)
    .replace(/{{ url\('cf_training'\) }}/g, '/')
    .replace(/{{ url\('cf_training_api'\) }}/g, '/api')
    .replace(/{{ cfToken }}/g, 'fixture')
    .replace(/{% include "cf_training_app.html" %}/, () => app)
    .replace(/{% (?:extends "layout\/basic.html"|block content|endblock|raw|endraw) %}/g, '');
  assert.doesNotMatch(html, /{%|{{/, 'fixture renderer must cover the actual template');
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body>' + html + '</body></html>';
}
const account = { uid: 7, handle: 'FixtureHandle', bindingId: 'binding-1', approved: true,
  historyComplete: true, scanned: 5, status: 'ready', lastSyncAt: 1799990000000, rating: 1500,
  ratingBaseline: { rating: 1400, source: 'cf', handle: 'FixtureHandle', at: 1790000000000 } };
function dashboard(coach = false) {
  return { isCoach: coach, uid: 7, accounts: [{ ...account }],
    groups: [{ id: 'fixture-class', name: 'Fixture class', uids: [7], member: true, canManage: coach, canOwn: coach, ownerId: 7, adminIds: [], version: 0 }],
    notices: [{ key: '2000/A', createdAt: 1 }, { key: 'contest:2001', createdAt: 2 }],
    runs: [], ledger: [], jobs: [], catalog: null };
}
const stats = { account, catalogSyncedAt: null, solvedTotal: 3,
  rating: { bins: [{ min: 1200, max: 1299, count: 1 }, { min: 1400, max: 1499, count: 1 }], unrated: 1 },
  tagDistribution: { total: 4, rows: [{ kind: 'tag', tag: 'math', count: 2 },
    { kind: 'tag', tag: '<img src=x onerror=alert(1)>', count: 1 }, { kind: 'unknown', tag: null, count: 1 }] } };
function problems(status = 'all') {
  const rows = [{ key: '2000/A', contestId: 2000, index: 'A', name: 'Passed fixture', status: 'solved', submissions: 2 },
    { key: '2001/B', contestId: 2001, index: 'B', name: 'Attempted fixture', status: 'attempted', submissions: 1 }];
  return { rows: rows.filter(r => status === 'all' || r.status === status), counts: { all: 2, solved: 1, attempted: 1 }, page: 1, pages: 1, status };
}
const respond = (route, result) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, result }) });
module.exports = { template };
if (require.main === module) (async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.on('pageerror', error => errors.push(error.message));
    let current = dashboard(), currentStats = structuredClone(stats);
    let holdProblems = true, held = [], delayedSolved = null;
    await page.route('http://fixture.test/', route => route.fulfill({ contentType: 'text/html', body: template(false) }));
    await page.route('http://fixture.test/api**', async route => {
      const req = route.request(), args = req.method() === 'POST' ? req.postDataJSON() : Object.fromEntries(new URL(req.url()).searchParams);
      if (args.action === 'dashboard') return respond(route, current);
      if (args.action === 'group_leaderboard') return respond(route, {id:args.id,rows:[]});
      if (args.action === 'problem_stats') return respond(route, currentStats);
      if (args.action === 'problems') {
        if (holdProblems) { held.push(route); return; }
        if (args.status === 'solved') { delayedSolved = route; return; }
        return respond(route, problems(args.status));
      }
      if (args.action === 'unsee') {
        const key = args.kind === 'contest' ? `contest:${args.value}` : args.value;
        current.notices = current.notices.filter(n => n.key !== key);
        return respond(route, {});
      }
      throw new Error(`Unexpected fixture action ${args.action}`);
    });
    await page.goto('http://fixture.test/');
    // A slow history request must not block the rest of the dashboard.
    await page.locator('#ct-stats-tags-chart').waitFor({ timeout: 3000 });
    assert.match(await page.locator('#ct-rating').innerText(), /当前 Rating/);
    assert.match(await page.locator('#ct-rating').innerText(), /有效训练历史最高/);
    assert.match(await page.locator('#ct-rating').innerText(), /撤销错误结算.*可能下降/);
    assert.equal(await page.locator('#ct-rating .ct-stat').nth(1).locator('strong').innerText(), '1400');
    assert.match(await page.locator('#ct-runs').innerText(), /还没有训练场次/);
    holdProblems = false;
    for (const route of held.splice(0)) await respond(route, problems());
    await page.locator('[data-problem-status="solved"]').waitFor();
    await page.locator('[data-problem-status="solved"]').click();
    await page.locator('[data-problem-status="attempted"]').click();
    await page.getByText('2001/B Attempted fixture', { exact: true }).waitFor();
    assert.ok(delayedSolved, 'first filter request is held');
    const late = page.waitForResponse(r => new URL(r.url()).searchParams.get('status') === 'solved');
    await respond(delayedSolved, problems('solved'));
    await late;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(await page.locator('#ct-problems').innerText(), /Attempted fixture/);
    assert.doesNotMatch(await page.locator('#ct-problems').innerText(), /Passed fixture/);
    assert.equal(await page.locator('[data-problem-status="attempted"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#ct-stats-rating-chart rect').count(), 4, 'missing rating bucket filled with zero');
    assert.equal(await page.locator('#ct-stats-tags img').count(), 0, 'external labels remain text');
    const bar = page.locator('#ct-stats-rating-chart [data-stats-index="0"]');
    await bar.focus(); await page.keyboard.press('Enter');
    assert.match(await page.locator('#ct-stats-rating-chart .ct-stats-tip').innerText(), /1200–1299: 1 道/);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#ct-stats-rating-chart .ct-stats-tip').isVisible(), false);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(220); // Production resize debounce.
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no page overflow at ${width}px`);
    }
    await page.getByText('补充我已见过的题目或比赛').click();
    for (const value of ['2000/A', '2001']) {
      await page.locator(`[data-unsee-value="${value}"]`).click();
      await page.locator(`[data-unsee-value="${value}"]`).waitFor({ state: 'detached' });
    }
    assert.deepEqual(current.notices, []);
    // A cold/invalidated rating must not look like a baseline-only or stale curve.
    current.ratingStatus = 'computing'; current.accounts[0].rating = null;
    await page.locator('#ct-refresh').click();
    await page.locator('#ct-rating').getByText('Rating 正在后台计算，请稍后刷新状态或榜单', { exact: true }).waitFor();
    assert.equal(await page.locator('#ct-rating-chart').count(), 0);
    assert.match(await page.locator('#ct-account').innerText(), /计算中/);
    current.ratingStatus = 'failed'; current.ratingError = 'Rating 计算失败，请稍后刷新重试';
    await page.locator('#ct-refresh').click();
    await page.locator('#ct-rating').getByText(current.ratingError, { exact: true }).waitFor();
    current.ratingStatus = 'ready'; current.accounts[0].rating = 1500;
    await page.locator('#ct-refresh').click();
    await page.waitForFunction(() => document.querySelector('#ct-rating').textContent.includes('当前 Rating'));
    assert.doesNotMatch(await page.locator('#ct-rating').innerText(), /后台计算|计算失败/);
    // A different binding of the same handle cannot keep the old chart while loading.
    holdProblems = true;
    current.accounts[0].bindingId = 'binding-2';
    currentStats = { ...stats, account: { ...account, bindingId: 'binding-2' }, solvedTotal: 0,
      rating: { bins: [], unrated: 0 }, tagDistribution: { total: 0, rows: [] } };
    await page.locator('#ct-refresh').click();
    await page.getByText('已同步记录中暂无已解决题目。', { exact: true }).waitFor();
    assert.equal(await page.locator('#ct-stats-tags-chart').count(), 0);
    current.accounts = [];
    await page.locator('#ct-refresh').click();
    await page.getByText('绑定 CF 账号并同步后显示统计。', { exact: true }).waitFor();
    await page.close();
    const coach = await browser.newPage();
    coach.on('pageerror', error => errors.push(error.message));
    const managed = dashboard(true);
    managed.jobs = [
      { kind: 'import', status: 'done', target: 'CF 比赛 1919', updatedAt: 1799990000000 },
      { kind: 'sync', status: 'failed', target: '学生 UID 7 · <img src=x onerror=alert(1)>', error: '同步失败', updatedAt: 1799990000000 },
    ];
    await coach.route('http://fixture.test/', route => route.fulfill({ contentType: 'text/html', body: template(true) }));
    await coach.route('http://fixture.test/api**', async route => {
      const args = route.request().method() === 'POST' ? route.request().postDataJSON() : Object.fromEntries(new URL(route.request().url()).searchParams);
      if (args.action === 'dashboard') return respond(route, managed);
      if (args.action === 'group_leaderboard') return respond(route, {id:args.id,rows:[]});
      assert.equal(args.action, 'delete_group');
      assert.equal(args.id, 'fixture-class');
      managed.groups = [];
      return respond(route, {});
    });
    coach.on('dialog', dialog => dialog.accept());
    managed.ratingStatus = 'failed'; managed.ratingError = 'Rating 计算失败，请稍后刷新重试';
    await coach.goto('http://fixture.test/');
    await coach.waitForFunction(() => document.querySelector('#ct-students').textContent.includes('计算失败'));
    assert.match(await coach.locator('#ct-jobs').innerText(), /历史参照榜导入.*CF 比赛 1919/);
    assert.match(await coach.locator('#ct-jobs').innerText(), /最后更新/);
    assert.match(await coach.locator('#ct-jobs').innerText(), /学生 UID 7 · <img/);
    assert.equal(await coach.locator('#ct-jobs img').count(), 0);
    assert.match(await coach.locator('#ct-ledger').innerText(), /计算失败/);
    managed.ratingStatus = 'ready';
    await coach.locator('#ct-refresh').click();
    await coach.waitForFunction(() => !document.querySelector('#ct-students').textContent.includes('计算失败'));
    await coach.locator('[data-tab="classes"]').first().click();
    await coach.locator('#ct-groups').selectOption('fixture-class');
    await coach.waitForFunction(() => !document.querySelector('#ct-delete-group').disabled);
    await coach.locator('#ct-delete-group').click();
    await coach.getByText('班级已删除', { exact: true }).waitFor();
    assert.equal(await coach.locator('#ct-groups option').count(), 1);
    assert.equal(await coach.locator('#ct-delete-group').isDisabled(), true);
    assert.equal(await coach.locator('#ct-problem-stats-card').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: template fixtures — independent loading, out-of-order filters, charts/keyboard/mobile, manual deletions, rebinding, rating computing/failure/recovery and class deletion');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
