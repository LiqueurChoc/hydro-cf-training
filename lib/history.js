'use strict';

const c = require('./core');

function validRating(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(tag => typeof tag === 'string').map(tag => tag.trim()).filter(Boolean))];
}
function subTime(sub) {
  return Number.isSafeInteger(sub?.creationTimeSeconds) && sub.creationTimeSeconds >= 0
    ? sub.creationTimeSeconds : 0;
}
function compareIds(a, b) {
  const aa = a?.id, bb = b?.id;
  if (Number.isSafeInteger(aa) && Number.isSafeInteger(bb) && aa !== bb) return bb - aa;
  return String(bb ?? '').localeCompare(String(aa ?? ''), 'en');
}
function compareNewest(a, b) {
  return subTime(b) - subTime(a) || compareIds(a, b);
}

// Shared full-history grouping for the paginated list and solved-problem statistics.
function aggregateProblemHistory(records) {
  const problems = new Map();
  for (const sub of records) {
    const id = sub.problem?.contestId ?? sub.contestId;
    const index = sub.problem?.index;
    if (!Number.isSafeInteger(id) || id < 1 || typeof index !== 'string'
      || !/^[A-Za-z][A-Za-z0-9]*$/.test(index)) continue;
    const key = `${id}/${index.toUpperCase()}`;
    let row = problems.get(key);
    if (!row) {
      row = { key, contestId: id, index: index.toUpperCase(), name: '', rating: null,
        tags: [], ac: 0, submissions: 0, lastSubmittedAt: 0, _records: [] };
      problems.set(key, row);
    }
    row.submissions++;
    if (sub.verdict === 'OK') row.ac++;
    row._records.push(sub);
  }
  for (const row of problems.values()) {
    row._records.sort(compareNewest);
    const latest = row._records[0];
    row.lastSubmittedAt = subTime(latest) * 1000;
    row.name = row._records.find(sub => typeof sub.problem?.name === 'string')?.problem.name || '';
    row.rating = row._records.map(sub => validRating(sub.problem?.rating)).find(value => value !== null) ?? null;
    row.tags = row._records.map(sub => cleanTags(sub.problem?.tags)).find(tags => tags.length) || [];
  }
  return [...problems.values()];
}

function problemHistory(records, options = {}) {
  const page = c.integer(options.page ?? 1, 1, 1000000, '页码');
  const pageSize = c.integer(options.pageSize ?? 50, 1, 100, '每页数量');
  const status = options.status || 'all';
  if (!['all', 'solved', 'attempted'].includes(status)) c.fail('未知题目状态');
  const rows = aggregateProblemHistory(records).map(({ _records, tags, ...row }) => ({
    ...row, status: row.ac ? 'solved' : 'attempted',
  }))
    .sort((a, b) => b.lastSubmittedAt - a.lastSubmittedAt || a.key.localeCompare(b.key));
  const counts = { all: rows.length, solved: 0, attempted: 0 };
  for (const row of rows) counts[row.status]++;
  const filtered = status === 'all' ? rows : rows.filter(row => row.status === status);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const actualPage = Math.min(page, pages);
  return { rows: filtered.slice((actualPage - 1) * pageSize, actualPage * pageSize),
    counts, page: actualPage, pages, status };
}

module.exports = { aggregateProblemHistory, cleanTags, validRating, problemHistory };
