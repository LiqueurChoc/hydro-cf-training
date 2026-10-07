'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deploy, adapter, validate } = require('../scripts/deployment.cjs');
const { spawnSync } = require('node:child_process');
function fixture(t, fail = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cftrain-deploy-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'hydro'), candidate = path.join(root, 'candidate');
  const target = path.join(home, 'addons/cf-training');
  fs.mkdirSync(target, { recursive: true }); fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(candidate, 'new.js'), 'new');
  fs.writeFileSync(path.join(target, 'obsolete.js'), 'old');
  const old = { epoch: 1, build: 'old', token: 'old-secret' };
  fs.writeFileSync(path.join(target, '.deployment.json'), JSON.stringify(old));
  const original = JSON.stringify(['/other-addon', '/other-addon', target], null, 4);
  fs.writeFileSync(path.join(home, 'addon.json'), original);
  fs.mkdirSync(path.join(home, 'addons/other'));
  fs.writeFileSync(path.join(home, 'addons/other/untouched'), 'other');
  const calls = []; let checks = 0;
  const io = { copy(a, b) {
    if (fail === 'copy' && a === candidate) throw new Error('copy failure');
    fs.cpSync(a, b, { recursive: true });
  }, validate() { if (fail === 'validation') throw new Error('validation failure'); return { epoch: 1, build: 'new', token: 'new-secret' }; },
  stop() { calls.push('stop'); }, start() { calls.push('start'); if (fail === 'load' && calls.filter(x => x === 'start').length === 1) throw new Error('plugin load failure'); },
  async health(m) { checks++; calls.push(`health:${m?.build}`);
    if ((fail === 'timeout' && checks === 1) || fail === 'rollback') throw new Error('health timeout');
    if (fail === 'concurrent' && checks === 1) {
      fs.writeFileSync(path.join(home, 'addon.json'), JSON.stringify(['/concurrent-addon', target]));
      throw new Error('concurrent edit');
    }
  } };
  return { home, candidate, target, original, io, calls, old };
}
for (const fail of ['validation', 'copy', 'load', 'timeout', 'rollback']) test(`deployment: ${fail} preserves old code/config and reports failure`, async t => {
  const f = fixture(t, fail);
  await assert.rejects(deploy(f, f.io), fail === 'rollback' ? /recovery failed/ : /failure|timeout/);
  assert.equal(fs.readFileSync(path.join(f.target, 'obsolete.js'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(f.home, 'addon.json'), 'utf8'), f.original);
  assert.equal(fs.readFileSync(path.join(f.home, 'addons/other/untouched'), 'utf8'), 'other');
  assert.equal(fs.existsSync(path.join(f.target, 'new.js')), false);
  if (['copy', 'validation'].includes(fail)) assert.deepEqual(f.calls, []);
  else assert.ok(f.calls.includes('health:old'), 'rollback must actually recheck old plugin');
});
test('deployment: upgrade removes stale files; explicit restore preserves later unrelated addon', async t => {
  const f = fixture(t);
  const result = await deploy(f, f.io);
  assert.equal(fs.existsSync(path.join(f.target, 'obsolete.js')), false);
  assert.equal(fs.readFileSync(path.join(f.target, 'new.js'), 'utf8'), 'new');
  const list = JSON.parse(fs.readFileSync(path.join(f.home, 'addon.json'))); list.push('/later-addon');
  fs.writeFileSync(path.join(f.home, 'addon.json'), JSON.stringify(list));
  await deploy({ home: f.home, restore: result.id }, f.io);
  assert.equal(fs.readFileSync(path.join(f.target, 'obsolete.js'), 'utf8'), 'old');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'addon.json'))), list);
});
test('deployment: legacy rollback blocked before stop; maintenance failure restores files but leaves service stopped', async t => {
  const f = fixture(t, 'timeout');
  fs.unlinkSync(path.join(f.target, '.deployment.json'));
  await assert.rejects(deploy(f, f.io), /Unsafe rollback/); assert.deepEqual(f.calls, []);
  await assert.rejects(deploy({ ...f, legacyMaintenance: true }, f.io), /kept stopped/);
  assert.equal(f.calls.at(-1), 'stop');
  assert.equal(fs.readFileSync(path.join(f.target, 'obsolete.js'), 'utf8'), 'old');
});
test('deployment: concurrent addon changes are never overwritten by rollback', async t => {
  const f = fixture(t, 'concurrent');
  await assert.rejects(deploy(f, f.io), /changed concurrently/);
  assert.ok(fs.readFileSync(path.join(f.home, 'addon.json'), 'utf8').includes('/concurrent-addon'));
  assert.equal(f.calls.at(-1), 'stop');
});
test('deployment: explicit restore retains old disabled status and unrelated addon entries', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.home, 'addon.json'), '["/other-addon","/other-addon"]');
  const result = await deploy(f, f.io);
  await deploy({ home: f.home, restore: result.id }, f.io);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'addon.json'))), ['/other-addon', '/other-addon']);
  assert.equal(f.calls.at(-1), 'health:undefined');
});
test('deployment: first install failure restores addon list and checks base Hydro', async t => {
  const f = fixture(t, 'timeout'); fs.rmSync(f.target, { recursive: true });
  fs.writeFileSync(path.join(f.home, 'addon.json'), '["/other-addon"]');
  await assert.rejects(deploy(f, f.io), /base Hydro.*healthy/);
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.readFileSync(path.join(f.home, 'addon.json'), 'utf8'), '["/other-addon"]');
  assert.ok(f.calls.includes('health:undefined'));
});
test('deployment CLI: invalid candidate exits nonzero without stopping or replacing old installation', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/deployment.cjs'),
    f.home, f.candidate, '-', 'http://127.0.0.1:8888', '1000'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(path.join(f.target, 'obsolete.js'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(f.home, 'addon.json'), 'utf8'), f.original);
});
test('deployment: actual candidate static validation includes worker and templates', { skip: !process.env.CFTRAIN_DEPLOY_RUNTIME }, t => {
  const f = fixture(t);
  const candidate = path.join(path.dirname(f.home), 'real');
  fs.cpSync(path.join(__dirname, '..'), candidate, { recursive: true });
  const valid = validate(candidate); assert.match(valid.build, /^[a-f0-9]{64}$/);
  fs.appendFileSync(path.join(candidate, 'lib/rating-worker.js'), '\nsyntax error !!!');
  assert.throws(() => validate(candidate));
  fs.copyFileSync(path.join(__dirname, '../lib/rating-worker.js'), path.join(candidate, 'lib/rating-worker.js'));
  fs.appendFileSync(path.join(candidate, 'templates/cf_training_app.html'), '{% invalid_tag %}');
  assert.throws(() => validate(candidate));
});
