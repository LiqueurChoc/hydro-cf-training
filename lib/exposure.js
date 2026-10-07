'use strict';
const c = require('./core');

// IDs describe facts, not notice insertion attempts: deleting/re-adding a notice
// cannot change either an established fact or a coach's correction of that fact.
function collect(account, records, notices, contestId, problems, at) {
  const keys = new Set(problems.map(c.problemKey)), evidence = [];
  const add = (id, source, key, attended, occurredAt) => evidence.push({ id, source, key, attended, occurredAt });
  for (const n of notices) if (n.createdAt < at && (keys.has(n.key) || n.key === `contest:${contestId}`)) {
    add(`notice:${n.key}`, 'manual', n.key, n.key.startsWith('contest:'), n.createdAt);
  }
  for (const sub of records) if (sub.creationTimeSeconds * 1000 < at) {
    const key = c.problemKey(sub.problem);
    if (keys.has(key)) add(`submission:${sub.id}:problem`, 'submission', key, false, sub.creationTimeSeconds * 1000);
    if (sub.contestId === contestId && ['CONTESTANT', 'VIRTUAL', 'OUT_OF_COMPETITION'].includes(sub.author?.participantType)) {
      add(`submission:${sub.id}:contest`, 'participation', `contest:${contestId}`, true, sub.creationTimeSeconds * 1000);
    }
  }
  if (account?.ratingHistory?.some(r => r.contestId === contestId)) {
    add(`rating:${contestId}`, 'rating', `contest:${contestId}`, true, null);
  }
  return evidence;
}

function saved(run, uid) {
  const check = run.screening?.find(x => x.uid === uid);
  // Legacy snapshots have aggregates only. Preserve known positives without
  // inventing a source, and never turn unknown/status into positive evidence.
  const publication = check?.evidence || [
    ...(check?.attended ? [{ id: 'publication:contest', source: 'publication', key: `contest:${run.contestId}`, attended: true }] : []),
    ...[...new Set([...(check?.touched || []), ...(check?.accepted || [])])].map(key => ({
      id: `publication:${key}`, source: 'publication', key, attended: false,
    })),
  ];
  return merge(publication, run.exposureEvidence?.[uid] || []);
}
function merge(...lists) {
  const facts = new Map();
  for (const e of lists.flat()) if (!facts.has(e.id)) facts.set(e.id, e);
  return [...facts.values()].sort((a, b) => a.id.localeCompare(b.id));
}
function retain(run, uid, evidence) {
  if (!evidence.length) return;
  run.exposureEvidence ||= {};
  run.exposureEvidence[uid] = merge(saved(run, uid), evidence);
}
function capture(state, uid, records = [], notices = state.notices.filter(n => n.uid === uid)) {
  const account = state.accounts.find(a => a.uid === uid);
  for (const run of state.runs) {
    if (run.status !== 'published' || !run.members.some(m => m.uid === uid && m.bindingId === account?.bindingId)) continue;
    retain(run, uid, collect(account, records, notices, run.contestId, run.slots.map(s => s.actual), run.startAt));
  }
}
function history(run, uid, account, records, notices) {
  const current = c.exposure(account, records, notices, run.contestId, run.slots.map(s => s.actual), run.startAt);
  const evidence = merge(saved(run, uid), collect(account, records, notices, run.contestId, run.slots.map(s => s.actual), run.startAt));
  const corrections = (run.exposureCorrections || []).filter(x => x.uid === uid);
  const corrected = new Set(corrections.flatMap(x => x.evidenceIds));
  const active = evidence.filter(e => !corrected.has(e.id));
  const attended = active.some(e => e.attended), touched = [...new Set(active.filter(e => !e.attended).map(e => e.key))];
  return { ...current, attended, touched, evidence, corrections,
    publicationMissing: !run.screening?.some(x => x.uid === uid),
    status: current.unknown ? 'unknown' : attended ? 'attended' : touched.length ? 'exposed' : 'clear' };
}
module.exports = { collect, saved, retain, capture, history };
