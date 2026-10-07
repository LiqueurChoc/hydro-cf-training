'use strict';
// Runs inside the selected Linux container. No database restore is performed here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2), { mode: 0o600 });
function command(name, args) {
  return execFileSync(name, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
}
function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink()) throw new Error(`Symbolic link forbidden: ${e.name}`);
    const p = path.join(root, e.name);
    return e.isDirectory() ? files(p) : [p];
  });
}
function validate(root) {
  const required = ['package.json', 'index.js', 'lib/rating-worker.js', 'lib/rating.js',
    'lib/exposure.js', 'lib/student-response.js', 'templates/cf_training.html',
    'templates/cf_training_app.html', 'templates/cf_training_health.html', 'scripts/recovery-contract.json'];
  required.forEach(p => { if (!fs.statSync(path.join(root, p)).isFile()) throw new Error(`Missing ${p}`); });
  const all = files(root);
  for (const p of all.filter(p => /\.(?:js|cjs)$/.test(p))) command(process.execPath, ['--check', p]);
  const nunjucks = require('nunjucks');
  for (const p of all.filter(p => p.endsWith('.html'))) nunjucks.compile(fs.readFileSync(p, 'utf8'), undefined, p, true);
  // Resolve every local include, and load/render both role variants. Only Hydro's outer layout is stubbed.
  class LayoutFixture extends nunjucks.Loader {
    getSource(name) {
      return name === 'layout/basic.html' ? { src: '{% block content %}{% endblock %}', path: name, noCache: true } : null;
    }
  }
  const env = new nunjucks.Environment([new LayoutFixture(), new nunjucks.FileSystemLoader(path.join(root, 'templates'))]);
  for (const cfCoach of [false, true]) {
    const html = env.render('cf_training_health.html', {
      cfCoach, cfToken: '', cfBuild: 'validation', url: () => '/', _ : x => x,
    });
    if (typeof html !== 'string' || !html.includes('id="cf-training"') || !html.includes('cf-training-build:validation')) {
      throw new Error('Candidate template did not render the application/health marker');
    }
    for (const [, js] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new (require('node:vm').Script)(js);
  }
  const hash = crypto.createHash('sha256');
  for (const p of all.sort()) { hash.update(path.relative(root, p)); hash.update(fs.readFileSync(p)); }
  return { build: hash.digest('hex'), epoch: read(path.join(root, 'scripts/recovery-contract.json')).epoch,
    token: crypto.randomBytes(32).toString('hex') };
}
function adapter(baseUrl, timeoutMs) {
  return {
    validate,
    copy: (a, b) => fs.cpSync(a, b, { recursive: true, errorOnExist: true, force: false }),
    stop: () => command('pm2', ['stop', 'hydrooj']),
    start: () => command('pm2', ['restart', 'hydrooj']),
    async health(manifest) {
      const deadline = Date.now() + timeoutMs;
      let reason = 'not started';
      do {
        try {
          const processes = JSON.parse(command('pm2', ['jlist'])).filter(p => p.name === 'hydrooj');
          if (!processes.length || processes.some(p => p.pm2_env.status !== 'online' || !p.pid)) throw new Error('PM2 process not online');
          const url = new URL(manifest ? '/cf-training/health' : '/', baseUrl);
          const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000),
            headers: manifest ? { 'x-cf-training-probe': manifest.token } : {} });
          const body = await response.text();
          if (manifest ? (response.status !== 200 || !body.includes(`cf-training-build:${manifest.build}`)
            || !body.includes('id="cf-training"')) : ![200, 302].includes(response.status)) {
            throw new Error(`plugin/template HTTP check failed (${response.status})`);
          }
          return;
        } catch (e) { reason = e.message; }
        await new Promise(resolve => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
      throw new Error(`Health timeout: ${reason}`);
    },
  };
}
async function deploy({ home, candidate, restore, legacyMaintenance = false }, io) {
  const target = path.join(home, 'addons/cf-training');
  const backupRoot = path.join(home, 'cf-training-backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  const lock = path.join(backupRoot, 'deployment.lock');
  fs.mkdirSync(lock); // Concurrent deploys fail before any mutations; stale locks require operator inspection.
  let stage;
  try {
    if (restore) {
      if (!/^[a-zA-Z0-9-]+$/.test(restore)) throw new Error('Invalid backup ID');
      const b = path.join(backupRoot, restore), meta = read(path.join(b, 'backup.json'));
      if (!meta.compatible || !meta.hadPlugin) throw new Error('Unsafe legacy/first-install recovery: use maintenance data recovery procedure');
      const current = read(path.join(target, '.deployment.json'));
      if (current.epoch !== meta.oldManifest.epoch) throw new Error('Incompatible data epoch');
      // Restore code through the normal validated transaction; preserve all current unrelated addon entries.
      return await transaction(path.join(b, 'plugin'), meta.oldActive);
    }
    return await transaction(candidate);

    async function transaction(source, register = true) {
      const id = new Date().toISOString().replace(/[^0-9]/g, '') + '-' + crypto.randomBytes(4).toString('hex');
      const backup = path.join(backupRoot, id);
      stage = path.join(home, 'addons', `.cf-training-stage-${id}`);
      fs.mkdirSync(path.dirname(stage), { recursive: true });
      io.copy(source, stage);
      const manifest = io.validate(stage);
      if (manifest.epoch !== 1) throw new Error('Unsupported candidate recovery epoch');
      write(path.join(stage, '.deployment.json'), manifest);
      const hadPlugin = fs.existsSync(target);
      const oldManifest = hadPlugin && fs.existsSync(path.join(target, '.deployment.json'))
        ? read(path.join(target, '.deployment.json')) : null;
      const compatible = !hadPlugin || oldManifest?.epoch === manifest.epoch;
      if (!compatible && !legacyMaintenance) throw new Error('Unsafe rollback to legacy code blocked before replacement; use documented maintenance upgrade');
      const addonPath = path.join(home, 'addon.json');
      const original = fs.readFileSync(addonPath);
      const addons = JSON.parse(original);
      if (!Array.isArray(addons) || addons.some(x => typeof x !== 'string')) throw new Error('Unsupported addon.json format');
      const oldActive = hadPlugin && addons.includes(target);
      fs.mkdirSync(backup);
      fs.writeFileSync(path.join(backup, 'addon.json'), original);
      if (hadPlugin) io.copy(target, path.join(backup, 'plugin'));
      const meta = { id, hadPlugin, oldActive, compatible, oldManifest, candidate: manifest.build };
      write(path.join(backup, 'backup.json'), meta);
      const nextAddons = register ? (addons.includes(target) ? addons : [...addons, target]) : addons.filter(x => x !== target);
      const next = Buffer.from(JSON.stringify(nextAddons, null, 2));
      let replaced = false, configured = false, stopped = false;
      console.log(`Deployment backup: ${backup}`);
      try {
        stopped = true; io.stop();
        if (!fs.readFileSync(addonPath).equals(original)) throw new Error('addon.json changed concurrently');
        if (hadPlugin) fs.renameSync(target, path.join(backup, 'previous'));
        replaced = true;
        fs.renameSync(stage, target); stage = null;
        fs.writeFileSync(addonPath, next); configured = true;
        io.start();
        await io.health(register ? manifest : null);
        write(path.join(backup, 'result.json'), { status: 'installed', build: manifest.build });
        return { id, build: manifest.build, status: 'installed' };
      } catch (failure) {
        try {
          // Stop even when start returned failure: PM2 may have partially started Hydro.
          if (stopped) io.stop();
          if (configured && !fs.readFileSync(addonPath).equals(next)) throw new Error('addon.json changed concurrently; stopped for manual recovery');
          if (replaced) {
            if (fs.existsSync(target)) fs.renameSync(target, path.join(backup, 'failed-candidate'));
            if (hadPlugin) fs.renameSync(path.join(backup, 'previous'), target);
          }
          if (configured) fs.writeFileSync(addonPath, original);
          if (!compatible) throw new Error('Legacy code restored but Hydro kept stopped: data reconciliation/restore required');
          if (stopped) {
            io.start();
            await io.health(oldActive ? oldManifest : null);
          }
          write(path.join(backup, 'result.json'), { status: 'rolled-back', error: failure.message });
        } catch (recovery) {
          write(path.join(backup, 'result.json'), { status: 'recovery-failed', error: failure.message, recovery: recovery.message });
          throw new Error(`Deploy failed: ${failure.message}; recovery failed: ${recovery.message}; backup ${id}`);
        }
        throw new Error(`Deploy failed: ${failure.message}; ${oldActive ? 'old plugin' : 'base Hydro (plugin absent)'} recovered and healthy; backup ${id}`);
      }
    }
  } finally {
    if (stage) fs.rmSync(stage, { recursive: true, force: true });
    fs.rmdirSync(lock);
  }
}
module.exports = { deploy, adapter, validate, files };
if (require.main === module) {
  const [home, candidate, restore, baseUrl = 'http://127.0.0.1:8888', timeout = '60000', legacy] = process.argv.slice(2);
  const ms = Number(timeout);
  if (!home || !Number.isFinite(ms) || ms < 1000 || ms > 300000) throw new Error('Invalid deployment arguments');
  deploy({ home, candidate, restore: restore === '-' ? null : restore, legacyMaintenance: legacy === 'maintenance' }, adapter(baseUrl, ms))
    .then(result => console.log(JSON.stringify(result))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
