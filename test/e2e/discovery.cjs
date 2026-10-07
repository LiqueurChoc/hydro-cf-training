'use strict';
// Real coach template with constructed classes and controlled discover responses.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { template } = require('./ui.cjs');

const result = (name, page = 1) => ({
  rows: [{ id: page, name, durationSeconds: 7200, type: 'CF', problems: [], unknown: 0, attended: 0, touched: 0, conflicts: [] }],
  total: 2, page, pages: 2, pageSize: 20,
});
const reply = (route, value) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [], alerts = [], discoveries = [], creates = [];
  let groups = [
    { id: 'a', name: 'A 班', uids: [2], ownerId: 7, adminIds: [], canManage: true, canOwn: true, member: false, version: 1 },
    { id: 'b', name: 'B 班', uids: [3], ownerId: 7, adminIds: [], canManage: true, canOwn: true, member: false, version: 1 },
  ];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { alerts.push(d.message()); await d.accept(); });
    await page.route('http://discovery.test/', route => route.fulfill({ contentType: 'text/html', body: template(true) }));
    await page.route('http://discovery.test/api**', route => {
      const req = route.request();
      const args = req.method() === 'POST' ? req.postDataJSON() : Object.fromEntries(new URL(req.url()).searchParams);
      if (args.action === 'dashboard') return reply(route, { ok: true, result: {
        isCoach: true, uid: 7, accounts: [], people: [], notices: [], runs: [], ledger: [], jobs: [], groups: structuredClone(groups),
      } });
      if (args.action === 'group_leaderboard') return reply(route, { ok: true, result: { rows: [] } });
      if (args.action === 'discover') { discoveries.push({ args, route }); return; }
      if (args.action === 'create') {
        creates.push(args);
        return reply(route, { ok: false, error: 'fixture create stopped before persistence' });
      }
      throw new Error(`Unexpected action ${args.action}`);
    });
    const search = async query => {
      await page.locator('#ct-discover [name=query]').fill(query);
      await page.locator('#ct-discover button:not([type])').click();
    };
    // Route callbacks are delivered asynchronously; poll the fixture queue before replying.
    const queued = async count => {
      for (let i = 0; i < 100 && discoveries.length < count; i++) await page.waitForTimeout(10);
      assert.equal(discoveries.length, count);
      return discoveries[count - 1];
    };
    await page.goto('http://discovery.test/');
    await page.locator('[data-tab=select]').click();
    assert.equal(await page.locator('#ct-contest-group').inputValue(), 'a');

    await search('first');
    await reply((await queued(1)).route, { ok: true, result: result('A result') });
    await page.getByText('A result').waitFor();
    await page.locator('#ct-contest-group').selectOption('b');
    assert.doesNotMatch(await page.locator('#ct-candidates').innerText(), /A result/);
    assert.equal(await page.locator('#ct-pagination button').count(), 0);
    await search('second');
    await queued(2);
    assert.match(await page.locator('#ct-candidates').innerText(), /正在筛选/);
    assert.doesNotMatch(await page.locator('#ct-candidates').innerText(), /A result/);
    await reply((await queued(2)).route, { ok: true, result: result('B result') });
    await page.getByText('B result').waitFor();
    await page.locator('[data-page="2"]').click();
    const page2 = await queued(3);
    assert.equal(page2.args.groupId, 'b');
    assert.equal(page2.args.query, 'second');
    assert.equal(page2.args.page, '2');
    await reply(page2.route, { ok: true, result: result('B page 2', 2) });
    await page.getByText('B page 2').waitFor();
    await page.setViewportSize({ width: 375, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.locator('#ct-create [name=title]').fill('Fixture run');
    await page.locator('#ct-create [name=contestId]').fill('1234');
    await page.locator('#ct-create [name=startAt]').fill('2027-01-01T12:00');
    await page.locator('#ct-create button').click();
    for (let i = 0; i < 100 && !creates.length; i++) await page.waitForTimeout(10);
    assert.equal(creates[0].groupId, 'b');
    for (let i = 0; i < 100 && !alerts.length; i++) await page.waitForTimeout(10);
    assert.deepEqual(alerts, ['fixture create stopped before persistence']);
    alerts.length = 0;

    await page.locator('#ct-contest-group').selectOption('a');
    await search('slow-a');
    const slowA = await queued(4);
    await page.locator('#ct-contest-group').selectOption('b');
    await search('fast-b');
    await reply((await queued(5)).route, { ok: true, result: result('New B') });
    await page.getByText('New B').waitFor();
    await reply(slowA.route, { ok: true, result: result('Stale A') });
    assert.doesNotMatch(await page.locator('#ct-candidates').innerText(), /Stale A/);

    await search('old-error');
    const oldError = await queued(6);
    await search('new-success');
    await reply((await queued(7)).route, { ok: true, result: result('Latest success') });
    await page.getByText('Latest success').waitFor();
    await reply(oldError.route, { ok: false, error: 'stale failure' });
    assert.match(await page.locator('#ct-candidates').innerText(), /Latest success/);
    assert.deepEqual(alerts, []);

    await page.locator('[data-page="2"]').click();
    const oldPage = await queued(8);
    await search('new-query');
    await reply((await queued(9)).route, { ok: true, result: result('New query') });
    await page.getByText('New query').waitFor();
    await reply(oldPage.route, { ok: true, result: result('Stale page', 2) });
    assert.doesNotMatch(await page.locator('#ct-candidates').innerText(), /Stale page/);

    await search('current-error');
    await reply((await queued(10)).route, { ok: false, error: 'current failure' });
    await page.getByText(/筛选失败：current failure/).waitFor();
    assert.equal(await page.locator('#ct-pagination button').count(), 0);

    groups[1].uids = [3, 4];
    await page.locator('#ct-refresh').click();
    await page.getByText(/名单.*重新搜索/).waitFor();
    assert.equal(await page.locator('#ct-pagination button').count(), 0);
    await search('after roster');
    await reply((await queued(11)).route, { ok: true, result: result('Before revoke') });
    await page.getByText('Before revoke').waitFor();
    groups[1].canManage = false;
    await page.locator('#ct-refresh').click();
    await page.waitForFunction(() => document.querySelector('#ct-contest-group').value === 'a');
    assert.equal(await page.locator('#ct-contest-group').inputValue(), 'a');
    assert.doesNotMatch(await page.locator('#ct-candidates').innerText(), /Before revoke/);
    await page.getByText(/重新搜索/).waitFor();

    groups[1].canManage = true;
    await page.locator('#ct-refresh').click();
    await page.waitForFunction(() => !!document.querySelector('#ct-contest-group option[value="b"]'));
    await page.locator('#ct-contest-group').selectOption('b');
    await search('before delete');
    await reply((await queued(12)).route, { ok: true, result: result('Before delete') });
    await page.getByText('Before delete').waitFor();
    groups = [groups[0]];
    await page.locator('#ct-refresh').click();
    await page.waitForFunction(() => document.querySelector('#ct-contest-group').value === 'a');
    assert.equal(await page.locator('#ct-contest-group').inputValue(), 'a');
    assert.doesNotMatch(await page.locator('#ct-candidates').innerText(), /Before delete/);
    await page.getByText(/重新搜索/).waitFor();
    groups = [];
    await page.locator('#ct-refresh').click();
    await page.waitForFunction(() => document.querySelector('#ct-contest-group').value === '');
    assert.equal(await page.locator('#ct-contest-group').inputValue(), '');
    await page.getByText(/暂无可管理的班级/).waitFor();
    await search('no class');
    assert.equal(discoveries.length, 12, 'no discover request without a manageable class');
    await page.locator('#ct-create button').click();
    for (let i = 0; i < 100 && !alerts.length; i++) await page.waitForTimeout(10);
    assert.deepEqual(alerts, ['请先选择有权管理的参赛班级']);
    assert.equal(creates.length, 1, 'no create request without a manageable class');
    assert.deepEqual(errors, []);
    console.log('PASS: class-bound discovery, stale success/error/page isolation, refresh invalidation, create class and mobile layout');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
