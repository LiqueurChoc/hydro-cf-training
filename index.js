'use strict';
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { Handler, db, PRIV, PERM, UserModel, DomainModel, ForbiddenError } = require('hydrooj');
const { TrainingService } = require('./lib/service');
const c = require('./lib/core');
const groups = require('./lib/groups');
const { ratingKey } = require('./lib/rating');
const exposure = require('./lib/exposure');
const { studentRunResponse } = require('./lib/student-response');
const { PERM_CF_TRAINING_COACH, registerCoachPermission } = require('./lib/permissions');

exports.apply = async function apply(ctx) {
  registerCoachPermission(ctx, global.Hydro.model.builtin);
  const service = new TrainingService(db);
  await service.init();
  // Deployment probe returns no user data and requires the per-install secret.
  const manifestPath = require('node:path').join(__dirname, '.deployment.json');
  const deployment = require('node:fs').existsSync(manifestPath)
    ? JSON.parse(require('node:fs').readFileSync(manifestPath, 'utf8')) : null;
  class TrainingHealth extends Handler {
    async get() {
      const token = Buffer.from(String(this.request.headers['x-cf-training-probe'] || ''));
      const expected = Buffer.from(deployment?.token || '');
      if (!deployment || token.length !== expected.length
        || !timingSafeEqual(token, expected)) throw new ForbiddenError();
      await service.states.findOne({ _id: '__cf_training_health_probe__' }, { projection: { _id: 1 } });
      this.response.template = 'cf_training_health.html';
      this.response.body = { cfCoach: false, cfToken: '', cfBuild: deployment.build };
    }
  }
  ctx.Route('cf_training_health', '/cf-training/health', TrainingHealth);
  const coach = h => h.user.hasPerm(PERM_CF_TRAINING_COACH);
  const domainAdmin = h => h.user.hasPerm(PERM.PERM_EDIT_DOMAIN);
  async function domainUser(domainId, uid) {
    const user = await UserModel.getById(domainId, uid);
    const joined = await DomainModel.getMultiUserInDomain(domainId, { uid, join: true }).limit(1).toArray();
    const domain = await DomainModel.get(domainId);
    if (!user || (!joined.length && domain?.owner !== uid)) c.fail('请选择当前域内已加入的有效用户');
    return { uid, uname: user.uname };
  }
  function managedGroup(state, groupId, actor, root) {
    const id = String(groupId || '').trim();
    const group = state.groups.find(g => g.id === id);
    if (!group || !groups.manages(group, actor, root)) c.fail('请选择你有权管理的班级');
    if (!group.uids?.length) c.fail('当前班级暂无学生');
    return group;
  }
  function text(value, max = 100) {
    const s = String(value || '').trim();
    if (!s || s.length > max) c.fail(`请输入 1—${max} 字符的内容`);
    return s;
  }
  class TrainingPage extends Handler {
    async get() {
      this.checkPriv(PRIV.PRIV_USER_PROFILE);
      if (this.args.domainId !== this.domain._id) throw new ForbiddenError();
      if (this instanceof TrainingEntry) {
        this.response.redirect = this.url(coach(this) ? 'cf_training_coach' : 'cf_training_student');
        return;
      }
      if (this instanceof TrainingCoachPage) this.checkPerm(PERM_CF_TRAINING_COACH);
      else if (coach(this)) {
        this.response.redirect = this.url('cf_training_coach');
        return;
      }
      this.session.cfTrainingCsrf ||= randomBytes(24).toString('hex');
      this.response.template = 'cf_training.html';
      this.response.body = { cfToken: this.session.cfTrainingCsrf, cfCoach: coach(this) };
    }
  }
  class TrainingEntry extends TrainingPage {}
  class TrainingCoachPage extends TrainingPage {}
  class TrainingApi extends Handler {
    async prepare() {
      this.checkPriv(PRIV.PRIV_USER_PROFILE);
      if (this.args.domainId !== this.domain._id) throw new ForbiddenError();
    }
    async get() {
      try {
        const domainId = this.args.domainId;
        let state = await service.state(domainId);
        const isCoach = coach(this);
        const uid = this.user._id;
        const op = this.args.action || 'dashboard';
        let result;
        if (op === 'dashboard') {
          const report = await service.replay(state, { wait: false });
          state = await service.state(domainId);
          if (report.version && report.version !== ratingKey(state)) c.fail('Rating 已变化，请刷新状态');
          const root = domainAdmin(this);
          result = { ratingStatus: report.status, ratingError: report.error, isCoach, isDomainAdmin: root, uid, revision: state.revision, now: Date.now(),
            accounts: state.accounts.filter(a => isCoach || a.uid === uid).map(a => ({
              uid: a.uid, handle: a.handle, bindingId: a.bindingId, approved: a.approved, verified: a.verified,
              historyComplete: a.historyComplete, scanned: a.scanned, status: a.status,
              lastSyncAt: a.lastSyncAt, error: a.error, rating: report.ratings[a.uid] ?? null,
              ratingBaseline: state.ratingBaselines?.[a.uid] || null,
            })), groups: state.groups.filter(g => groups.sees(g, uid, root) || g.transfer?.to === uid)
              .map(g => groups.view(g, uid, root)),
            notices: isCoach ? [] : state.notices.filter(n => n.uid === uid)
              .map(n => ({ key: n.key, createdAt: n.createdAt })),
            runs: state.runs.filter(r => isCoach || !['draft', 'cancelled'].includes(r.status) && r.members.some(m => m.uid === uid))
              .map(r => ({ id: r.id, title: r.title, status: r.status, startAt: r.startAt,
                durationSeconds: r.durationSeconds, rated: r.rated, checked: r.attendees.includes(uid),
                changed: r.slots.some(p => c.problemKey(p.original) !== c.problemKey(p.actual)) })),
            ledger: report.ledger.map(e => ({ runId: e.runId, title: e.title, changed: e.changed,
              endAt: e.endAt,
              changes: e.changes.filter(x => isCoach || x.uid === uid) })).filter(e => e.changes.length),
            jobs: (await service.jobs.find({ domainId, ...(!isCoach ? { kind: 'sync', 'payload.uid': uid } : {}) })
              .sort({ updatedAt: -1 }).limit(15).toArray())
              .filter(j => isCoach || j.kind === 'sync' && j.payload?.uid === uid)
              .map(j => {
                let target = '目标信息不可用';
                if (j.kind === 'catalog') target = 'CF 比赛与题库';
                else if (j.kind === 'import' && Number.isSafeInteger(j.payload?.contestId)) target = `CF 比赛 ${j.payload.contestId}`;
                else if (j.kind === 'sync' && Number.isSafeInteger(j.payload?.uid)) {
                  const account = state.accounts.find(a => a.uid === j.payload.uid && a.bindingId === j.payload.bindingId);
                  target = `学生 UID ${j.payload.uid} · ${account?.handle || '历史绑定或账号已移除'}`;
                }
                return { id: j._id, kind: j.kind, status: j.status, error: j.error, result: j.result,
                  target, updatedAt: Number.isFinite(j.updatedAt) ? j.updatedAt : null };
              }),
            catalog: await service.catalog.findOne({ _id: 'meta' }),
          };
          const ids = [...new Set([uid, ...result.accounts.map(a => a.uid),
            ...result.groups.filter(g => g.canManage).flatMap(g => [g.ownerId, g.transfer?.to, ...(g.adminIds || []), ...g.uids])].filter(Boolean))];
          result.people = (await UserModel.getMulti({ _id: { $in: ids } }, ['_id', 'uname']).toArray())
            .map(u => ({ uid: u._id, uname: u.uname }));
        } else if (op === 'group_user') {
          const allowed = s => {
            const g = s.groups.find(x => x.id === this.args.id);
            if (!g || !domainAdmin(this) && !groups.owns(g, uid)) throw new ForbiddenError();
          };
          allowed(state);
          result = await domainUser(domainId, c.integer(this.args.uid, 1, 2 ** 31 - 1, '用户 ID'));
          allowed(await service.state(domainId));
        } else if (op === 'group_leaderboard') {
          result = await service.groupLeaderboard(domainId, this.args.id, uid, domainAdmin(this));
        } else if (op === 'problem_stats') {
          result = await service.studentProblemStats(domainId, uid);
        } else if (op === 'problems') {
          result = await service.studentProblems(domainId, uid, { status: this.args.status, page: this.args.page });
        } else if (op === 'run') {
          const r = state.runs.find(x => x.id === this.args.id);
          if (!r || !isCoach && (['draft', 'cancelled'].includes(r.status) || !r.members.some(m => m.uid === uid))) throw new ForbiddenError();
          const now = Date.now();
          if (r.status === 'cancelled') result = { run: r, rows: [], absent: [], complete: false };
          else if (!isCoach && now < r.startAt) result = studentRunResponse({ run: r, rows: [] }, uid, now);
          else {
            result = await service.result(domainId, r.id);
            if (!isCoach) {
              if (['draft', 'cancelled'].includes(result.run.status) || !result.run.members.some(m => m.uid === uid)) throw new ForbiddenError();
              result = studentRunResponse(result, uid, now);
            }
          }
        } else {
          this.checkPerm(PERM_CF_TRAINING_COACH);
          if (op === 'discover') {
            const group = managedGroup(state, this.args.groupId, uid, domainAdmin(this));
            result = await service.discover(domainId, group.uids, { query: this.args.query, mode: this.args.mode,
              page: this.args.page, pageSize: this.args.pageSize });
          }
          else if (op === 'replacements') result = await service.replacements(domainId, this.args.id, this.args.index,
            c.integer(this.args.tolerance || 100, 0, 500, '难度差'));
          else if (op === 'preview') result = await service.preview(domainId, this.args.id, { wait: false });
          else if (op === 'export') {
            const report = await service.replay(state, { wait: false });
            state = await service.state(domainId);
            if (report.version && report.version !== ratingKey(state)) c.fail('Rating 已变化，请重新导出');
            if (report.status && report.status !== 'ready') c.fail(report.error || 'Rating 正在计算，请稍后重新导出');
            result = { state: { ...state, groups: state.groups.filter(g => groups.manages(g, uid, domainAdmin(this))) },
              report, exportedAt: Date.now(), version: 1 };
          } else c.fail('未知查询');
        }
        this.response.body = { ok: true, result };
      } catch (e) { if (e instanceof groups.GroupAccessDenied) throw new ForbiddenError(); if (e instanceof ForbiddenError) throw e; this.response.body = { ok: false, error: e.message }; }
    }
    async post() {
      const token = String(this.request.headers['x-cf-training-csrf'] || '');
      const expected = this.session.cfTrainingCsrf;
      if (!expected || Buffer.byteLength(token) !== Buffer.byteLength(expected)
        || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw new ForbiddenError();
      const domainId = this.args.domainId;
      const actor = this.user._id;
      const a = this.args;
      try {
        let result = {};
        if (['group', 'group_rename', 'delete_group', 'group_members', 'group_admin', 'group_claim', 'group_transfer',
          'group_transfer_cancel', 'group_transfer_accept', 'group_transfer_reject'].includes(a.action)) {
          result = await service.change(domainId, s => groups.changeGroup(s, a, {
            actor, coach: coach(this), root: domainAdmin(this), validateUser: uid => domainUser(domainId, uid),
          }));
        } else if (a.action === 'bind') await service.bind(domainId, actor, a.handle);
        else if (a.action === 'sync') {
          const uid = a.uid ? c.integer(a.uid, 1, 2 ** 31 - 1) : actor;
          if (uid !== actor) this.checkPerm(PERM_CF_TRAINING_COACH);
          await service.queueSync(domainId, uid);
        } else if (a.action === 'seen' || a.action === 'unsee') {
          const key = a.kind === 'contest' ? `contest:${c.parseContest(a.value)}` : c.problemKey(c.parseProblem(a.value));
          await service.change(domainId, s => {
            exposure.capture(s, actor);
            if (a.action === 'seen') {
              if (!s.notices.some(n => n.uid === actor && n.key === key)) s.notices.push({ uid: actor, key, createdAt: Date.now() });
            } else s.notices = s.notices.filter(n => n.uid !== actor || n.key !== key);
            exposure.capture(s, actor);
          });
        } else if (a.action === 'attend') {
          await service.change(domainId, s => {
            const run = s.runs.find(r => r.id === a.id);
            if (!run || run.status !== 'published' || !run.members.some(m => m.uid === actor)) c.fail('不在本场参赛名单中');
            if (Date.now() >= run.startAt + run.durationSeconds * 1000) c.fail('比赛已结束');
            if (!run.attendees.includes(actor)) run.attendees.push(actor);
          });
        } else {
          this.checkPerm(PERM_CF_TRAINING_COACH);
          if (a.action === 'rebind') await service.bind(domainId, c.integer(a.uid, 1, 2 ** 31 - 1), a.handle, actor);
          else if (a.action === 'correct_exposure') await service.correctExposure(domainId, a.id,
            c.integer(a.uid, 1, 2 ** 31 - 1), a.evidenceIds, text(a.reason, 500), actor);
          else if (a.action === 'approve') await service.change(domainId, s => {
            const account = s.accounts.find(x => x.uid === Number(a.uid));
            if (!account?.verified) c.fail('请先同步并验证 CF 账号存在');
            account.approved = true;
          });
          else if (a.action === 'catalog') await service.enqueue(domainId, 'catalog', {}, 'all');
          else if (a.action === 'import') await service.enqueue(domainId, 'import', { contestId: c.parseContest(a.contestId) }, String(c.parseContest(a.contestId)));
          else if (a.action === 'create') {
            const contestId = c.parseContest(a.contestId);
            const catalog = await service.catalog.findOne({ _id: `contest:${contestId}` });
            const source = catalog?.snapshot && await service.refs.findOne({ _id: catalog.snapshot });
            if (!source) c.fail('请先导入本场比赛，等待后台任务完成');
            const startAt = Date.parse(a.startAt);
            if (!Number.isFinite(startAt) || startAt <= Date.now()) c.fail('请设置未来的开赛时间');
            const id = randomUUID();
            await service.change(domainId, s => {
              if (s.runs.length >= 200) c.fail('首版单域最多保留 200 场训练，请导出归档后升级容量');
              const group = managedGroup(s, a.groupId, actor, domainAdmin(this));
              const uids = group.uids;
              const members = uids.map(uid => {
                const account = s.accounts.find(x => x.uid === uid);
                if (!account?.approved) c.fail(`学生 ${uid} 的账号尚未由教练确认`);
                return { uid, handle: account.handle, bindingId: account.bindingId, practice: false };
              });
              s.runs.push({ id, title: text(a.title), contestId, groupId: group.id, snapshot: source._id,
                startAt, durationSeconds: source.contest.durationSeconds, rules: c.rules(source.contest.type, a.rules),
                slots: source.slots, warnings: source.warnings, status: 'draft', rated: a.rated !== false,
                members, attendees: [], createdBy: actor, createdAt: Date.now() });
            });
            result = { id };
          } else if (a.action === 'replace') {
            const key = c.parseProblem(a.problem);
            const problem = await service.catalog.findOne({ _id: `problem:${c.problemKey(key)}` });
            if (!problem) c.fail('题库中未找到替换题，请先同步题库');
            await service.change(domainId, s => {
              const run = s.runs.find(r => r.id === a.id);
              if (!run || run.status !== 'draft' || Date.now() >= run.startAt) c.fail('只能在开赛前修改草稿');
              const slot = run.slots.find(p => p.index === a.index);
              if (!slot) c.fail('原题位置不存在');
              if (run.slots.some(p => p.index !== a.index && c.problemKey(p.actual) === c.problemKey(key))) c.fail('本场题目重复');
              slot.actual = problem.data;
              run.edits ||= [];
              run.edits.push({ index: a.index, key: c.problemKey(key), actor, at: Date.now() });
            });
          } else if (a.action === 'reschedule_draft') {
            const startAt = Date.parse(a.startAt);
            await service.rescheduleDraft(domainId, a.id, startAt, actor);
          } else if (a.action === 'cancel_draft') await service.cancelDraft(domainId, a.id, actor);
          else if (a.action === 'practice') await service.change(domainId, s => {
            const run = s.runs.find(r => r.id === a.id);
            if (!run || !['draft', 'published'].includes(run.status)) c.fail('只能修改草稿或未结算比赛的资格');
            const m = run.members.find(x => x.uid === Number(a.uid));
            if (!m) c.fail('学生不在名单中');
            m.practice = !!a.practice;
          });
          else if (a.action === 'publish') {
            const s = await service.state(domainId);
            const run = s.runs.find(r => r.id === a.id);
            if (!run) c.fail('训练不存在');
            if (run.status !== 'draft' || Date.now() >= run.startAt) c.fail('请在开赛前发布草稿');
            const checks = await service.screening(domainId, run.members.map(x => x.uid), run.contestId, run.slots.map(x => x.actual));
            if (run.rated && checks.some(x => x.unknown)) c.fail('计分赛发布前，所有学生须完成账号确认与最近 24 小时内的历史同步');
            await service.change(domainId, next => {
              if (next.revision !== s.revision) c.fail('配置已更新，请重试');
              const r = next.runs.find(x => x.id === a.id);
              if (r.status !== 'draft' || Date.now() >= r.startAt) c.fail('请在开赛前发布草稿');
              r.status = 'published'; r.screening = checks; r.publishedAt = Date.now();
              r.configHash = c.digest({ slots: r.slots, rules: r.rules, members: r.members, startAt: r.startAt });
            });
          } else if (a.action === 'refresh_run') {
            const run = (await service.state(domainId)).runs.find(r => r.id === a.id);
            if (!run || !['published', 'settled'].includes(run.status)) c.fail('只能同步已发布比赛');
            // Force scanning the complete contest window, including any rejudged earlier submission.
            for (const m of run.members) {
              const current = (await service.state(domainId)).accounts.find(x => x.uid === m.uid);
              if (current?.bindingId === m.bindingId) await service.queueSync(domainId, m.uid, run.startAt / 1000);
            }
          } else if (a.action === 'settle') await service.settle(domainId, a.id, a.token, actor);
          else if (a.action === 'void') await service.change(domainId, s => {
            const e = s.ledger.find(x => x.runId === a.id && !x.void);
            if (!e) c.fail('没有有效结算记录');
            e.void = true; e.voidBy = actor; e.voidAt = Date.now();
            (s.audit ||= []).push({ action: 'void', runId: a.id, actor, at: e.voidAt });
            s.runs.find(r => r.id === a.id).status = 'published';
          });
          else c.fail('未知操作');
        }
        this.response.body = { ok: true, result };
      } catch (e) {
        if (e instanceof groups.GroupAccessDenied) throw new ForbiddenError();
        if (e instanceof ForbiddenError) throw e;
        this.response.body = { ok: false, error: e.message };
      }
    }
  }
  ctx.Route('cf_training', '/cf-training', TrainingEntry, PRIV.PRIV_USER_PROFILE);
  ctx.Route('cf_training_student', '/cf-training/student', TrainingPage, PRIV.PRIV_USER_PROFILE);
  ctx.Route('cf_training_coach', '/cf-training/coach', TrainingCoachPage, PRIV.PRIV_USER_PROFILE);
  ctx.Route('cf_training_api', '/cf-training/api', TrainingApi, PRIV.PRIV_USER_PROFILE);
  ctx.injectUI('Nav', 'cf_training', { prefix: 'cf_training' }, PRIV.PRIV_USER_PROFILE);
  const timer = setInterval(() => service.tick().catch(e => console.error('[cf-training]', e.message)), 3000);
  timer.unref();
  ctx.on('dispose', () => { clearInterval(timer); service.close(); });
  global.Hydro.model.cfTraining = service;
};
