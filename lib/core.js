'use strict';

const { createHash } = require('node:crypto');
const VERSION = 'cf-public-2015-v1';
const fail = (message) => { throw new Error(message); };
function integer(value, min, max, name = '数值') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${name}应为 ${min}—${max} 的整数`);
  return n;
}
function handle(value) {
  const h = String(value || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(h)) fail('CF handle 格式不正确');
  return h;
}
function problemKey(p) { return `${p.contestId}/${p.index}`; }
function parseProblem(value) {
  const s = String(value || '').trim();
  const m = /^(\d+)\s*[/\-]?\s*([A-Za-z][A-Za-z0-9]*)$/.exec(s)
    || /^https:\/\/codeforces\.com\/(?:contest\/(\d+)\/problem\/|problemset\/problem\/(\d+)\/)([A-Za-z][A-Za-z0-9]*)\/?$/.exec(s);
  if (!m) fail('请输入题号（如 2000/C）或 CF 题目链接');
  const contestId = integer(m[1] || m[2], 1, 99999, '比赛 ID');
  const index = (m.length === 3 ? m[2] : m[3]).toUpperCase();
  return { contestId, index };
}
function parseContest(value) {
  const m = /^(?:https:\/\/codeforces\.com\/contest\/)?(\d+)\/?$/.exec(String(value || '').trim());
  if (!m) fail('请输入公开 CF 比赛 ID 或比赛链接');
  return integer(m[1], 1, 99999, '比赛 ID');
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function rules(type, overrides = {}) {
  if (!['CF', 'ICPC'].includes(type)) fail('首版支持 CF 与 ICPC 计分，暂不支持 IOI/特殊赛制');
  return {
    type,
    decayMinutes: integer(overrides.decayMinutes ?? 250, 1, 2000, '衰减参数'),
    wrongPenalty: integer(overrides.wrongPenalty ?? 50, 0, 1000, '错误提交扣分'),
    icpcPenalty: integer(overrides.icpcPenalty ?? 10, 0, 120, 'ICPC 罚时'),
    minimumFraction: 0.3,
    version: 'replay-score-v1',
  };
}

// CE and platform failures do not count as failed attempts. Unknown verdicts block settlement.
const IGNORED = new Set(['COMPILATION_ERROR']);
const WRONG = new Set(['WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED',
  'RUNTIME_ERROR', 'IDLENESS_LIMIT_EXCEEDED', 'CHALLENGED', 'SECURITY_VIOLATED']);
const WRONG_VERDICTS = [...WRONG];

// Per-problem personal status. OK wins permanently: a judged failure after AC never demotes
// the problem. Only non-judged submissions (TESTING, undefined, CE, platform errors) leave
// the problem in `pending`; pending is never reported as a judged failure.
function classifyProblem({ ac = 0, fail = 0, other = 0 }) {
  if (ac > 0) return 'solved';
  if (fail > 0) return 'attempted';
  return 'pending';
}
function classifyVerdict(verdict) {
  if (verdict === 'OK') return 'ac';
  if (WRONG.has(verdict)) return 'fail';
  return 'other';
}
// A standard public problem identity. Gym (contestId >= 100000) or malformed entries must not
// be merged into normal problems and must not produce problemset links.
function standardProblemKey(contestId, index) {
  if (!Number.isSafeInteger(contestId) || contestId < 1 || contestId > 99999) return null;
  if (typeof index !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(index)) return null;
  return `${contestId}/${index.toUpperCase()}`;
}
// Histogram of solved problems by problem difficulty rating, 100 points per bin.
// Unrated problems form their own bin and are never counted as rating 0 or dropped.
function ratingHistogram(problems) {
  const bins = new Map();
  let unrated = 0;
  for (const p of problems) {
    const r = p.rating;
    if (!Number.isSafeInteger(r) || r <= 0) { unrated++; continue; }
    const min = Math.floor(r / 100) * 100;
    bins.set(min, (bins.get(min) || 0) + 1);
  }
  const rows = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([min, count]) => ({ min, max: min + 99, count }));
  const total = rows.reduce((n, b) => n + b.count, 0) + unrated;
  return { bins: rows, unrated, total };
}
// Pie counts: each solved problem contributes 1 to every distinct tag it has; problems with no
// tags contribute 1 to `untagged`. The denominator is the sum of all tag counts, not the number
// of solved problems.
function tagPie(problems) {
  const counts = new Map();
  for (const p of problems) {
    const tags = [...new Set((Array.isArray(p.tags) ? p.tags : [])
      .filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean))];
    if (!tags.length) counts.set(null, (counts.get(null) || 0) + 1);
    for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  const rows = [...counts.entries()].map(([tag, count]) => ({ kind: tag === null ? 'unknown' : 'tag', tag, count }))
    .sort((a, b) => b.count - a.count || (a.kind === 'unknown' ? 1 : b.kind === 'unknown' ? -1 : a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return { rows, total: rows.reduce((n, t) => n + t.count, 0) };
}
function scoreRun(run, submissions, member) {
  const start = run.startAt / 1000;
  const end = start + run.durationSeconds;
  const unique = [...new Map(submissions.map(s => [s.id, s])).values()]
    .filter(s => s.creationTimeSeconds >= start && s.creationTimeSeconds < end
      && s.author?.members?.length === 1
      && s.author.members[0].handle.toLowerCase() === member.handle.toLowerCase())
    .sort((a, b) => a.creationTimeSeconds - b.creationTimeSeconds || a.id - b.id);
  let pending = 0;
  const problems = run.slots.map(slot => {
    let solved = false, attempts = 0, minutes = 0, submissionId = null;
    for (const sub of unique.filter(s => problemKey(s.problem) === problemKey(slot.actual))) {
      if (run.rules.type === 'ICPC' && solved) continue;
      if (IGNORED.has(sub.verdict)) continue;
      if (!WRONG.has(sub.verdict) && sub.verdict !== 'OK') { pending++; continue; }
      // CF resubmissions replace the previous result; ICPC uses the first accepted result.
      solved = sub.verdict === 'OK';
      if (solved) {
        minutes = Math.floor((sub.creationTimeSeconds - start) / 60);
        submissionId = sub.id;
      } else submissionId = null;
      attempts++;
    }
    const wrong = solved ? attempts - 1 : attempts;
    const points = !solved ? 0 : run.rules.type === 'ICPC' ? 1
      : Math.max(slot.points * run.rules.minimumFraction,
        slot.points * (1 - minutes / run.rules.decayMinutes) - wrong * run.rules.wrongPenalty);
    return { index: slot.index, solved, wrong, minutes: solved ? minutes : null,
      points: Math.round(points * 100) / 100,
      penalty: solved && run.rules.type === 'ICPC' ? minutes + wrong * run.rules.icpcPenalty : 0,
      submissionId };
  });
  return { uid: member.uid, handle: member.handle, pending, problems,
    points: Math.round(problems.reduce((n, p) => n + p.points, 0) * 100) / 100,
    penalty: problems.reduce((n, p) => n + p.penalty, 0),
    solved: problems.filter(p => p.solved).length };
}
function compare(a, b, type) { return b.points - a.points || (type === 'ICPC' ? a.penalty - b.penalty : 0); }
function rankRows(rows, type) {
  const sorted = rows.map(r => ({ ...r })).sort((a, b) => compare(a, b, type));
  let first = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i && compare(sorted[i], sorted[i - 1], type)) first = i;
    sorted[i].rank = first + 1;
  }
  return sorted;
}
function exposure(account, records, notices, contestId, problems, at = Date.now()) {
  const keys = new Set(problems.map(problemKey));
  const hits = records.filter(s => keys.has(problemKey(s.problem)) && s.creationTimeSeconds * 1000 < at);
  const seen = notices.filter(n => n.createdAt < at && (keys.has(n.key) || n.key === `contest:${contestId}`));
  const attended = account?.ratingHistory?.some(r => r.contestId === contestId)
    || records.some(s => s.contestId === contestId && s.creationTimeSeconds * 1000 < at
      && ['CONTESTANT', 'VIRTUAL', 'OUT_OF_COMPETITION'].includes(s.author?.participantType));
  const touched = [...new Set([...hits.map(s => problemKey(s.problem)), ...seen.filter(n => !n.key.startsWith('contest:')).map(n => n.key)])];
  const unknown = !account?.approved || !account?.historyComplete || !account?.lastSyncAt || account?.status === 'failed'
    || at - account.lastSyncAt > 24 * 3600_000;
  return { unknown, attended: !!attended || seen.some(n => n.key.startsWith('contest:')),
    touched, accepted: [...new Set(hits.filter(s => s.verdict === 'OK').map(s => problemKey(s.problem)))],
    status: unknown ? 'unknown' : attended || seen.some(n => n.key.startsWith('contest:')) ? 'attended'
      : touched.length ? 'exposed' : 'clear' };
}

// Discovery checks many contests against the same history. Keep this index local to
// one request; first-occurrence positions preserve exposure()'s public array order.
function prepareExposure(account, records, notices, at = Date.now()) {
  const touched = new Map(), accepted = new Map(), manual = new Map(), attended = new Set();
  for (const r of account?.ratingHistory || []) attended.add(r.contestId);
  records.forEach((sub, i) => {
    if (!(sub.creationTimeSeconds * 1000 < at)) return;
    const key = problemKey(sub.problem);
    if (!touched.has(key)) touched.set(key, i);
    if (sub.verdict === 'OK' && !accepted.has(key)) accepted.set(key, i);
    if (['CONTESTANT', 'VIRTUAL', 'OUT_OF_COMPETITION'].includes(sub.author?.participantType)) attended.add(sub.contestId);
  });
  notices.forEach((n, i) => {
    if (n.createdAt < at && !manual.has(n.key)) manual.set(n.key, i);
  });
  const unknown = !account?.approved || !account?.historyComplete || !account?.lastSyncAt || account?.status === 'failed'
    || at - account.lastSyncAt > 24 * 3600_000;
  return { touched, accepted, manual, attended, unknown };
}
function exposureFromIndex(index, contestId, problems) {
  const keys = [...new Set(problems.map(problemKey))];
  const ordered = map => keys.filter(key => map.has(key)).sort((a, b) => map.get(a) - map.get(b));
  const touched = [...new Set([...ordered(index.touched), ...ordered(index.manual)])];
  const attended = index.attended.has(contestId) || index.manual.has(`contest:${contestId}`);
  return { unknown: index.unknown, attended, touched, accepted: ordered(index.accepted),
    status: index.unknown ? 'unknown' : attended ? 'attended' : touched.length ? 'exposed' : 'clear' };
}

// A fixed historical pool is used separately for each student. Displayed historical CF ratings
// are available; the undocumented/internal adjustments are deliberately not claimed as exact.
function referenceEngine(reference, type) {
  if (reference.length < 2) fail('至少需要两名有历史评分的参照选手');
  const rows = reference.map(r => ({ ...r })).sort((a, b) => compare(a, b, type));
  const histogram = new Map();
  for (const row of rows) {
    row.rating = integer(row.rating, -10000, 10000, '历史评分');
    histogram.set(row.rating, (histogram.get(row.rating) || 0) + 1);
  }
  const lo = 1, hi = 8000;
  const table = new Float64Array(hi - lo + 1);
  const probability = rdiff => 1 / (1 + 10 ** (rdiff / 400));
  const lookup = new Float64Array(40001);
  for (let i = 0; i < lookup.length; i++) lookup[i] = probability(i - 20000);
  for (let r = lo; r <= hi; r++) {
    let n = 1;
    for (const [opponent, count] of histogram) n += count * lookup[r - opponent + 20000];
    table[r - lo] = n;
  }
  // Zero displayed rating is common in old CF pools; cache out-of-grid seeds too.
  const outside = new Map();
  const base = r => {
    if (r >= lo && r <= hi && Number.isInteger(r)) return table[r - lo];
    if (!outside.has(r)) outside.set(r, 1 + rows.reduce((s, o) => s + probability(r - o.rating), 0));
    return outside.get(r);
  };
  const invert = (rank, seed) => {
    let left = lo, right = hi;
    while (right - left > 1) {
      const mid = Math.floor((left + right) / 2);
      if (seed(mid) < rank) right = mid; else left = mid;
    }
    return left;
  };
  // Worst occupied rank for ties is used by the published CF calculation.
  for (let i = rows.length - 1, last = rows.length; i >= 0; i--) {
    if (i < rows.length - 1 && compare(rows[i], rows[i + 1], type)) last = i + 1;
    rows[i].ratingRank = last;
  }
  return (student, oldRating) => {
    const lessOrEqual = rows.filter(r => compare(r, student, type) <= 0).length;
    const rank = rows.filter(r => compare(r, student, type) < 0).length + 1;
    const ratingRank = lessOrEqual + 1;
    const seed = base(oldRating);
    const studentDelta = Math.trunc((invert(Math.sqrt(seed * ratingRank), base) - oldRating) / 2);
    const all = rows.map(r => {
      const newRank = r.ratingRank + (compare(student, r, type) <= 0 ? 1 : 0);
      const seedFn = x => base(x) - probability(x - r.rating) + probability(x - oldRating);
      return { rating: r.rating, delta: Math.trunc((invert(Math.sqrt(seedFn(r.rating) * newRank), seedFn) - r.rating) / 2) };
    });
    all.push({ rating: oldRating, delta: studentDelta });
    const inc1 = Math.trunc(-all.reduce((n, r) => n + r.delta, 0) / all.length) - 1;
    all.sort((a, b) => b.rating - a.rating);
    const n = Math.min(all.length, 4 * Math.round(Math.sqrt(all.length)));
    const inc2 = Math.min(0, Math.max(-10, Math.trunc(-all.slice(0, n).reduce((s, r) => s + r.delta + inc1, 0) / n)));
    const delta = studentDelta + inc1 + inc2;
    return { rank, ratingRank, referenceCount: rows.length, seed, oldRating, delta,
      newRating: oldRating + delta, algorithm: VERSION, approximate: true };
  };
}
module.exports = { VERSION, fail, integer, handle, problemKey, parseProblem, parseContest,
  digest, rules, scoreRun, compare, rankRows, exposure, prepareExposure, exposureFromIndex, referenceEngine,
  WRONG_VERDICTS, classifyProblem, classifyVerdict, standardProblemKey, ratingHistogram, tagPie };
