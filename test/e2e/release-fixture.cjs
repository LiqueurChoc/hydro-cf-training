'use strict';
// Explicit test-only addon/CLI. Never enabled by the candidate itself.
const fs = require('node:fs');
const session = '/tmp/cf-training-release.json';
async function reset(service, cfg, DomainModel) {
  await service.states.deleteOne({ _id: cfg.domain });
  await service.records.deleteMany({}); // Guard requires a dedicated disposable database.
  await service.jobs.deleteMany({});
  await service.change(cfg.domain, s => {
    s.ratingBaselines = {};
    for (const role of ['student', 'delegate']) {
      const uid = cfg.users[role].uid;
      s.accounts.push({ uid, handle: 'fixture_' + role, bindingId: 't10-' + role, approved: true, verified: true,
        historyComplete: true, status: 'ready', lastSyncAt: Date.now(), ratingHistory: [] });
      s.ratingBaselines[uid] = { rating: 1600, source: 'cf', handle: 'fixture_' + role, at: Date.now() };
    }
  });
  await DomainModel.setUserRole(cfg.domain, cfg.users.coach.uid, 'coach', true);
  delete cfg.activeRun; delete cfg.verdict;
  fs.writeFileSync(session, JSON.stringify(cfg), { mode: 0o600 });
}
function guard() {
  const config = JSON.parse(fs.readFileSync('/root/.hydro/config.json'));
  if (config.name !== 'cftrain_test_t10_hydro_isolated' || config.url || config.uri
    || process.env.CFTRAIN_ISOLATED_RELEASE !== '1') throw new Error('Requires isolated T10 container/database');
}
exports.apply = async ctx => {
  guard();
  for (let i = 0; i < 200 && !global.Hydro.model.cfTraining; i++) await new Promise(r => setTimeout(r, 50));
  const service = global.Hydro.model.cfTraining;
  if (!service) throw new Error('Load fixture AFTER candidate');
  service.client = { call: async (method, params) => {
    const cfg = JSON.parse(fs.readFileSync(session));
    if (method === 'user.info') return [{ handle: params.handles, rating: 1600 }];
    if (method === 'user.rating') return [];
    if (method !== 'user.status') throw new Error('Unexpected synthetic API method ' + method);
    const state = await service.state(cfg.domain);
    const run = state.runs.find(r => r.id === cfg.activeRun);
    if (!run || params.from > 1 || params.handle === 'fixture_changed') return [];
    return [{ id: 101, contestId: run.slots[0].actual.contestId,
      creationTimeSeconds: Math.floor(run.startAt / 1000) + 2,
      problem: run.slots[0].actual, verdict: cfg.verdict || 'OK',
      author: { members: [{ handle: params.handle }], participantType: 'PRACTICE' } }];
  } };
  const { Handler, ForbiddenError } = require('hydrooj');
  class FixtureControl extends Handler {
    async post() {
      const cfg = JSON.parse(fs.readFileSync(session));
      if (this.request.headers['x-t10-fixture'] !== cfg.password) throw new ForbiddenError();
      this.response.body = await exports.command(this.args.action, this.args.value);
    }
  }
  ctx.Route('t10_fixture', '/t10-fixture', FixtureControl);
};
exports.command = async (action, value) => {
  guard();
  const { UserModel, DomainModel, db } = require('hydrooj');
  const service = new (require('../../lib/service').TrainingService)(db);
  await service.init();
  const { PERM_CF_TRAINING_COACH } = require('../../lib/permissions');
  if (action === 'bootstrap') {
    if (fs.existsSync(session)) throw new Error('Fixture already exists');
    const suffix = require('node:crypto').randomBytes(5).toString('hex');
    const cfg = { domain: 'cftrain-e2e-' + suffix, password: require('node:crypto').randomBytes(24).toString('hex'), users: {} };
    for (const role of ['root', 'coach', 'otherCoach', 'student', 'delegate', 'outsider']) {
      const uname = role.toLowerCase() + suffix;
      cfg.users[role] = { uname, uid: await UserModel.create(uname + '@example.invalid', uname, cfg.password) };
    }
    await DomainModel.add(cfg.domain, cfg.users.root.uid, 'AUTOMATED TEST FIXTURE', 'Isolated T10');
    const normal = (await DomainModel.getRoles(cfg.domain)).find(r => r._id === 'default').perm;
    await DomainModel.addRole(cfg.domain, 'coach', normal | PERM_CF_TRAINING_COACH);
    for (const [role, user] of Object.entries(cfg.users)) if (role !== 'root') {
      await DomainModel.setUserRole(cfg.domain, user.uid, role.includes('Coach') || role === 'coach' ? 'coach' : 'default', true);
    }
    const otherDomain = cfg.domain + '-other';
    await DomainModel.add(otherDomain, cfg.users.root.uid, 'AUTOMATED TEST other domain', 'T10');
    await DomainModel.setUserRole(otherDomain, cfg.users.student.uid, 'default', true);
    cfg.otherDomain = otherDomain;
    fs.writeFileSync(session, JSON.stringify(cfg), { mode: 0o600 });
    const original = { contestId: 99001, index: 'A', name: 'AUTOMATED TEST FIXTURE', rating: 800, points: 500 };
    const slots = [{ index: 'A', original, actual: original, points: 500 }];
    const contest = { id: 99001, name: 'AUTOMATED TEST FIXTURE', type: 'CF', phase: 'FINISHED', durationSeconds: 30 };
    await service.refs.insertMany([{ _id: 't10-reference', contest, slots, warnings: ['Synthetic fixture'], contestId: 99001 },
      { _id: 't10-reference:0', snapshot: 't10-reference', rows: [{ points: 500, penalty: 0, rating: 1800 }, { points: 100, penalty: 0, rating: 1400 }] }]);
    await service.catalog.insertMany([{ _id: 'contest:99001', kind: 'contest', data: contest, problems: [original], snapshot: 't10-reference' },
      { _id: 'problem:99001/A', kind: 'problem', data: original }, { _id: 'problem:99002/A', kind: 'problem', data: { ...original, contestId: 99002 } }]);
    await reset(service, cfg, DomainModel);
    return { ready: true, domain: cfg.domain };
  }
  const cfg = JSON.parse(fs.readFileSync(session));
  if (action === 'reset') await reset(service, cfg, DomainModel);
  else if (action === 'advance') {
    // Simulated passage of time, not a real student training session.
    await service.change(cfg.domain, s => {
      const run = s.runs.find(r => r.id === value);
      if (!run || run.status !== 'published') throw new Error('Not published');
      run.startAt = Date.now() - 60000;
    });
    cfg.activeRun = value;
    fs.writeFileSync(session, JSON.stringify(cfg), { mode: 0o600 });
  } else if (action === 'rejudge') {
    cfg.verdict = value;
    fs.writeFileSync(session, JSON.stringify(cfg), { mode: 0o600 });
  } else if (action === 'revoke') {
    await DomainModel.setUserRole(cfg.domain, cfg.users.coach.uid, 'default', true);
  } else throw new Error('Unknown fixture action');
  return { done: action };
};
