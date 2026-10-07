'use strict';
const { Worker } = require('node:worker_threads');
const c = require('./core');

// Content-address the authoritative state snapshot, not its general revision. Reference
// IDs identify immutable imports. No separately-written invalidation flag can be lost.
function ratingInput(state) {
  return { format: 1, algorithm: c.VERSION,
    baselines: Object.entries(state.ratingBaselines || {}).sort(([a], [b]) => Number(a) - Number(b))
      .map(([uid, b]) => [Number(uid), b.rating]),
    events: (state.ledger || []).filter(e => !e.void)
      .sort((a, b) => a.endAt - b.endAt || a.runId.localeCompare(b.runId))
      .map(e => ({ runId: e.runId, snapshot: e.snapshot, endAt: e.endAt, algorithm: e.algorithm || c.VERSION,
        inputs: e.inputs.map(({ uid, handle, points, penalty }) => ({ uid, handle, points, penalty })) })) };
}
function ratingKey(state) { return c.digest(ratingInput(state)); }

// Original replay order and scoring function, also used by the independent baseline test.
async function replayOriginal(input, reference) {
  const ratings = new Map(input.baselines), ledger = [];
  for (const event of input.events) {
    if (event.algorithm !== c.VERSION) c.fail(`不支持的 Rating 算法版本：${event.algorithm}`);
    const engine = await reference(event.snapshot), changes = [];
    for (const row of event.inputs) {
      const rating = engine(row, ratings.get(row.uid) ?? 1400);
      ratings.set(row.uid, rating.newRating);
      changes.push({ uid: row.uid, handle: row.handle, ...rating });
    }
    ledger.push({ runId: event.runId, changes });
  }
  return { ratings: Object.fromEntries(ratings), ledger };
}

class RatingCache {
  constructor({ maxTasks = 8, maxEntries = 16, maxBytes = 32 * 1024 * 1024,
    timeoutMs = 30 * 60_000, workerFile = require.resolve('./rating-worker') } = {}) {
    Object.assign(this, { maxTasks, maxEntries, maxBytes, timeoutMs, workerFile });
    this.entries = new Map(); this.tasks = new Map(); this.queue = [];
    this.bytes = 0; this.active = null; this.closed = false; this.starts = 0;
  }
  remember(key, entry) {
    entry.bytes = Buffer.byteLength(JSON.stringify(entry));
    if (entry.bytes > this.maxBytes) throw new Error('Rating 结果超出缓存容量，请联系管理员归档');
    this.entries.set(key, entry); this.bytes += entry.bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const first = this.entries.keys().next().value;
      this.bytes -= this.entries.get(first).bytes; this.entries.delete(first);
    }
  }
  async read(state, loadReference, { wait = true } = {}) {
    const input = ratingInput(state), version = c.digest(input);
    const key = `${state._id || ''}:${version}`;
    let entry = this.entries.get(key);
    if (entry?.error && Date.now() >= entry.retryAt) {
      this.bytes -= entry.bytes; this.entries.delete(key); entry = null;
    }
    if (entry) {
      this.entries.delete(key); this.entries.set(key, entry);
      if (entry.error) {
        if (wait) throw new Error(entry.error);
        return { status: 'failed', version, error: entry.error };
      }
      return { status: 'ready', version, ...entry.report };
    }
    let task = this.tasks.get(key);
    if (!task) {
      if (this.closed) throw new Error('Rating 服务已关闭');
      if (this.tasks.size >= this.maxTasks) {
        if (wait) throw new Error('Rating 计算队列已满，请稍后重试');
        return { status: 'busy', version };
      }
      // Detach admitted input from the caller before returning a pending response.
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      promise.catch(() => {}); // Nonblocking readers observe failure on their next read.
      task = { key, input, loadReference, promise, resolve, reject };
      this.tasks.set(key, task); this.queue.push(task); this.pump();
    }
    if (!wait) return { status: 'computing', version };
    return { status: 'ready', version, ...await task.promise };
  }
  pump() {
    if (this.active || this.closed || !this.queue.length) return;
    const task = this.queue.shift(); this.active = task;
    let worker, timer, finished = false;
    const finish = (error, report) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      worker?.terminate().catch(() => {});
      try { if (!this.closed) this.remember(task.key, error
        ? { error: `Rating 计算失败：${error.message}；请稍后刷新重试`, retryAt: Date.now() + 1000 }
        : { report }); } catch (e) { error = e; }
      this.tasks.delete(task.key); this.active = null;
      if (error) task.reject(error); else task.resolve(report);
      this.pump();
    };
    task.cancel = () => finish(new Error('Rating 服务已关闭'));
    try {
      worker = new Worker(this.workerFile, { workerData: task.input,
        resourceLimits: { maxOldGenerationSizeMb: 256 } });
      this.starts++;
      timer = setTimeout(() => finish(new Error('计算超时')), this.timeoutMs);
      worker.on('message', async message => {
        if (finished) return;
        if (message.type === 'reference') {
          try {
            const reference = await task.loadReference(message.id);
            if (!finished) worker.postMessage(reference);
          } catch (e) { finish(e); }
        } else if (message.type === 'result') finish(null, message.report);
        else if (message.type === 'error') finish(new Error(message.error));
      });
      worker.on('error', e => finish(e));
      worker.on('exit', code => { if (!finished) finish(new Error(`worker 提前退出 (${code})`)); });
    } catch (e) { finish(e); }
  }
  close() {
    this.closed = true;
    for (const task of this.queue.splice(0)) { this.tasks.delete(task.key); task.reject(new Error('Rating 服务已关闭')); }
    this.active?.cancel(); this.entries.clear(); this.bytes = 0;
  }
}
module.exports = { ratingInput, ratingKey, replayOriginal, RatingCache };
