'use strict';
const { randomUUID } = require('node:crypto');
const { CodeforcesClient } = require('./cf');
const c = require('./core');
const { aggregateProblemHistory, problemHistory, cleanTags, validRating } = require('./history');
const groups = require('./groups');
const { RatingCache, ratingKey } = require('./rating');
const exposure = require('./exposure');

function coversRun(proof, bindingId, run, voidAt = 0) {
  return proof?.bindingId === bindingId && Number.isSafeInteger(proof.generation)
    && Number.isSafeInteger(proof.startedAt) && proof.startedAt >= Math.max(run.startAt + run.durationSeconds * 1000, voidAt)
    && Number.isFinite(proof.coveredSince) && proof.coveredSince <= run.startAt / 1000
    && Number.isSafeInteger(proof.completedAt) && proof.completedAt >= proof.startedAt;
}

function retainScanProofs(proofs, runs, ledger, bindingId) {
  const latest = proofs.at(-1);
  const kept = new Map([[latest.generation, latest]]);
  for (const run of runs) {
    if (run.status !== 'published' || !run.members.some(m => m.bindingId === bindingId)) continue;
    const voidAt = Math.max(0, ...ledger.filter(e => e.runId === run.id && e.void).map(e => e.voidAt || 0));
    const proof = proofs.findLast(p => coversRun(p, bindingId, run, voidAt ? voidAt + 1 : 0));
    if (proof) kept.set(proof.generation, proof);
  }
  return [...kept.values()].sort((a, b) => a.generation - b.generation);
}

