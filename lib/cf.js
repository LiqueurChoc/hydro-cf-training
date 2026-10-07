'use strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
class CodeforcesClient {
  constructor({ fetchImpl = fetch, pause = sleep, interval = 2100 } = {}) {
    this.fetch = fetchImpl; this.pause = pause; this.interval = interval;
    this.nextAt = 0; this.tail = Promise.resolve();
  }
  call(method, params = {}) {
    const task = this.tail.then(() => this.request(method, params));
    this.tail = task.catch(() => {});
    return task;
  }
  async request(method, params) {
    if (!['user.info', 'user.status', 'user.rating', 'contest.list', 'contest.standings',
      'contest.ratingChanges', 'problemset.problems'].includes(method)) throw new Error('Unsupported CF API');
    const url = new URL(`https://codeforces.com/api/${method}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.pause(Math.max(0, this.nextAt - Date.now()));
      this.nextAt = Date.now() + this.interval;
      try {
        const response = await this.fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`CF HTTP ${response.status}`);
        const payload = await response.json();
        if (payload.status !== 'OK') throw new Error(String(payload.comment || 'CF API failed').slice(0, 300));
        return payload.result;
      } catch (error) {
        last = error;
        if (attempt < 2) await this.pause(2500 * (attempt + 1));
      }
    }
    throw last;
  }
}
module.exports = { CodeforcesClient };
