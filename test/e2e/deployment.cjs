'use strict';
// Run ONLY in an independently created Hydro container, never on the normal installation.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { deploy, adapter } = require('../../scripts/deployment.cjs');
(async () => {
  const home = '/root/.hydro', target = path.join(home, 'addons/cf-training');
  const config = JSON.parse(fs.readFileSync(path.join(home, 'config.json')));
  if (process.env.CFTRAIN_ISOLATED_DEPLOY !== '1' || !/^cftrain_test_/.test(config.name)
    || config.url || config.uri) throw new Error('Requires explicitly isolated Hydro database/container');
  const io = adapter('http://127.0.0.1:8888', 20000);
  const initial = JSON.parse(fs.readFileSync(path.join(target, '.deployment.json')));
  const originalAddons = fs.readFileSync(path.join(home, 'addon.json'));
  await io.health(initial);
  for (const headers of [{}, { 'x-cf-training-probe': 'wrong-token' }]) {
    const response = await fetch('http://127.0.0.1:8888/cf-training/health', { headers, redirect: 'manual' });
    assert.notEqual(response.status, 200);
    assert.ok(!(await response.text()).includes(`cf-training-build:${initial.build}`));
  }
  const temp = fs.mkdtempSync('/tmp/cftrain-deployment-http-');
  try {
    for (const scenario of ['load', 'template']) {
      const candidate = path.join(temp, scenario);
      fs.cpSync(target, candidate, { recursive: true });
      if (scenario === 'load') fs.appendFileSync(path.join(candidate, 'index.js'), '\nthrow new Error("T09 isolated load failure");\n');
      else {
        const file = path.join(candidate, 'templates/cf_training_health.html');
        const original = fs.readFileSync(file, 'utf8');
        // Valid during static fixture rendering, broken only for a real deployed build.
        fs.writeFileSync(file, '{% if cfBuild != "validation" %}T09 isolated missing template marker{% else %}' + original + '{% endif %}');
      }
      await assert.rejects(deploy({ home, candidate }, io), /old plugin recovered and healthy/);
      assert.deepEqual(fs.readFileSync(path.join(home, 'addon.json')), originalAddons);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, '.deployment.json'))), initial);
      await io.health(initial);
      console.log(`PASS real Hydro ${scenario} failure and healthy rollback`);
    }
    const candidate = path.join(temp, 'success'); fs.cpSync(target, candidate, { recursive: true });
    fs.appendFileSync(path.join(candidate, 'README.md'), '\nT09 isolated upgrade fixture.\n');
    fs.writeFileSync(path.join(target, 'obsolete-t09.txt'), 'obsolete');
    const result = await deploy({ home, candidate }, io);
    assert.equal(fs.existsSync(path.join(target, 'obsolete-t09.txt')), false);
    await deploy({ home, restore: result.id }, io);
    assert.equal(fs.readFileSync(path.join(target, 'obsolete-t09.txt'), 'utf8'), 'obsolete');
    fs.unlinkSync(path.join(target, 'obsolete-t09.txt'));
    console.log('PASS real Hydro upgrade and explicit restore');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