class TrainingService {
  constructor(db, options = {}) {
    this.states = db.collection('cftrain_state');
    this.records = db.collection('cftrain_submission');
    this.catalog = db.collection('cftrain_catalog');
    this.refs = db.collection('cftrain_reference');
    this.jobs = db.collection('cftrain_job');
    this.locks = db.collection('cftrain_lock');
    this.client = options.client || new CodeforcesClient();
    this.instance = randomUUID();
    this.running = false;
    this.nextScheduleAt = 0;
    this.engines = new Map();
    this.ratingCache = new RatingCache(options.ratingCache);
  }
  async init() {
    await this.records.createIndex({ account: 1, 'data.creationTimeSeconds': 1 });
    await this.jobs.createIndex({ status: 1, nextAt: 1 });
    await this.catalog.createIndex({ kind: 1 });
    for (const state of await this.states.find({}).toArray()) {
      // Existing settlements must retain their original starting point, including revoked ones.
      if (state.ledger.some(e => e.inputs.some(row => !state.ratingBaselines?.[row.uid]))) await this.change(state._id, s => {
        s.ratingBaselines ||= {};
        for (const event of s.ledger) for (const row of event.inputs) {
          s.ratingBaselines[row.uid] ||= { rating: 1400, source: 'legacy', at: Date.now() };
        }
      });
      const updated = await this.state(state._id);
      for (const a of updated.accounts) {
        const job = await this.jobs.findOne({ _id: `${state._id}:sync:${a.bindingId}` });
        if (!updated.ratingBaselines?.[a.uid] || (job && !a.syncRequest?.generation)
          || (a.cycle && !job) || (a.status === 'queued'
            && (!job || job.payload?.generation !== a.syncRequest?.generation
              || !['queued', 'running'].includes(job.status)))) {
          await this.queueSync(state._id, a.uid, a.syncRequest?.since ?? null);
        }
      }
    }
  }
  async state(domainId) {
    return await this.states.findOne({ _id: domainId }) || { _id: domainId, revision: 0,
      accounts: [], groups: [], runs: [], notices: [], ledger: [] };
  }
  async change(domainId, apply) {
    for (let i = 0; i < 8; i++) {
      const state = await this.state(domainId);
      const revision = state.revision;
      const result = await apply(state);
      state.revision++;
      if (Buffer.byteLength(JSON.stringify(state)) > 12_000_000) c.fail('训练档案已接近存储上限，请先导出归档');
      try {
        if (revision === 0) await this.states.insertOne(state);
        else if (!(await this.states.replaceOne({ _id: domainId, revision }, state)).matchedCount) continue;
        return result;
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    c.fail('有人同时修改了训练配置，请刷新后重试');
  }
  async enqueue(domainId, kind, payload, key = randomUUID()) {
    const id = `${domainId}:${kind}:${key}`;
    await this.jobs.updateOne({ _id: id, status: { $nin: ['queued', 'running'] } }, { $set: {
      domainId, kind, payload, status: 'queued', nextAt: 0, error: '', updatedAt: Date.now(),
    } }, { upsert: true }).catch(e => { if (e.code !== 11000) throw e; });
    return id;
  }
  async bind(domainId, uid, value, coachActor = null) {
    const h = c.handle(value);
    await this.change(domainId, s => {
      if (s.accounts.some(a => a.uid !== uid && a.handle.toLowerCase() === h.toLowerCase())) c.fail('该 CF 账号已被其他学生绑定');
      const old = s.accounts.find(a => a.uid === uid);
      if (old && coachActor === null) c.fail('CF 账号只能绑定一次，如需更换请联系教练');
      if (!old && coachActor !== null) c.fail('该学生尚未绑定 CF 账号');
      if (old && old.handle.toLowerCase() === h.toLowerCase()) return;
      if (s.runs.some(r => ['draft', 'published'].includes(r.status) && r.members.some(m => m.uid === uid))) c.fail('有草稿或尚未结算的比赛，暂不能更换账号');
      const account = { uid, handle: h, approved: false, verified: false, historyComplete: false,
        cursor: 1, scanned: 0, lastSyncAt: 0, bindingId: randomUUID(), status: 'queued', ratingHistory: [] };
      s.accounts = s.accounts.filter(a => a.uid !== uid).concat(account);
      if (old) (s.audit ||= []).push({ action: 'rebind', uid, actor: coachActor,
        oldHandle: old.handle, handle: h, at: Date.now() });
    });
    await this.queueSync(domainId, uid);
  }
  async cancelDraft(domainId, runId, actor) {
    const alreadyCancelled = new Error('already cancelled');
    try {
      await this.change(domainId, s => {
        const run = s.runs.find(r => r.id === runId);
        if (!run) c.fail('训练不存在');
        if (run.status === 'cancelled') throw alreadyCancelled;
        if (run.status !== 'draft') c.fail('只能取消草稿');
        run.status = 'cancelled';
        run.cancelledBy = actor;
        run.cancelledAt = Date.now();
        (s.audit ||= []).push({ action: 'cancel_draft', runId, actor, at: run.cancelledAt });
      });
    } catch (e) { if (e !== alreadyCancelled) throw e; }
  }
  async rescheduleDraft(domainId, runId, startAt, actor) {
    if (!Number.isSafeInteger(startAt) || startAt <= Date.now()) c.fail('请设置未来的开赛时间');
    await this.change(domainId, s => {
      const run = s.runs.find(r => r.id === runId);
      if (!run || run.status !== 'draft') c.fail('只能修改草稿开赛时间');
      if (startAt <= Date.now()) c.fail('请设置未来的开赛时间');
      const previousStartAt = run.startAt;
      run.startAt = startAt;
      delete run.screening;
      delete run.configHash;
      delete run.publishedAt;
      (s.audit ||= []).push({ action: 'reschedule_draft', runId, actor, at: Date.now(), previousStartAt, startAt });
    });
  }
  async queueSync(domainId, uid, since = null, { onlyIfReady = false } = {}) {
    let request;
    await this.change(domainId, s => {
      request = null;
      const a = s.accounts.find(x => x.uid === uid);
      if (!a) c.fail('尚未绑定 CF 账号');
      // The scheduler's read can race with a manual request. Recheck in the CAS
      // so automatic refresh never restarts an already queued/paginating scan.
      if (onlyIfReady && (a.status !== 'ready' || a.cycle)) return;
      const normalSince = a.historyComplete ? Math.max(0, (a.lastSyncAt || 0) / 1000 - 86400) : 0;
      const wanted = since === null ? normalSince : Math.max(0, since);
      // Any status but 'ready' means the persisted request (or an in-flight cycle) has not
      // completed: a failed full-window refresh must keep its range through plain retries,
      // or a later narrow scan would resurrect stale pre-rejudge proofs for settlement.
      request = { uid, bindingId: a.bindingId, generation: (a.syncGeneration || 0) + 1,
        since: Math.min(wanted, a.status === 'ready' ? wanted : (a.syncRequest?.since ?? wanted),
          a.cycle?.since ?? wanted),
        requestedAt: Date.now() };
      a.syncGeneration = request.generation;
      a.syncRequest = request;
      a.syncAttempt = 0;
      a.status = 'queued';
      a.error = '';
    });
    if (!request) return null;
    const id = `${domainId}:sync:${request.bindingId}`;
    await this.jobs.updateOne({ _id: id, $or: [
      { 'payload.generation': { $lt: request.generation } },
      { 'payload.generation': { $exists: false } },
    ] }, { $set: { domainId, kind: 'sync', payload: request,
      status: 'queued', nextAt: 0, error: '', updatedAt: Date.now() } }, { upsert: true })
      .catch(e => { if (e.code !== 11000) throw e; });
    return id;
  }
  async allRecords(bindingId) {
    return (await this.records.find({ account: bindingId }).toArray()).map(r => r.data);
  }
  async studentProblems(domainId, uid, options = {}) {
    const account = (await this.state(domainId)).accounts.find(a => a.uid === uid);
    if (!account) return problemHistory([], options);
    const result = problemHistory(await this.allRecords(account.bindingId), options);
    const current = (await this.state(domainId)).accounts.find(a => a.uid === uid);
    if (!current || current.bindingId !== account.bindingId) c.fail('读取题目期间账号已更换，请刷新后重试');
    return result;
  }
  async studentProblemStats(domainId, uid) {
    const empty = { account: null, catalogSyncedAt: null, solvedTotal: 0,
      rating: { bins: [], unrated: 0 }, tagDistribution: { total: 0, rows: [] } };
    const initial = await this.state(domainId);
    const account = initial.accounts.find(a => a.uid === uid);
    if (!account) return empty;

    const rows = aggregateProblemHistory(await this.allRecords(account.bindingId)).filter(row => row.ac > 0);
    const catalogById = new Map();
    const ids = rows.map(row => `problem:${row.key}`);
    for (let i = 0; i < ids.length; i += 500) {
      const found = await this.catalog.find({ _id: { $in: ids.slice(i, i + 500) } }).toArray();
      for (const item of found) catalogById.set(item._id, item.data || {});
    }
    const problems = rows.map(row => {
      const stored = catalogById.get(`problem:${row.key}`) || {};
      const catalogRating = validRating(stored.rating);
      const catalogTags = cleanTags(stored.tags);
      return { rating: catalogRating ?? row.rating, tags: catalogTags.length ? catalogTags : row.tags };
    });
    const rating = c.ratingHistogram(problems);
    const tagDistribution = c.tagPie(problems);

    const catalogMeta = await this.catalog.findOne({ _id: 'meta' });
    const latest = await this.state(domainId);
    const current = latest.accounts.find(a => a.uid === uid);
    if (!current || current.bindingId !== account.bindingId) c.fail('统计期间账号已更换，请刷新后重试');
    const syncedAt = catalogMeta?.syncedAt;
    return {
      account: { handle: account.handle, bindingId: account.bindingId,
        historyComplete: !!account.historyComplete,
        status: ['queued', 'syncing', 'ready', 'failed'].includes(account.status) ? account.status : 'queued',
        lastSyncAt: Number.isSafeInteger(account.lastSyncAt) && account.lastSyncAt > 0 ? account.lastSyncAt : null },
      catalogSyncedAt: Number.isSafeInteger(syncedAt) && syncedAt > 0 ? syncedAt : null,
      solvedTotal: problems.length,
      rating: { bins: rating.bins, unrated: rating.unrated },
      tagDistribution,
    };
  }
  async groupLeaderboard(domainId, id, actor, root = false) {
    const initial = await this.state(domainId);
    const group = initial.groups.find(g => g.id === id);
    if (!group || !groups.sees(group, actor, root)) throw new groups.GroupAccessDenied();
    const accounts = initial.accounts.filter(a => group.uids.includes(a.uid));
    const solved = new Map(accounts.map(a => [a.bindingId, new Set()]));
    // One indexed query, streaming only AC identifiers; no full histories or catalog lookups per pupil.
    const cursor = this.records.find({ account: { $in: accounts.map(a => a.bindingId) }, 'data.verdict': 'OK' },
      { projection: { account: 1, 'data.contestId': 1, 'data.problem.contestId': 1, 'data.problem.index': 1 } });
    for await (const record of cursor) {
      const sub = record.data, contestId = sub.problem?.contestId ?? sub.contestId, index = sub.problem?.index;
      if (Number.isSafeInteger(contestId) && contestId > 0 && typeof index === 'string'
        && /^[A-Za-z][A-Za-z0-9]*$/.test(index)) solved.get(record.account)?.add(`${contestId}/${index.toUpperCase()}`);
    }
    const scoring = await this.state(domainId);
    const report = await this.replay(scoring, { wait: false });
    const latest = await this.state(domainId), current = latest.groups.find(g => g.id === id);
    if (!current || !groups.sees(current, actor, root)) throw new groups.GroupAccessDenied();
    if (JSON.stringify(current) !== JSON.stringify(group)
      || accounts.some(a => latest.accounts.find(x => x.uid === a.uid)?.bindingId !== a.bindingId)) {
      c.fail('班级或账号已变更，请刷新榜单');
    }
    if (ratingKey(latest) !== ratingKey(scoring)) c.fail('Rating 已变化，请刷新榜单');
    const rows = current.uids.map(uid => {
      const a = latest.accounts.find(x => x.uid === uid);
      return { uid, handle: a?.handle || '', rating: report.ratings[uid] ?? null,
        solvedTotal: a ? solved.get(a.bindingId)?.size ?? 0 : null,
        historyComplete: !!a?.historyComplete, status: a?.status || 'unbound', lastSyncAt: a?.lastSyncAt || null };
    }).sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity) || a.uid - b.uid);
    let rank = null;
    rows.forEach((row, i) => {
      if (row.rating !== null && (!i || row.rating !== rows[i - 1].rating)) rank = i + 1;
      row.rank = row.rating === null ? null : rank;
    });
    return { id: current.id, name: current.name, rows, ratingStatus: report.status, ratingError: report.error };
  }
  async syncPage(domainId, payload) {
    const state = await this.state(domainId);
    const account = state.accounts.find(a => a.bindingId === payload.bindingId);
    if (!account) return true;
    const generation = payload.generation ?? account.syncRequest?.generation ?? 0;
    const attempt = payload.attempt ?? 0;
    if (account.syncGeneration && generation !== account.syncGeneration) return false;
    if ((account.syncAttempt || 0) > attempt) return false;
    const cycle = account.cycle?.generation === generation ? account.cycle : {
      generation, cursor: 1,
      startedAt: Date.now(), since: payload.since ?? account.syncRequest?.since
        ?? (account.historyComplete ? Math.max(0, account.lastSyncAt / 1000 - 86400) : 0) };
    // Publish the sync-in-progress state before changing submission records.
    // A settlement CAS then cannot commit a mixture of old and new submission pages.
    await this.change(domainId, s => {
      const a = s.accounts.find(x => x.bindingId === payload.bindingId);
      if (a && (!a.syncGeneration || a.syncGeneration === generation)
        && (a.syncAttempt || 0) <= attempt) {
        a.status = 'syncing';
        a.syncAttempt = attempt;
      }
    });
    const patch = {};
    let baseline;
    if (!account.verified || !state.ratingBaselines?.[account.uid]) {
      const users = await this.client.call('user.info', { handles: account.handle });
      if (!users?.[0]?.handle) c.fail('CF 返回的用户信息不完整');
      patch.handle = users[0].handle; patch.verified = true;
      const unrated = users[0].rating == null;
      baseline = { rating: unrated ? 1400 : c.integer(users[0].rating, -10000, 10000, 'CF rating'),
        source: unrated ? 'unrated-default' : 'cf', handle: users[0].handle, at: Date.now() };
    }
    if (!account.cycle || account.cycle.generation !== generation) {
      patch.ratingHistory = await this.client.call('user.rating', { handle: patch.handle || account.handle });
    }
    const page = await this.client.call('user.status', { handle: patch.handle || account.handle, from: cycle.cursor, count: 500 });
    if (!Array.isArray(page)) c.fail('CF 返回的提交数据格式不正确');
    if (page.some((sub, i) => !Number.isSafeInteger(sub.creationTimeSeconds)
      || (i && sub.creationTimeSeconds > page[i - 1].creationTimeSeconds))) {
      c.fail('CF 返回的提交时间顺序不正确');
    }
    const current = (await this.state(domainId)).accounts.find(a => a.bindingId === payload.bindingId);
    if (!current || (current.syncGeneration && current.syncGeneration !== generation)
      || (current.syncAttempt || 0) !== attempt) return false;
    const mayWrite = { $or: [
      { $lt: [{ $ifNull: ['$syncGeneration', -1] }, generation] },
      { $and: [
        { $eq: [{ $ifNull: ['$syncGeneration', -1] }, generation] },
        { $lte: [{ $ifNull: ['$syncAttempt', -1] }, attempt] },
      ] },
    ] };
    if (page.length) await this.records.bulkWrite(page.map(sub => ({ updateOne: {
      filter: { _id: `${account.bindingId}:${sub.id}` },
      update: [{ $set: {
        account: account.bindingId,
        data: { $cond: [mayWrite, { $literal: sub }, '$data'] },
        syncGeneration: { $cond: [mayWrite, generation, '$syncGeneration'] },
        syncAttempt: { $cond: [mayWrite, attempt, '$syncAttempt'] },
      } }], upsert: true,
    } })));
    const done = page.length < 500 || (cycle.since > 0 && page.at(-1).creationTimeSeconds < cycle.since);
    await this.change(domainId, s => {
      const a = s.accounts.find(x => x.bindingId === account.bindingId);
      if (!a || (a.syncGeneration && a.syncGeneration !== generation)
        || (a.syncAttempt || 0) !== attempt) return;
      s.ratingBaselines ||= {};
      if (baseline && !s.ratingBaselines[a.uid]) s.ratingBaselines[a.uid] = baseline;
      Object.assign(a, patch, { error: '', status: done ? 'ready' : 'syncing',
        scanned: (a.scanned || 0) + page.length,
        cursor: done ? 1 : cycle.cursor + Math.max(1, page.length - 25),
        cycle: done ? null : { ...cycle, cursor: cycle.cursor + Math.max(1, page.length - 25) } });
      exposure.capture(s, a.uid, page);
      if (done) {
        a.historyComplete = true;
        a.lastSyncAt = cycle.startedAt;
        const proof = { bindingId: a.bindingId, generation, attempt, startedAt: cycle.startedAt,
          completedAt: Date.now(), coveredSince: page.length < 500 ? 0 : page.at(-1).creationTimeSeconds,
          reachedEnd: page.length < 500 };
        a.scanProofs = retainScanProofs([...(a.scanProofs || []).filter(p => p.bindingId === a.bindingId), proof],
          s.runs, s.ledger, a.bindingId);
      }
    });
    return done;
  }
  async importContest(contestId) {
    const data = await this.client.call('contest.standings', { contestId });
    if (data.contest.phase !== 'FINISHED') c.fail('只能导入已结束的比赛');
    c.rules(data.contest.type);
    const changes = await this.client.call('contest.ratingChanges', { contestId });
    const ratings = new Map(changes.map(r => [r.handle.toLowerCase(), r]));
    const reference = data.rows.filter(r => r.party.members.length === 1
      && ratings.has(r.party.members[0].handle.toLowerCase()))
      .map(r => ({ handle: r.party.members[0].handle, points: r.points, penalty: r.penalty || 0,
        rating: ratings.get(r.party.members[0].handle.toLowerCase()).oldRating }));
    if (reference.length < 2) c.fail('缺少可用历史评分参照，暂不能导入为模拟计分赛');
    const slots = [];
    for (const p of data.problems) {
      const stored = await this.catalog.findOne({ _id: `problem:${c.problemKey(p)}` });
      const original = { ...(stored?.data || {}), ...p, rating: p.rating ?? stored?.data.rating };
      if (data.contest.type === 'CF' && !(p.points > 0)) c.fail(`原题 ${p.index} 缺少基础分，无法还原计分`);
      slots.push({ index: p.index, original, actual: original, points: p.points || 1 });
    }
    const id = randomUUID();
    for (let i = 0; i < reference.length; i += 1000) await this.refs.insertOne({
      _id: `${id}:${i / 1000}`, snapshot: id, rows: reference.slice(i, i + 1000),
    });
    const meta = { _id: id, contestId, contest: data.contest, slots,
      referenceCount: reference.length, ratedCount: changes.length, importedAt: Date.now(),
      warnings: ['使用公开榜单及显示的历史评分；未恢复新账号内部评分，结果为模拟估计。',
        ...(reference.length !== changes.length ? ['公开榜单与 rated 名单不完全重合，仅使用两者交集作为参照。'] : [])] };
    await this.refs.insertOne(meta);
    await this.catalog.updateOne({ _id: `contest:${contestId}` }, { $set: {
      kind: 'contest', data: data.contest, problems: slots.map(s => s.original), snapshot: id,
    } }, { upsert: true });
    return meta;
  }
  async syncCatalog() {
    const contests = await this.client.call('contest.list');
    const data = await this.client.call('problemset.problems');
    const problemsByContest = new Map();
    for (const p of data.problems) {
      if (!p.contestId || p.contestId >= 100000) continue;
      if (!problemsByContest.has(p.contestId)) problemsByContest.set(p.contestId, []);
      problemsByContest.get(p.contestId).push(p);
    }
    const writes = [];
    for (const p of data.problems.filter(p => p.contestId && p.contestId < 100000)) writes.push({ updateOne: {
      filter: { _id: `problem:${c.problemKey(p)}` }, update: { $set: { kind: 'problem', data: p } }, upsert: true } });
    for (const contest of contests.filter(x => x.phase === 'FINISHED' && x.id < 100000 && ['CF', 'ICPC'].includes(x.type))) writes.push({ updateOne: {
      filter: { _id: `contest:${contest.id}` }, update: { $set: { kind: 'contest', data: contest,
        problems: problemsByContest.get(contest.id) || [] } }, upsert: true } });
    for (let i = 0; i < writes.length; i += 500) await this.catalog.bulkWrite(writes.slice(i, i + 500));
    await this.catalog.updateOne({ _id: 'meta' }, { $set: { syncedAt: Date.now() } }, { upsert: true });
  }
  async reference(id) {
    if (!this.engines.has(id)) {
      const meta = await this.refs.findOne({ _id: id });
      if (!meta) c.fail('参照快照不存在');
      const chunks = await this.refs.find({ snapshot: id }).toArray();
      this.engines.set(id, c.referenceEngine(chunks.flatMap(x => x.rows), meta.contest.type));
      if (this.engines.size > 6) this.engines.delete(this.engines.keys().next().value);
    }
    return this.engines.get(id);
  }
  async screening(domainId, uids, contestId, problems, at = Date.now()) {
    const s = await this.state(domainId);
    const rows = [];
    for (const uid of uids) {
      const a = s.accounts.find(x => x.uid === uid);
      const records = a ? await this.allRecords(a.bindingId) : [];
      rows.push({ uid, handle: a?.handle || '', ...c.exposure(a, records,
        s.notices.filter(n => n.uid === uid), contestId, problems, at),
      evidence: exposure.collect(a, records, s.notices.filter(n => n.uid === uid), contestId, problems, at) });
    }
    return rows;
  }
  async discover(domainId, uids, filters = {}) {
    const requestedPage = c.integer(filters.page ?? 1, 1, 1000000, '页码');
    const pageSize = c.integer(filters.pageSize ?? 20, 1, 100, '每页数量');
    const query = String(filters.query || '').trim().toLowerCase();
    const s = await this.state(domainId);
    const histories = new Map(), at = Date.now();
    for (const uid of uids) {
      const a = s.accounts.find(x => x.uid === uid);
      histories.set(uid, c.prepareExposure(a, a ? await this.allRecords(a.bindingId) : [],
        s.notices.filter(n => n.uid === uid), at));
    }
    const rows = await this.catalog.find({ kind: 'contest' }).toArray();
    const results = rows.filter(row => row.problems?.length && (!query
      || `${row.data.id} ${row.data.name}`.toLowerCase().includes(query)))
      .map(row => {
        const conflicts = uids.map(uid => ({ uid, ...c.exposureFromIndex(histories.get(uid), row.data.id, row.problems) }));
        const unknown = conflicts.filter(x => x.unknown).length;
        const attended = conflicts.filter(x => x.attended).length;
        const touched = new Set(conflicts.flatMap(x => x.touched));
        return { id: row.data.id, name: row.data.name, durationSeconds: row.data.durationSeconds,
          type: row.data.type, problems: row.problems, snapshot: row.snapshot,
          unknown, attended, touched: touched.size, conflicts };
      }).filter(row => filters.mode !== 'clear' || (!row.unknown && !row.attended && !row.touched))
      .sort((a, b) => a.unknown - b.unknown || a.attended - b.attended || a.touched - b.touched || b.id - a.id);
    const total = results.length, pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pages);
    return { rows: results.slice((page - 1) * pageSize, page * pageSize), total, page, pages, pageSize };
  }
  async replacements(domainId, runId, index, tolerance = 100) {
    const s = await this.state(domainId);
    const run = s.runs.find(r => r.id === runId);
    if (!run || run.status !== 'draft') c.fail('只能为草稿查找替换题');
    const slot = run?.slots.find(p => p.index === index);
    if (!slot) c.fail('题目位置不存在');
    if (!slot.original.rating) c.fail('原题没有难度，请手工选择替换题');
    const used = new Set(run.slots.map(p => c.problemKey(p.actual)));
    const all = await this.catalog.find({ kind: 'problem', 'data.rating': {
      $gte: slot.original.rating - tolerance, $lte: slot.original.rating + tolerance } }).toArray();
    const seen = new Set(s.notices.filter(n => run.members.some(m => m.uid === n.uid)).map(n => n.key));
    let unknown = false;
    for (const m of run.members) {
      const a = s.accounts.find(x => x.uid === m.uid);
      if (!a?.historyComplete || !a?.approved || a.status === 'failed' || Date.now() - (a.lastSyncAt || 0) > 86400_000) unknown = true;
      if (a) {
        for (const r of a.ratingHistory || []) seen.add(`contest:${r.contestId}`);
        for (const sub of await this.allRecords(a.bindingId)) {
          seen.add(c.problemKey(sub.problem));
          if (['CONTESTANT', 'VIRTUAL', 'OUT_OF_COMPETITION'].includes(sub.author?.participantType)) seen.add(`contest:${sub.contestId}`);
        }
      }
    }
    return { unknown, problems: all.map(p => p.data).filter(p => !used.has(c.problemKey(p))
      && !seen.has(c.problemKey(p)) && !seen.has(`contest:${p.contestId}`)).slice(0, 60) };
  }
  async result(domainId, runId) {
    const s = await this.state(domainId);
    const run = s.runs.find(r => r.id === runId);
    if (!run) c.fail('训练不存在');
    if (run.status === 'cancelled') c.fail('已取消草稿不能计算榜单');
    const settled = run.status === 'settled' && s.ledger.find(e => e.runId === runId && !e.void);
    if (settled?.scoreSnapshot) return { run, rows: settled.scoreSnapshot, absent: [], complete: true };
    const voidAt = Math.max(0, ...s.ledger.filter(e => e.runId === runId && e.void).map(e => e.voidAt || 0));
    const pendingJobs = await this.jobs.find({ domainId, kind: 'sync', status: { $in: ['queued', 'running'] } }).toArray();
    const rows = [];
    for (const member of run.members) {
      const a = s.accounts.find(x => x.uid === member.uid);
      const records = await this.allRecords(member.bindingId);
      const history = exposure.history(run, member.uid, a?.bindingId === member.bindingId ? a : null,
        records, s.notices.filter(n => n.uid === member.uid));
      const checked = run.attendees.includes(member.uid);
      const score = c.scoreRun(run, records, member);
      const proof = a?.scanProofs?.findLast(p => coversRun(p, member.bindingId, run, voidAt ? voidAt + 1 : 0)) || null;
      const completionIssues = [];
      if (a?.bindingId !== member.bindingId) completionIssues.push('参赛账号已更换');
      else {
        if (!s.ratingBaselines?.[member.uid] || !a.historyComplete) completionIssues.push('账号历史或初始 Rating 尚未同步完整');
        if (a.status === 'failed') completionIssues.push('同步失败，请重新同步本场');
        else if (a.status !== 'ready' || a.cycle
          || pendingJobs.some(j => j.payload.bindingId === member.bindingId)) completionIssues.push('本场同步仍在队列或扫描中');
        if (!proof) completionIssues.push('缺少赛后启动且覆盖开赛时间的完整扫描，请同步本场所有学生');
      }
      if (score.pending) completionIssues.push('仍有提交待评测');
      const complete = completionIssues.length === 0;
      const eligible = run.rated && checked && !history.unknown && !history.attended && !history.touched.length && !member.practice;
      rows.push({ ...score, history, checked, complete, completionIssues, scanProof: proof, eligible,
        reason: !checked ? '未签到' : member.practice ? '教练设为练习'
          : history.unknown ? '历史信息未核实' : history.attended || history.touched.length ? '已有接触记录' : '' });
    }
    return { run, rows: c.rankRows(rows.filter(r => r.checked), run.rules.type), absent: rows.filter(r => !r.checked),
      complete: rows.filter(r => r.checked).every(r => r.complete) };
  }
  close() { this.ratingCache.close(); }
  async correctExposure(domainId, runId, uid, evidenceIds, reason, actor) {
    reason = String(reason || '').trim();
    if (!reason || reason.length > 500) c.fail('请填写 1—500 字符的纠正理由');
    if (!Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.some(id => typeof id !== 'string')) c.fail('请选择要纠正的证据');
    const before = await this.state(domainId);
    if (before.runs.find(r => r.id === runId)?.status !== 'published') c.fail('仅可纠正已发布训练；已结算比赛请先撤销结算');
    const result = await this.result(domainId, runId);
    const row = [...result.rows, ...result.absent].find(x => x.uid === uid);
    const ids = [...new Set(evidenceIds)].sort();
    if (!row || ids.some(id => !row.history?.evidence.some(e => e.id === id))) c.fail('证据已变化，请刷新后重新选择');
    await this.change(domainId, s => {
      if (s.revision !== before.revision) c.fail('档案已变化，请刷新后重试');
      const run = s.runs.find(r => r.id === runId);
      if (run.status !== 'published') c.fail('仅可纠正已发布训练；已结算比赛请先撤销结算');
      exposure.retain(run, uid, row.history.evidence);
      const correction = { id: randomUUID(), uid, actor, at: Date.now(), reason, evidenceIds: ids };
      (run.exposureCorrections ||= []).push(correction);
      (s.audit ||= []).push({ action: 'correct_exposure', runId, ...correction });
    });
  }
  async replay(s, options = {}) {
    const report = await this.ratingCache.read(s, async id => {
      const meta = await this.refs.findOne({ _id: id });
      if (!meta) c.fail('参照快照不存在');
      const chunks = await this.refs.find({ snapshot: id }).toArray();
      return { type: meta.contest.type, rows: chunks.flatMap(x => x.rows) };
    }, options);
    if (report.status !== 'ready') return { ...report, ratings: {}, ledger: [] };
    const events = new Map(s.ledger.filter(e => !e.void).map(e => [e.runId, e]));
    return { ...report, ratings: { ...report.ratings },
      ledger: report.ledger.map(e => ({ ...events.get(e.runId), changes: e.changes.map(row => ({ ...row })) })) };
  }
  async preview(domainId, runId, options = {}) {
    const before = await this.state(domainId);
    const status = before.runs?.find(r => r.id === runId)?.status;
    if (status === 'settled') c.fail('本场已结算，不能重复加分');
    if (status === 'draft' || status === 'cancelled') c.fail('只有已发布比赛可以预览结算');
    const result = await this.result(domainId, runId);
    const s = await this.state(domainId);
    if (before.revision !== s.revision) c.fail('档案已变化，请重新预览');
    s.ledger = s.ledger.filter(e => e.runId !== runId);
    const inputs = result.rows.filter(r => r.eligible).map(({ uid, handle, points, penalty }) => ({ uid, handle, points, penalty }));
    const event = { runId, snapshot: result.run.snapshot, endAt: result.run.startAt + result.run.durationSeconds * 1000,
      inputs, title: result.run.title, changed: result.run.slots.some(x => c.problemKey(x.actual) !== c.problemKey(x.original)),
      algorithm: c.VERSION, void: false };
    s.ledger.push(event);
    const replay = await this.replay(s, options);
    if ((await this.state(domainId)).revision !== s.revision) c.fail('档案已变化，请重新预览');
    if (replay.status !== 'ready') return { ...result, ratingStatus: replay.status, ratingError: replay.error, changes: [], token: null, event, revision: s.revision };
    const changes = replay.ledger.find(x => x.runId === runId)?.changes || [];
    return { ...result, ratingStatus: 'ready', changes, event, token: c.digest({ event, rows: result.rows, revision: s.revision }), revision: s.revision };
  }
  async settle(domainId, runId, token, actor) {
    const preview = await this.preview(domainId, runId);
    if (preview.run.status === 'settled') c.fail('本场已结算，不能重复加分');
    if (Date.now() < preview.event.endAt) c.fail('比赛尚未结束');
    if (!preview.complete) c.fail(preview.rows.find(r => r.checked && !r.complete)?.completionIssues[0]
      || '仍有提交待评测或赛后同步未完成');
    if (preview.token !== token) c.fail('预览已变化，请重新预览');
    await this.change(domainId, s => {
      if (s.revision !== preview.revision) c.fail('档案已变化，请重新预览');
      const run = s.runs.find(r => r.id === runId);
      if (run.status !== 'published') c.fail('只有已发布比赛可以结算');
      s.ledger = s.ledger.filter(e => e.runId !== runId);
      s.ledger.push({ ...preview.event, actor, settledAt: Date.now(),
        scoreSnapshot: preview.rows });
      (s.audit ||= []).push({ action: 'settle', runId, actor, at: Date.now(), token });
      run.status = 'settled';
    });
  }
  async scheduleDueSyncs(now) {
    if (now < this.nextScheduleAt) return;
    const pending = new Set((await this.jobs.find({ kind: 'sync', status: { $in: ['queued', 'running'] } }).toArray())
      .map(job => job._id));
    for (const state of await this.states.find({}).toArray()) {
      for (const account of state.accounts) {
        if (account.status !== 'ready' || account.cycle
          || pending.has(`${state._id}:sync:${account.bindingId}`)) continue;
        const active = state.runs.some(r => r.status === 'published' && r.members.some(m => m.uid === account.uid)
          && now >= r.startAt - 600000 && now <= r.startAt + r.durationSeconds * 1000 + 3600000);
        if (now - (account.lastSyncAt || 0) > (active ? 60000 : 6 * 3600_000)) {
          await this.queueSync(state._id, account.uid, null, { onlyIfReady: true });
        }
      }
    }
    this.nextScheduleAt = now + 15000;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    const now = Date.now();
    let heartbeat;
    try {
      // One worker across Hydro processes; prevents per-process CF rate limits multiplying.
      let lock;
      try {
        lock = await this.locks.findOneAndUpdate({ _id: 'worker', $or: [{ until: { $lt: now } }, { owner: this.instance }] },
          { $set: { owner: this.instance, until: now + 120000 } }, { upsert: true, returnDocument: 'after' });
      } catch (e) { if (e.code === 11000) return; throw e; }
      if (!lock || lock.owner !== this.instance) return;
      heartbeat = setInterval(() => this.locks.updateOne({ _id: 'worker', owner: this.instance },
        { $set: { until: Date.now() + 120000 } }).catch(() => {}), 20000);
      await this.jobs.updateMany({ status: 'running', updatedAt: { $lt: now - 180000 } },
        { $set: { status: 'queued' }, $unset: { lease: '' } });
      // Due accounts must enter the queue even while other histories have more pages.
      await this.scheduleDueSyncs(now);
      const lease = randomUUID();
      const job = await this.jobs.findOneAndUpdate({ status: 'queued', nextAt: { $lte: now } },
        { $set: { status: 'running', lease, updatedAt: now }, $inc: { attempt: 1 } },
        { sort: { updatedAt: 1 }, returnDocument: 'after' });
      if (job) {
        try {
          let done = true, result;
          if (job.kind === 'sync') done = await this.syncPage(job.domainId,
            { ...job.payload, attempt: job.attempt });
          else if (job.kind === 'catalog') await this.syncCatalog();
          else if (job.kind === 'import') result = (await this.importContest(job.payload.contestId))._id;
          await this.jobs.updateOne({ _id: job._id, status: 'running', lease },
            { $set: { status: done ? 'done' : 'queued', result,
              error: '', updatedAt: Date.now(), nextAt: Date.now() + 2100 }, $unset: { lease: '' } });
        } catch (e) {
          const failed = await this.jobs.updateOne({ _id: job._id, status: 'running', lease },
            { $set: { status: 'failed', error: e.message, updatedAt: Date.now() }, $unset: { lease: '' } });
          if (job.kind === 'sync') await this.change(job.domainId, s => {
            const a = s.accounts.find(x => x.bindingId === job.payload.bindingId);
            if (failed.matchedCount && a && a.syncGeneration === job.payload.generation
              && a.syncAttempt === job.attempt) {
              a.status = 'failed'; a.error = e.message;
            }
          });
        }
      }
    } finally {
      clearInterval(heartbeat);
      // Keep a quiet interval between workers, including process changes.
      await this.locks.updateOne({ _id: 'worker', owner: this.instance }, { $set: { until: Date.now() + 2200, owner: '' } }).catch(() => {});
      this.running = false;
    }
  }
}
module.exports = { TrainingService };
