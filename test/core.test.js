'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/core');
const { CodeforcesClient } = require('../lib/cf');
const member = { uid: 1, handle: 'Student' };
const startAt = 1700000000000;
const slot = { index: 'C', original: { contestId: 1, index: 'C' }, actual: { contestId: 2, index: 'B' }, points: 1500 };
const run = { startAt, durationSeconds: 7200, slots: [slot], rules: c.rules('CF') };
let sid = 0;
const sub = (minutes, verdict, extra = {}) => ({ id: ++sid, creationTimeSeconds: startAt / 1000 + minutes * 60,
  problem: slot.actual, author: { members: [{ handle: 'Student' }], participantType: 'PRACTICE' }, verdict, ...extra });

test('parses only public CF identifiers and rejects arbitrary hosts', () => {
  assert.deepEqual(c.parseProblem('https://codeforces.com/contest/2000/problem/C'), { contestId: 2000, index: 'C' });
  assert.deepEqual(c.parseProblem('2000C'), { contestId: 2000, index: 'C' });
  assert.deepEqual(c.parseProblem('https://codeforces.com/problemset/problem/2000/C'), { contestId: 2000, index: 'C' });
  assert.throws(() => c.parseContest('https://attacker.test/2000'));
  assert.throws(() => c.parseProblem('https://codeforces.com.attacker.test/contest/1/problem/A'));
});
test('replacement inherits original points; original problem and out-of-window submissions ignored', () => {
  const rows = [sub(-1, 'OK'), sub(20, 'OK', { problem: slot.original }), sub(30, 'WRONG_ANSWER'), sub(60, 'OK'), sub(120, 'OK')];
  assert.equal(c.scoreRun(run, rows, member).points, 1090);
});
test('CF CE does not penalize; later valid resubmission replaces result', () => {
  assert.equal(c.scoreRun(run, [sub(10, 'COMPILATION_ERROR'), sub(60, 'OK')], member).points, 1140);
  assert.equal(c.scoreRun(run, [sub(10, 'OK'), sub(60, 'WRONG_ANSWER')], member).points, 0);
  assert.equal(c.scoreRun(run, [sub(10, 'OK'), sub(60, 'COMPILATION_ERROR')], member).points, 1440);
});
test('CF floor, pending results, deduplication and identity filtering', () => {
  const accepted = sub(110, 'OK');
  const rows = Array.from({ length: 50 }, (_, i) => sub(i, 'WRONG_ANSWER')).concat(accepted, accepted);
  assert.equal(c.scoreRun(run, rows, member).points, 450);
  assert.equal(c.scoreRun(run, [sub(10, undefined)], member).pending, 1);
  assert.equal(c.scoreRun(run, [sub(10, 'OK', { author: { members: [{ handle: 'Other' }] } })], member).points, 0);
});
test('ICPC takes first AC, counts only failures before AC, ties use penalty', () => {
  const icpc = { ...run, rules: c.rules('ICPC') };
  const result = c.scoreRun(icpc, [sub(5, 'COMPILATION_ERROR'), sub(10, 'WRONG_ANSWER'), sub(30, 'OK'), sub(40, 'WRONG_ANSWER')], member);
  assert.equal(result.points, 1); assert.equal(result.penalty, 40);
  assert.deepEqual(c.rankRows([{ points: 2, penalty: 70 }, { points: 2, penalty: 60 }, { points: 1, penalty: 1 }], 'ICPC').map(r => r.rank), [1, 2, 3]);
});
test('historical screening distinguishes unknown, attempted, accepted and contest participation', () => {
  const at = startAt + 100000;
  const account = { approved: true, historyComplete: true, lastSyncAt: at, ratingHistory: [] };
  assert.equal(c.exposure({}, [], [], 2, [slot.actual], at).status, 'unknown');
  assert.equal(c.exposure(account, [], [], 2, [slot.actual], at).status, 'clear');
  const result = c.exposure(account, [sub(-10, 'WRONG_ANSWER')], [], 2, [slot.actual], at);
  assert.equal(result.status, 'exposed'); assert.deepEqual(result.accepted, []);
  assert.equal(c.exposure({ ...account, ratingHistory: [{ contestId: 2 }] }, [], [], 2, [slot.actual], at).status, 'attended');
  assert.equal(c.exposure(account, [], [{ key: '2/B', createdAt: at - 1 }], 2, [slot.actual], at).status, 'exposed');
  assert.equal(c.exposure({ ...account, status: 'failed' }, [], [], 2, [slot.actual], at).status, 'unknown');
});

// Slow independent implementation used to verify the optimized historical-pool calculation.
function oracle(reference, student, rating, type) {
  const list = [...reference.map(r => ({ ...r })), { ...student, rating, student: true }].sort((a,b) => c.compare(a,b,type));
  const probability = (r, o) => 1 / (1 + 10 ** ((r-o) / 400));
  for(let i=0;i<list.length;i++) {
    const u=list[i];
    let rank=i+1;while(rank<list.length && !c.compare(u,list[rank],type)) rank++;
    const expected=r=>1+list.filter(x=>x!==u).reduce((sum,x)=>sum+probability(r,x.rating),0);
    const target=Math.sqrt(expected(u.rating)*rank);
    let l=1,h=8000;
    while(h-l>1){const m=Math.floor((l+h)/2);if(expected(m)<target)h=m;else l=m;}
    u.delta=Math.trunc((l-u.rating)/2);
  }
  const inc=Math.trunc(-list.reduce((s,u)=>s+u.delta,0)/list.length)-1;
  list.forEach(u=>u.delta+=inc);list.sort((a,b)=>b.rating-a.rating);
  const n=Math.min(list.length,4*Math.round(Math.sqrt(list.length)));
  const inc2=Math.min(0,Math.max(-10,Math.trunc(-list.slice(0,n).reduce((s,u)=>s+u.delta,0)/n)));
  return list.find(u=>u.student).delta+inc2;
}
test('rating engine matches a direct all-pairs calculation including ties and corrections', () => {
  for(const type of ['CF','ICPC']) {
    const ref=Array.from({length:16},(_,i)=>({rating:i<3?0:800+i*70,points:Math.floor(i/3)*100,penalty:i*10}));
    const engine=c.referenceEngine(ref,type);
    for(const score of [0,100,250,500,1000]) for(const rating of [900,1400,2100]) {
      const student={points:score,penalty:50};
      assert.equal(engine(student,rating).delta,oracle(ref,student,rating,type));
    }
    assert.ok(engine({points:1000,penalty:0},1400).delta > engine({points:0,penalty:0},1400).delta);
  }
});
test('CF client serializes calls and retries malformed/error responses', async () => {
  let requests=0, active=0, max=0;
  const client=new CodeforcesClient({interval:0,pause:async()=>{},fetchImpl:async()=>{
    requests++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;
    return {ok:true,json:async()=>requests===1?{status:'FAILED',comment:'retry'}:{status:'OK',result:[]}};
  }});
  await Promise.all([client.call('user.status',{handle:'user'}),client.call('user.rating',{handle:'user'})]);
  assert.equal(max,1);assert.equal(requests,3);
  await assert.rejects(()=>client.call('unsafe.method'));
});
