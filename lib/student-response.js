'use strict';

// This is an API boundary, including for old frozen score snapshots. Never spread
// internal objects here: newly added diagnostics must remain coach-only by default.
function studentRunResponse(result, uid, now = Date.now()) {
  const source = result.run;
  const run = { id: source.id, title: source.title, startAt: source.startAt,
    durationSeconds: source.durationSeconds, status: source.status, rated: source.rated,
    attendees: source.attendees.includes(uid) ? [uid] : [] };
  // Scoring is public before the start; keep its allowlist separate from problems.
  if (['CF', 'ICPC'].includes(source.rules?.type)) {
    run.rules = { type: source.rules.type };
    const fields = source.rules.type === 'CF'
      ? ['decayMinutes', 'wrongPenalty', 'minimumFraction'] : ['icpcPenalty'];
    for (const field of fields) if (Number.isFinite(source.rules[field])) run.rules[field] = source.rules[field];
  }
  if (now < source.startAt) return { run, rows: [], hidden: true, absent: [] };
  run.slots = source.slots.map(slot => ({ index: slot.index, points: slot.points,
    actual: { contestId: slot.actual.contestId, index: slot.actual.index, name: slot.actual.name } }));
  if (source.warnings) run.warnings = source.warnings.filter(w => typeof w === 'string');
  const rows = result.rows.map(row => {
    const visible = { uid: row.uid, handle: row.handle, rank: row.rank, points: row.points,
      penalty: row.penalty, complete: row.complete,
      problems: row.problems.map(p => ({ index: p.index, solved: p.solved, points: p.points })) };
    // A student's qualification/sync explanations are private; the shared board
    // only needs scores and the coarse settlement status.
    if (row.uid === uid) {
      visible.reason = row.reason;
      visible.completionIssues = (row.completionIssues || []).filter(x => typeof x === 'string');
    }
    return visible;
  });
  return { run, rows, hidden: false, absent: [] };
}

module.exports = { studentRunResponse };
