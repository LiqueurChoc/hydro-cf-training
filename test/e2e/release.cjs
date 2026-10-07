'use strict';
// Real Hydro HTTP, synthetic students/upstream; requires the dedicated isolated container.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const cfg = JSON.parse(fs.readFileSync(process.env.CFTRAIN_E2E_CONFIG || '.test-output/release-session.json', 'utf8'));
const base = process.env.CFTRAIN_E2E_URL || 'http://127.0.0.1:18888';
if (process.env.CFTRAIN_ISOLATED_RELEASE !== '1' || !/^cftrain-e2e-[a-f0-9]+$/.test(cfg.domain)) throw new Error('Explicit isolated release test required');
const docker = args => execFileSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '-e', 'docker', ...args], { encoding: 'utf8', timeout: 60000 });
const checks = [];
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const probe = await browser.newContext();
    let online = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await probe.request.get(base + '/login')).status() === 200) { online = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(online, 'Isolated Hydro must be online');
    async function fixture(action, value) {
      const response = await probe.request.post(base + '/t10-fixture', {
        headers: { 'x-t10-fixture': cfg.password }, data: { action, value },
      });
      assert.equal(response.status(), 200);
      assert.equal((await response.json()).done, action);
    }
    await fixture('reset');
    const pages = {}, errors = [];
    for (const [role, user] of Object.entries(cfg.users)) {
      const context = await browser.newContext();
      const response = await context.request.post(base + '/login', { form: { uname: user.uname, password: cfg.password, rememberme: 'false' }, maxRedirects: 0 });
      assert.ok([200, 302, 303].includes(response.status()));
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${base}/d/${cfg.domain}/cf-training`);
      await page.locator('#cf-training').waitFor();
      pages[role] = page;
    }
    const { root, coach, otherCoach, student, delegate, outsider } = pages;
    async function api(page, action, args = {}, post = false, csrf = true) {
      return page.evaluate(async ({ action, args, post, csrf }) => {
        const element = document.querySelector('#cf-training'), url = new URL(element.dataset.api, location.origin);
        if (!post) for (const [k, v] of Object.entries({ action, ...args })) url.searchParams.set(k, v);
        const response = await fetch(url, post ? { method: 'POST', headers: { 'Content-Type': 'application/json',
          ...(csrf ? { 'x-cf-training-csrf': element.dataset.token } : {}) }, body: JSON.stringify({ action, ...args }) } : {});
        return { status: response.status, body: await response.json().catch(() => null) };
      }, { action, args, post, csrf });
    }
    async function ok(page, action, args = {}, post = false) {
      const response = await api(page, action, args, post);
      assert.equal(response.body?.ok, true, `${action}: ${JSON.stringify(response)}`); return response.body.result;
    }
    async function ready(page, action = 'dashboard', args = {}) {
      for (let i = 0; i < 150; i++) {
        const response = await api(page, action, args);
        if (response.body?.error === '档案已变化，请重新预览') { await page.waitForTimeout(200); continue; }
        assert.equal(response.body?.ok, true, JSON.stringify(response));
        const result = response.body.result;
        assert.notEqual(result.ratingStatus, 'failed', result.ratingError);
        if (result.ratingStatus === 'ready' && (action !== 'preview' || result.token && result.complete)) return result;
        await page.waitForTimeout(200);
      }
      assert.fail('Timed out: ' + action);
    }
    const forbidden = async (page, action, args = {}, post = false) => assert.equal((await api(page, action, args, post)).status, 403, action);
    const uid = cfg.users.student.uid, duid = cfg.users.delegate.uid;
    assert.equal((await ok(student, 'dashboard')).isCoach, false);
    assert.equal((await ok(coach, 'dashboard')).isCoach, true);
    await forbidden(student, 'export'); await forbidden(student, 'catalog', {}, true);
    await forbidden(coach, 'dashboard', { domainId: cfg.otherDomain });
    assert.equal((await api(coach, 'catalog', {}, true, false)).status, 403);
    const groupA = (await ok(coach, 'group', { name: 'AUTOMATED A', uids: [uid, duid] }, true)).id;
    const groupB = (await ok(coach, 'group', { name: 'AUTOMATED B', uids: [duid] }, true)).id;
    assert.equal((await api(otherCoach, 'discover', { groupId: groupA, mode: 'all' })).body.ok, false);
    await ok(coach, 'group_admin', { id: groupA, uid: duid, mode: 'add' }, true);
    let delegated = (await ok(delegate, 'dashboard')).groups.find(g => g.id === groupA);
    assert.equal(delegated.canManage, true); assert.equal(delegated.canOwn, false);
    await ok(delegate, 'group_rename', { id: groupA, version: delegated.version, name: 'AUTOMATED delegated' }, true);
    await forbidden(delegate, 'delete_group', { id: groupA }, true);
    await forbidden(delegate, 'create', {}, true);
    await ok(root, 'group_claim', { id: groupB, uid: cfg.users.otherCoach.uid }, true);
    assert.equal((await api(coach, 'discover', { groupId: groupB })).body.ok, false);
    await ok(root, 'group_claim', { id: groupB, uid: cfg.users.coach.uid }, true);
    // Actual browser selection triggers real HTTP. Race ordering is separately covered by discovery.cjs.
    await coach.reload(); await coach.getByRole('button', { name: '选赛与组赛', exact: true }).click();
    const selector = coach.locator('#ct-contest-group');
    await selector.selectOption(groupA);
    await coach.locator('#ct-discover select[name=mode]').selectOption('all');
    await coach.locator('#ct-discover input[name=query]').fill('99001');
    await coach.getByRole('button', { name: '搜索 / 筛选', exact: true }).click();
    await coach.locator('#ct-candidates').getByText('AUTOMATED TEST FIXTURE', { exact: false }).first().waitFor();
    await selector.selectOption(groupB);
    assert.equal(await coach.locator('#ct-candidates').getByText('AUTOMATED TEST FIXTURE', { exact: false }).count(), 0);
    await ok(coach, 'discover', { groupId: groupB, mode: 'all', query: '99001' });
    checks.push('roles, ownership, delegated student, domain administrator, cross-domain injection, CSRF, class switch');
    const future = () => new Date(Date.now() + 3600000).toISOString();
    const draft = (await ok(coach, 'create', { groupId: groupA, contestId: 99001, title: 'AUTOMATED TEST training', startAt: future(), rated: true }, true)).id;
    await forbidden(student, 'run', { id: draft });
    await ok(coach, 'reschedule_draft', { id: draft, startAt: future() }, true);
    await ok(coach, 'replace', { id: draft, index: 'A', problem: '99002/A' }, true);
    await ok(student, 'seen', { kind: 'problem', value: '99002/A' }, true);
    await ok(coach, 'publish', { id: draft }, true);
    await ok(student, 'unsee', { kind: 'problem', value: '99002/A' }, true);
    const hidden = await ok(student, 'run', { id: draft, uid: duid });
    assert.equal(hidden.hidden, true); assert.equal(hidden.run.slots, undefined);
    await forbidden(outsider, 'run', { id: draft });
    assert.equal((await student.request.get(`${base}/d/${cfg.otherDomain}/cf-training/api?action=run&id=${draft}`)).status(), 403);
    await ok(student, 'attend', { id: draft }, true); await ok(delegate, 'attend', { id: draft }, true);
    await fixture('advance', draft);
    await ok(coach, 'refresh_run', { id: draft }, true);
    let pre = await ready(coach, 'preview', { id: draft });
    const exposed = (await ok(coach, 'run', { id: draft })).rows.find(r => r.uid === uid);
    assert.equal(exposed.eligible, false);
    const ids = exposed.history.evidence.map(e => e.id);
    assert.ok(ids.length);
    await forbidden(delegate, 'correct_exposure', { id: draft, uid, evidenceIds: ids, reason: 'test' }, true);
    await ok(coach, 'correct_exposure', { id: draft, uid, evidenceIds: ids, reason: 'AUTOMATED false report correction' }, true);
    assert.equal((await api(coach, 'settle', { id: draft, token: pre.token }, true)).body.ok, false);
    pre = await ready(coach, 'preview', { id: draft }); assert.equal(pre.changes.length, 2);
    function privacy(result) {
      assert.deepEqual(Object.keys(result).sort(), ['absent', 'hidden', 'rows', 'run']);
      for (const key of ['screening', 'members', 'bindingId', 'edits', 'snapshot', 'scanProofs', 'exposureEvidence', 'exposureCorrections']) {
        assert.equal(JSON.stringify(result).includes('"' + key + '"'), false, key);
      }
      for (const row of result.rows) if (row.uid !== uid) {
        assert.equal(row.reason, undefined); assert.equal(row.completionIssues, undefined);
      }
    }
    privacy(await ok(student, 'run', { id: draft }));
    await ok(coach, 'settle', { id: draft, token: pre.token }, true);
    assert.equal((await api(coach, 'settle', { id: draft, token: pre.token }, true)).body.ok, false);
    privacy(await ok(student, 'run', { id: draft }));
    assert.equal((await ready(student)).ledger.length, 1);
    const stats = await ok(student, 'problem_stats'); assert.equal(stats.solvedTotal, 1);
    await student.screenshot({ path: '.test-output/t10-student.png', fullPage: true });
    await ok(coach, 'void', { id: draft }, true);
    await fixture('rejudge', 'WRONG_ANSWER');
    await ok(coach, 'refresh_run', { id: draft }, true);
    pre = await ready(coach, 'preview', { id: draft });
    assert.equal((await ok(coach, 'run', { id: draft })).rows[0].points, 0);
    await ok(coach, 'settle', { id: draft, token: pre.token }, true);
    assert.equal((await ready(student)).ledger.length, 1);
    checks.push('create/reschedule/replace/publish/secrecy/signup, queued full sync, evidence retention/correction, raw JSON privacy, settlement/idempotency/void/rejudge');
    const cancelled = (await ok(coach, 'create', { groupId: groupA, contestId: 99001, title: 'AUTOMATED cancellation', startAt: future() }, true)).id;
    assert.equal((await api(coach, 'rebind', { uid, handle: 'fixture_changed' }, true)).body.ok, false);
    await ok(coach, 'cancel_draft', { id: cancelled }, true); await ok(coach, 'cancel_draft', { id: cancelled }, true);
    await forbidden(student, 'run', { id: cancelled });
    assert.equal((await ok(coach, 'run', { id: cancelled })).run.status, 'cancelled');
    await ok(coach, 'rebind', { uid, handle: 'fixture_changed' }, true);
    const after = await ready(student); assert.equal(after.ledger.length, 1);
    assert.equal((await ok(student, 'problem_stats')).solvedTotal, 0);
    const exported = await ok(coach, 'export'); assert.ok(exported.state.runs.some(r => r.id === cancelled));
    await ok(coach, 'group_admin', { id: groupA, uid: duid, mode: 'remove' }, true);
    await forbidden(delegate, 'group_rename', { id: groupA, name: 'denied', version: 0 }, true);
    await fixture('revoke');
    await forbidden(coach, 'export'); await forbidden(coach, 'cancel_draft', { id: cancelled }, true);
    assert.equal((await coach.reload()).status(), 403);
    await coach.goto(`${base}/d/${cfg.domain}/cf-training`); assert.match(coach.url(), /\/student$/);
    checks.push('cancel/idempotency/archive, binding lock/rebind/statistics, delegated and coach revocation');
    // Multiple HTTP sessions after actual PM2 restart exercise cache reconstruction.
    const syncStarted = Date.now();
    await ok(root, 'refresh_run', { id: draft }, true);
    docker(['exec', '-e', 'CFTRAIN_ISOLATED_RELEASE=1', 'cftrain-t10-hydro', 'pm2', 'restart', 'hydrooj', '--update-env']);
    for (let i = 0; i < 100; i++) {
      try { if ((await root.request.get(base + '/login')).status() === 200) break; } catch {}
      await root.waitForTimeout(200);
    }
    const start = performance.now();
    const responses = await Promise.all(Array.from({ length: 30 }, (_, i) => api(i % 2 ? student : delegate, 'dashboard')));
    assert.ok(responses.every(r => r.body?.ok));
    const recovered = await ready(student); assert.equal(recovered.ledger.length, 1);
    let synced = false;
    for (let i = 0; i < 150; i++) {
      const account = (await ok(delegate, 'dashboard')).accounts[0];
      if (account.status === 'ready' && account.lastSyncAt >= syncStarted) { synced = true; break; }
      await delegate.waitForTimeout(200);
    }
    assert.ok(synced, 'Persisted full-window sync completes after restart');
    checks.push('real process restart, persisted sync, 30 concurrent HTTP reads, rating rebuild');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, fixture: 'synthetic students, clock advance and CF responses; real Hydro HTTP/Mongo/PM2', checks, concurrentReadsMs: performance.now() - start }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
