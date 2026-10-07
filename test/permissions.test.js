'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { PERM_CF_TRAINING_COACH: bit, registerCoachPermission } = require('../lib/permissions');
function builtin() { return { PERM: { PERM_ALL: -1n, PERM_EDIT_CONTEST: 1n << 50n }, PERMS: [], PERMS_BY_FAMILY: {}, Permission: (family,key,desc) => ({family,key,desc}) }; }
test('permission registration is visible, reversible and rejects collisions', () => {
  const b = builtin(); let dispose;
  registerCoachPermission({on: (_,fn) => {dispose=fn;}}, b);
  assert.equal(b.PERMS_BY_FAMILY.perm_cf_training[0].key, bit);
  assert.throws(() => registerCoachPermission({on(){}}, b), /already registered/);
  dispose(); assert.equal(b.PERMS.length, 0); assert.equal(b.PERMS_BY_FAMILY.perm_cf_training, undefined);
  b.PERM.OTHER_PLUGIN = bit;
  assert.throws(() => registerCoachPermission({on(){}}, b), /already registered/);
});
async function setup(deployment = null) {
  const routes = {}; const calls = [];
  const state = {accounts:[{uid:2},{uid:3}],groups:[{id:'class',name:'Class',uids:[2],ownerId:2,adminIds:[]}],
    notices:[{uid:2,key:'2000/A',createdAt:1},{uid:3,key:'2001/B',createdAt:2}],runs:[],revision:0};
  class ForbiddenError extends Error {}
  class Handler {
    checkPriv() { if (!this.user._id) throw new ForbiddenError(); }
    checkPerm(p) { if (!this.user.hasPerm(p)) throw new ForbiddenError(); }
    url(name) { return '/d/test/' + name; }
  }
  class TrainingService {
    async init() {}
    async state() { return state; }
    async change(domainId, apply) { const copy = structuredClone(state); const result = await apply(copy); Object.assign(state, copy); return result; }
    async cancelDraft(...args) { return require('../lib/service').TrainingService.prototype.cancelDraft.apply(this, args); }
    async rescheduleDraft(...args) { return require('../lib/service').TrainingService.prototype.rescheduleDraft.apply(this, args); }
    async studentProblems(domainId, uid) { return {owner:uid}; }
    async studentProblemStats(domainId, uid) { return {owner:uid, solvedTotal:0}; }
    async replay() { return {ratings:{},ledger:[]}; }
    jobs = {find:()=>({sort:()=>({limit:()=>({toArray:async()=>[]})})})};
    catalog = {findOne:async()=>null};
    async enqueue(...args) {calls.push(args);}
  }
  const sandbox = {exports:{},global:{Hydro:{model:{builtin:builtin()}}},Buffer,console,__dirname:path.join(__dirname,'..'),
    setInterval:()=>({unref(){}}),clearInterval(){},
    require(name) { if(name==='hydrooj')return {Handler,db:{},PRIV:{PRIV_USER_PROFILE:1},PERM:{PERM_EDIT_DOMAIN:2n},ForbiddenError,
      UserModel:{getById:async(_,uid)=>[1,2,3,4,5].includes(uid)?{_id:uid,uname:`User${uid}`}:null,
        getMulti:query=>({toArray:async()=>query._id.$in.map(uid=>({_id:uid,uname:`User${uid}`}))})},
      DomainModel:{get:async()=>({owner:1}),getMultiUserInDomain:(_,query)=>({limit:()=>({toArray:async()=>[2,3,4].includes(query.uid)?[{uid:query.uid}]:[]})})}};
      if(name==='./lib/service')return {TrainingService};
      if(name==='node:fs')return {existsSync:()=>!!deployment,readFileSync:()=>JSON.stringify(deployment)};
      if(name.startsWith('./'))return require(path.join(__dirname,'..',name));
      return require(name);
    }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../index.js'),'utf8'),sandbox);
  await sandbox.exports.apply({Route:(name,p,h)=>{routes[name]=h;},injectUI(){},on(){}});
  function handler(name,perm=0n,args={}) {
    const h=new routes[name]();h.args={domainId:'test',...args};h.domain={_id:'test'};
    h.user={_id:2,hasPerm:p=>(perm&p)===p};h.session={cfTrainingCsrf:'token'};
    h.request={headers:{'x-cf-training-csrf':'token'}};h.response={};return h;
  }
  return {handler,ForbiddenError,calls,state,service:sandbox.global.Hydro.model.cfTraining};
}

test('deployment health requires exact secret, reads storage, renders real template and fails on DB errors', async () => {
  const absent = await setup();
  await assert.rejects(absent.handler('cf_training_health').get(), absent.ForbiddenError);
  const { handler, service, ForbiddenError } = await setup({ token: 'secret', build: 'fixture-build' });
  let reads = 0;
  service.states = { async findOne(query) { reads++; assert.deepEqual(query, { _id: '__cf_training_health_probe__' }); } };
  for (const token of ['', 'wrong!', '秘密']) {
    const h = handler('cf_training_health'); h.request.headers['x-cf-training-probe'] = token;
    await assert.rejects(h.get(), ForbiddenError);
  }
  assert.equal(reads, 0);
  const h = handler('cf_training_health'); h.request.headers['x-cf-training-probe'] = 'secret';
  // Query objects cross the VM realm; compare their JSON representation in the probe stub.
  service.states.findOne = async query => { reads++; assert.equal(JSON.stringify(query), '{"_id":"__cf_training_health_probe__"}'); };
  await h.get(); assert.equal(reads, 1);
  assert.equal(h.response.template, 'cf_training_health.html');
  assert.equal(JSON.stringify(h.response.body), '{"cfCoach":false,"cfToken":"","cfBuild":"fixture-build"}');
  service.states.findOne = async () => { throw new Error('database unavailable'); };
  await assert.rejects(h.get(), /database unavailable/);
});

test('dashboard, preview and export use nonblocking ratings and reject obsolete results', async () => {
  const { handler, state, service } = await setup();
  const { ratingKey } = require('../lib/rating');
  state.ledger = [];
  state.ratingBaselines = { 2: { rating: 1400 } };
  service.replay = async (snapshot, options) => {
    assert.equal(options.wait, false);
    return { status: 'computing', version: ratingKey(snapshot), ratings: {}, ledger: [] };
  };
  let request = handler('cf_training_api'); await request.get();
  assert.equal(request.response.body.result.ratingStatus, 'computing');
  assert.equal(request.response.body.result.accounts[0].rating, null);
  request = handler('cf_training_api', bit, { action: 'export' }); await request.get();
  assert.equal(request.response.body.ok, false); assert.match(request.response.body.error, /正在计算/);
  service.preview = async (_, id, options) => {
    assert.equal(options.wait, false); assert.equal(id, 'a');
    return { ratingStatus: 'computing', token: null };
  };
  request = handler('cf_training_api', bit, { action: 'preview', id: 'a' }); await request.get();
  assert.equal(request.response.body.result.token, null);
  service.replay = async snapshot => {
    const version = ratingKey(snapshot);
    state.ratingBaselines[2].rating++;
    return { status: 'ready', version, ratings: { 2: 1400 }, ledger: [] };
  };
  for (const action of ['dashboard', 'export']) {
    request = handler('cf_training_api', bit, { action }); await request.get();
    assert.equal(request.response.body.ok, false); assert.match(request.response.body.error, /Rating 已变化/);
  }
  service.replay = async snapshot => ({ status: 'ready', version: ratingKey(snapshot), ratings: { 2: 1500, 3: 1600 },
    ledger: [{ runId: 'a', changes: [{ uid: 2 }, { uid: 3 }] }] });
  request = handler('cf_training_api'); await request.get();
  assert.deepEqual(request.response.body.result.accounts.map(a => a.uid), [2]);
  assert.deepEqual(request.response.body.result.ledger[0].changes.map(a => a.uid), [2]);
});
test('student run JSON whitelists every nesting level before, during and after a contest', async () => {
  const { handler, state, service } = await setup();
  const secret = 'PRIVATE-EXPOSURE-AUDIT';
  const row = uid => ({ uid, handle: `student${uid}`, rank: uid - 1, points: 500, penalty: 0,
    complete: true, reason: uid === 2 ? '教练设为练习' : '已有接触记录', completionIssues: [],
    bindingId: secret, history: { touched: [secret], corrections: [{ reason: secret }] },
    scanProof: { bindingId: secret }, futureInternal: secret,
    problems: [{ index: 'A', solved: true, points: 500, submissionId: 99, futureInternal: secret }] });
  const run = { id: 'run', title: 'Training', status: 'published', startAt: Date.now() + 60000,
    durationSeconds: 3600, rated: true, attendees: [2, 3],
    rules: { type: 'CF', decayMinutes: 300, wrongPenalty: 25, minimumFraction: 0.3,
      icpcPenalty: 15, version: secret, futureInternal: secret },
    members: [2, 3].map(uid => ({ uid, handle: `student${uid}`, bindingId: secret })),
    slots: [{ index: 'A', points: 500, original: { contestId: 99, index: 'B' },
      actual: { contestId: 100, index: 'A', name: 'Actual problem', futureInternal: secret } }],
    screening: [{ uid: 3, touched: [secret], accepted: [secret], attended: true }],
    edits: [{ actor: 1, at: 1, reason: secret }], exposureEvidence: { 3: [secret] },
    exposureCorrections: [{ uid: 3, reason: secret }], snapshot: secret, configHash: secret,
    createdBy: 1, futureInternal: secret };
  state.runs = [run];
  const internal = { run, rows: [row(2), row(3)], absent: [row(4)], complete: true, futureInternal: secret };
  service.result = async (domainId, id) => {
    assert.equal(domainId, 'test'); assert.equal(id, 'run');
    return structuredClone(internal);
  };
  const read = async (perm = 0n) => {
    const h = handler('cf_training_api', perm, { action: 'run', id: 'run', uid: 3, isCoach: true });
    await h.prepare(); await h.get();
    assert.equal(h.response.body.ok, true);
    return JSON.parse(JSON.stringify(h.response.body.result));
  };
  const before = await read();
  assert.equal(before.hidden, true); assert.deepEqual(before.run.attendees, [2]);
  assert.equal(before.run.slots, undefined); assert.deepEqual(before.rows, []);
  const publicRules = { type: 'CF', decayMinutes: 300, wrongPenalty: 25, minimumFraction: 0.3 };
  assert.deepEqual(before.run.rules, publicRules);
  assert.doesNotMatch(JSON.stringify(before), /PRIVATE-EXPOSURE-AUDIT|futureInternal/);
  for (const phase of ['published', 'settled']) {
    run.startAt = Date.now() - 60000; run.status = phase;
    if (phase === 'settled') {
      state.ledger = [{ runId: 'run', scoreSnapshot: internal.rows }];
      // Exercise the real service's frozen scoreSnapshot path, including legacy nested fields.
      const { TrainingService } = require('../lib/service');
      service.result = TrainingService.prototype.result.bind(service);
    }
    const snapshot = JSON.stringify(state);
    for (const delegated of [false, true]) {
      state.groups[0].ownerId = 1; state.groups[0].adminIds = delegated ? [2] : [];
      const body = await read();
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE-EXPOSURE-AUDIT|bindingId|screening|history|scanProof|corrections|futureInternal|submissionId/);
      assert.deepEqual(Object.keys(body).sort(), ['absent', 'hidden', 'rows', 'run']);
      assert.deepEqual(Object.keys(body.run).sort(), ['attendees', 'durationSeconds', 'id', 'rated', 'rules', 'slots', 'startAt', 'status', 'title']);
      assert.deepEqual(body.run.rules, publicRules);
      assert.deepEqual(body.run.attendees, [2]);
      assert.deepEqual(body.run.slots, [{ index: 'A', points: 500, actual: { contestId: 100, index: 'A', name: 'Actual problem' } }]);
      assert.deepEqual(body.rows[0], { uid: 2, handle: 'student2', rank: 1, points: 500, penalty: 0,
        complete: true, problems: [{ index: 'A', solved: true, points: 500 }], reason: '教练设为练习', completionIssues: [] });
      assert.deepEqual(body.rows[1], { uid: 3, handle: 'student3', rank: 2, points: 500, penalty: 0,
        complete: true, problems: [{ index: 'A', solved: true, points: 500 }] });
      assert.deepEqual(body.absent, []);
    }
    const coach = await read(bit);
    assert.deepEqual(coach.run.screening, run.screening);
    assert.equal(coach.rows[1].history.corrections[0].reason, secret);
    assert.equal(coach.run.exposureCorrections[0].reason, secret);
    assert.equal(JSON.stringify(state.runs), JSON.stringify(JSON.parse(snapshot).runs), 'projection never edits persisted runs');
  }
});

test('public scoring rules include only numeric parameters for the selected scoring type', () => {
  const { studentRunResponse } = require('../lib/student-response');
  const run = { attendees: [], startAt: Date.now() + 60000,
    rules: { type: 'ICPC', icpcPenalty: 20, decayMinutes: 250, futureInternal: 'SECRET' } };
  assert.deepEqual(studentRunResponse({ run }, 2).run.rules, { type: 'ICPC', icpcPenalty: 20 });
  run.rules = { type: 'CF', decayMinutes: 'SECRET', wrongPenalty: Infinity, minimumFraction: 0.3 };
  assert.deepEqual(studentRunResponse({ run }, 2).run.rules, { type: 'CF', minimumFraction: 0.3 });
  delete run.rules;
  assert.equal(studentRunResponse({ run }, 2).run.rules, undefined);
});

test('dashboard job labels identify targets without mixing bindings or broadening student access', async () => {
  const { handler, state, service } = await setup();
  state.accounts = [{ uid: 2, handle: 'CurrentHandle', bindingId: 'new-binding' },
    { uid: 3, handle: 'OtherStudent', bindingId: 'other-binding' }];
  const jobs = [
    { _id: 'own', kind: 'sync', payload: { uid: 2, bindingId: 'new-binding', secret: 'SECRET' }, status: 'running', updatedAt: 1000 },
    { _id: 'old', kind: 'sync', payload: { uid: 2, bindingId: 'old-binding' }, status: 'done', updatedAt: 900 },
    { _id: 'removed', kind: 'sync', payload: { uid: 4, bindingId: 'removed-binding' }, status: 'failed', updatedAt: 800 },
    { _id: 'other', kind: 'sync', payload: { uid: 3, bindingId: 'other-binding' }, status: 'done', updatedAt: 700 },
    { _id: 'import', kind: 'import', payload: { contestId: 1919, secret: 'SECRET' }, status: 'done', updatedAt: 600 },
    { _id: 'catalog', kind: 'catalog', payload: {}, status: 'done', updatedAt: 500 },
    { _id: 'legacy', kind: 'sync', status: 'failed' },
  ];
  let query;
  service.jobs.find = value => {
    query = JSON.parse(JSON.stringify(value));
    return { sort: () => ({ limit: () => ({ toArray: async () => jobs }) }) };
  };
  const student = handler('cf_training_api'); await student.get();
  assert.deepEqual(query, { domainId: 'test', kind: 'sync', 'payload.uid': 2 });
  const visible = JSON.parse(JSON.stringify(student.response.body.result.jobs));
  assert.deepEqual(visible.map(j => j.id), ['own', 'old']);
  assert.equal(visible[0].target, '学生 UID 2 · CurrentHandle');
  assert.equal(visible[0].updatedAt, 1000);
  assert.match(visible[1].target, /历史绑定或账号已移除/);
  assert.doesNotMatch(JSON.stringify(visible), /SECRET|OtherStudent|new-binding|old-binding|payload/);
  const coach = handler('cf_training_api', bit); await coach.get();
  assert.deepEqual(query, { domainId: 'test' });
  const all = coach.response.body.result.jobs;
  assert.equal(all[2].target, '学生 UID 4 · 历史绑定或账号已移除');
  assert.equal(all[4].target, 'CF 比赛 1919');
  assert.equal(all[5].target, 'CF 比赛与题库');
  assert.equal(all[6].target, '目标信息不可用');
  assert.equal(all[6].updatedAt, null);
});

test('run membership and domain checks cannot be bypassed by uid or class authority', async () => {
  const { handler, state, service, ForbiddenError } = await setup();
  const run = { id: 'run', status: 'published', startAt: Date.now() + 60000,
    attendees: [], members: [{ uid: 3 }] };
  state.runs = [run]; state.groups[0].adminIds = [2];
  service.result = async () => { throw new Error('unauthorized result read'); };
  const request = args => handler('cf_training_api', 0n, { action: 'run', id: 'run', uid: 3, ...args });
  await assert.rejects(request().get(), ForbiddenError);
  await assert.rejects(request({ domainId: 'other' }).prepare(), ForbiddenError);
  run.members.push({ uid: 2 }); run.status = 'draft';
  await assert.rejects(request().get(), ForbiddenError);
  run.status = 'published';
  const attend = handler('cf_training_api', 0n, { action: 'attend', id: 'run', uid: 3 });
  await attend.prepare(); await attend.post();
  assert.equal(attend.response.body.ok, true); assert.deepEqual(state.runs[0].attendees, [2]);
  const h = request(); await h.prepare(); await h.get();
  assert.deepEqual(Array.from(h.response.body.result.run.attendees), [2]);
});

test('role routing, page denial, login and domain boundaries',async()=>{
 const {handler,ForbiddenError}=await setup();
 for(const [perm,target] of [[0n,'student'],[1n<<50n,'student'],[bit,'coach'],[-1n,'coach']]){
  const h=handler('cf_training',perm);await h.get();assert.equal(h.response.redirect,'/d/test/cf_training_'+target);
 }
 const student=handler('cf_training_student');await student.get();assert.equal(student.response.body.cfCoach,false);
 const coach=handler('cf_training_coach',bit);await coach.get();assert.equal(coach.response.body.cfCoach,true);
 await assert.rejects(handler('cf_training_coach').get(),ForbiddenError);
 await assert.rejects(handler('cf_training_coach',1n<<50n).get(),ForbiddenError);
 const revoked=handler('cf_training_coach',bit);revoked.user.hasPerm=()=>false;await assert.rejects(revoked.get(),ForbiddenError);
 await assert.rejects(handler('cf_training_student',0n,{domainId:'other'}).get(),ForbiddenError);
 const guest=handler('cf_training');guest.user._id=0;await assert.rejects(guest.get(),ForbiddenError);
});
test('unassigned users cannot manage training or classes; dashboard is scoped',async()=>{
 const {handler,ForbiddenError,calls}=await setup();
 for(const perm of [0n,1n<<50n]){
  for(const action of ['discover','replacements','preview','export']) await assert.rejects(handler('cf_training_api',perm,{action}).get(),ForbiddenError);
  for(const action of ['rebind','approve','catalog','import','group','delete_group','create','replace','practice','publish','cancel_draft','reschedule_draft','refresh_run','settle','void','correct_exposure']) await assert.rejects(handler('cf_training_api',perm,{action}).post(),ForbiddenError);
  await assert.rejects(handler('cf_training_api',perm,{action:'sync',uid:3}).post(),ForbiddenError);
 }
 assert.equal(calls.length,0);
 const authorized=handler('cf_training_api',bit,{action:'catalog'});await authorized.post();assert.equal(calls.length,1);
 for(const [perm,count] of [[0n,1],[bit,2]]){
  const h=handler('cf_training_api',perm);await h.prepare();await h.get();assert.equal(h.response.body.result.accounts.length,count);
 }
 await assert.rejects(handler('cf_training_api',bit,{domainId:'other'}).prepare(),ForbiddenError);
 const bad=handler('cf_training_api',bit,{action:'catalog'});bad.request.headers={};await assert.rejects(bad.post(),ForbiddenError);
});

test('coach can cancel and reschedule drafts with audit, while terminal states reject edits', async () => {
  const { handler, state, ForbiddenError } = await setup();
  const startAt = Date.now() - 86400_000;
  const future = Date.now() + 86400_000;
  const run = { id:'old', title:'Old draft', status:'draft', startAt, members:[{uid:2}],
    slots:[{index:'A', original:{contestId:2000,index:'A'}, actual:{contestId:2000,index:'A'}}], attendees:[], screening:[{uid:2}], configHash:'stale' };
  state.runs = [run];
  const post = async (action, id = 'old', extra = {}) => {
    const h = handler('cf_training_api', bit, { action, id, ...extra });
    await h.post(); return h.response.body;
  };
  assert.equal((await post('reschedule_draft','old',{startAt:new Date(future).toISOString()})).ok,true);
  assert.equal(state.runs[0].startAt,future);
  assert.deepEqual(state.runs[0].members,run.members);
  assert.deepEqual(state.runs[0].slots,run.slots);
  assert.equal(state.runs[0].screening,undefined);
  assert.equal(state.runs[0].configHash,undefined);
  assert.equal(state.audit[0].action,'reschedule_draft');
  assert.equal((await post('cancel_draft')).ok,true);
  assert.equal(state.runs[0].status,'cancelled');
  assert.equal(state.audit[1].actor,2);
  assert.equal(state.audit[1].action,'cancel_draft');
  assert.equal((await post('cancel_draft')).ok,true);
  assert.equal(state.audit.length,2);
  const coachList = handler('cf_training_api', bit); await coachList.get();
  assert.equal(coachList.response.body.ok, true, coachList.response.body.error);
  assert.equal(coachList.response.body.result.runs[0].status, 'cancelled');
  const studentList = handler('cf_training_api'); await studentList.get();
  assert.equal(studentList.response.body.ok, true, studentList.response.body.error);
  assert.deepEqual(studentList.response.body.result.runs, []);
  const archived = handler('cf_training_api', bit, {action:'run',id:'old'}); await archived.get();
  assert.equal(archived.response.body.result.run.cancelledBy, 2);
  await assert.rejects(handler('cf_training_api', 0n, {action:'run',id:'old'}).get(), ForbiddenError);
  for (const action of ['reschedule_draft','publish','practice','refresh_run']) {
    assert.equal((await post(action,'old',{startAt:new Date(future).toISOString()})).ok,false,action);
  }
  state.runs.push({...run,id:'published',status:'published'}, {...run,id:'settled',status:'settled'});
  for (const id of ['published','settled']) {
    assert.equal((await post('cancel_draft',id)).ok,false);
    assert.equal((await post('reschedule_draft',id,{startAt:new Date(future).toISOString()})).ok,false);
  }
});

test('publishing a rescheduled draft performs fresh screening', async () => {
  const { handler, state, service } = await setup();
  const run = { id:'draft', title:'Draft', status:'draft', rated:false, contestId:2000,
    startAt:Date.now() - 1000, members:[{uid:2,handle:'student',bindingId:'binding'}], attendees:[],
    slots:[{index:'A',original:{contestId:2000,index:'A'},actual:{contestId:2001,index:'B'}}],
    rules:{}, screening:[{uid:2,unknown:true}] };
  state.runs = [run];
  const checks = [{uid:2,unknown:false,touched:[]}];
  let screened = 0;
  service.screening = async () => { screened++; return checks; };
  const future = Date.now() + 86400_000;
  let h = handler('cf_training_api',bit,{action:'reschedule_draft',id:'draft',startAt:new Date(future).toISOString()});
  await h.post(); assert.equal(h.response.body.ok,true);
  assert.equal(state.runs[0].screening,undefined);
  h = handler('cf_training_api',bit,{action:'publish',id:'draft'});
  await h.post(); assert.equal(h.response.body.ok,true,h.response.body.error);
  assert.equal(screened,1);
  assert.equal(state.runs[0].status,'published');
  assert.deepEqual(state.runs[0].screening,checks);
  assert.equal(state.runs[0].configHash.length > 0,true);
});

test('student history and manual notices stay private; an owner can delete their saved class', async () => {
  const {handler,state}=await setup();
  const problems=handler('cf_training_api',0n,{action:'problems',uid:3});
  await problems.get();
  assert.equal(problems.response.body.result.owner,2);
  const dashboard=handler('cf_training_api');
  await dashboard.get();
  assert.deepEqual(dashboard.response.body.result.notices.map(n=>n.key),['2000/A']);
  await handler('cf_training_api',0n,{action:'unsee',kind:'problem',value:'2001/B'}).post();
  assert.deepEqual(state.notices.map(n=>n.key),['2000/A','2001/B']);
  await handler('cf_training_api',0n,{action:'unsee',kind:'problem',value:'2000/A'}).post();
  assert.deepEqual(state.notices.map(n=>n.key),['2001/B']);
  await handler('cf_training_api',0n,{action:'seen',kind:'contest',value:'2002'}).post();
  assert.deepEqual(state.notices.map(n=>n.key),['2001/B','contest:2002']);
  await handler('cf_training_api',0n,{action:'unsee',kind:'contest',value:'2002'}).post();
  assert.deepEqual(state.notices.map(n=>n.key),['2001/B']);
  state.runs.push({id:'existing-run',members:[{uid:2}]});
  const deleted=handler('cf_training_api',bit,{action:'delete_group',id:'class'});
  await deleted.post();
  assert.equal(deleted.response.body.ok,true);
  assert.deepEqual(state.groups,[]);
  assert.equal(state.accounts.length,2);
  assert.equal(state.runs[0].id,'existing-run');
});

test('problem statistics are read-only and always scoped to the authenticated student', async () => {
  const {handler,ForbiddenError}=await setup();
  const stats=handler('cf_training_api',0n,{action:'problem_stats',uid:3,handle:'other',status:'attempted',page:99});
  await stats.get();
  assert.equal(stats.response.body.ok,true);
  assert.equal(stats.response.body.result.owner,2);
  assert.equal(stats.response.body.result.solvedTotal,0);
  const crossed=handler('cf_training_api',0n,{action:'problem_stats',domainId:'other'});
  await assert.rejects(crossed.prepare(),ForbiddenError);
  const guest=handler('cf_training_api',0n,{action:'problem_stats'});
  guest.user._id=0;
  await assert.rejects(guest.prepare(),ForbiddenError);
});

test('seen/unsee preserves per-run facts before start, including delete/re-add and legacy notices', async () => {
  const { handler, state } = await setup();
  state.accounts[0].bindingId = 'binding';
  const makeRun = (id, startAt, status = 'published') => ({ id, startAt, status, contestId: 2000,
    slots: [{ actual: { contestId: 2000, index: 'A' } }], members: [{ uid: 2, bindingId: 'binding' }] });
  state.runs = [makeRun('published', Date.now() + 60000), makeRun('draft', Date.now() + 60000, 'draft'),
    makeRun('started', Date.now() - 60000)];
  // A notice already present when upgrading must be captured before deletion.
  await handler('cf_training_api', 0n, { action: 'unsee', kind: 'problem', value: '2000/A' }).post();
  assert.equal(state.runs[0].exposureEvidence[2][0].id, 'notice:2000/A');
  assert.equal(state.runs[0].exposureEvidence[2][0].occurredAt, 1);
  assert.equal(state.runs[1].exposureEvidence, undefined);
  for (const action of ['seen', 'unsee', 'seen']) {
    const request = handler('cf_training_api', 0n, { action, kind: 'contest', value: '2000' });
    await request.post(); assert.equal(request.response.body.ok, true);
  }
  assert.equal(state.runs[0].exposureEvidence[2].filter(e => e.id === 'notice:contest:2000').length, 1);
  assert(!state.runs[2].exposureEvidence[2].some(e => e.id === 'notice:contest:2000'), 'new notices at/after start do not establish pre-start contact');
  assert(state.notices.some(n => n.uid === 3), 'another student history is untouched');
});

test('coach correction API requires a reason and forwards authenticated actor, scoped evidence and uid', async () => {
  const { handler, service } = await setup();
  const calls = [];
  service.correctExposure = async (...args) => calls.push(args);
  const args = { action: 'correct_exposure', id: 'run', uid: 3, evidenceIds: ['notice:2000/A'], actor: 999 };
  const blank = handler('cf_training_api', bit, { ...args, reason: '  ' }); await blank.post();
  assert.equal(blank.response.body.ok, false); assert.equal(calls.length, 0);
  const allowed = handler('cf_training_api', bit, { ...args, reason: '核实为误报' }); await allowed.post();
  assert.equal(allowed.response.body.ok, true);
  assert.deepEqual(calls[0], ['test', 'run', 3, ['notice:2000/A'], '核实为误报', 2]);
});

test('class authority is scoped, delegated students keep private dashboards, and bulk writes are atomic', async () => {
  const {handler,state,ForbiddenError}=await setup();
  const post = async (actor, perm, args) => {
    const h=handler('cf_training_api',perm,args);h.user._id=actor;await h.post();return h.response.body;
  };
  state.groups.push({id:'other',name:'Other',uids:[3],ownerId:4,adminIds:[]});
  await assert.rejects(post(3,bit,{action:'delete_group',id:'class'}),ForbiddenError);
  await assert.rejects(post(3,bit,{action:'group',id:'class',version:0,name:'stolen',uids:[]}),ForbiddenError);
  assert.equal((await post(2,bit,{action:'group_admin',id:'class',uid:3,mode:'add'})).ok,true);
  const dashboard=handler('cf_training_api');dashboard.user._id=3;await dashboard.get();
  assert.equal(dashboard.response.body.result.isCoach,false);
  assert.equal(dashboard.response.body.result.accounts.length,1);
  assert.equal(dashboard.response.body.result.groups.find(g=>g.id==='class').canManage,true);
  for(const action of ['delete_group','group_admin','group_transfer','group_claim','correct_exposure']) {
    await assert.rejects(post(3,0n,{action,id:'class',uid:4,mode:'add'}),ForbiddenError);
  }
  const original=structuredClone(state.groups);
  await assert.rejects(post(3,0n,{action:'group_members',ids:['class','other'],uids:[3],mode:'add'}),ForbiddenError);
  assert.deepEqual(state.groups,original);
  assert.equal((await post(3,0n,{action:'group',id:'class',version:1,name:'Renamed',uids:[2,3]})).ok,true);
  assert.equal(state.groups[0].name,'Renamed');
  assert.equal((await post(2,bit,{action:'group',id:'class',version:1,name:'stale',uids:[]})).ok,false);
  await post(2,bit,{action:'group_admin',id:'class',uid:3,mode:'remove'});
  await assert.rejects(post(3,0n,{action:'group_members',ids:['class'],uids:[3],mode:'remove'}),ForbiddenError);
  const badTarget=await post(2,bit,{action:'group_admin',id:'class',uid:5,mode:'add'});
  assert.equal(badTarget.ok,false,'a global user outside the domain cannot be granted authority');
  assert.equal((await post(2,bit,{action:'group_admin',id:'class',uid:99,mode:'add'})).ok,false);
  state.groups[0].adminIds.push(99);
  assert.equal((await post(2,bit,{action:'group_admin',id:'class',uid:99,mode:'remove'})).ok,true);
  assert(!state.groups[0].adminIds.includes(99),'departed or deleted users can still have delegation revoked');
  await post(4,bit,{action:'group_admin',id:'other',uid:2,mode:'add'});
  assert.equal((await post(2,bit,{action:'group_members',ids:['class','other'],uids:[2,3],mode:'add'})).ok,true);
  for(const group of state.groups) assert.deepEqual([...group.uids].sort(),[2,3]);
});

test('transfers require current invitation acceptance; legacy groups require domain-admin assignment',async()=>{
  const {handler,state,ForbiddenError}=await setup();
  const post=async(actor,perm,args)=>{const h=handler('cf_training_api',perm,args);h.user._id=actor;await h.post();return h.response.body;};
  await post(2,bit,{action:'group_transfer',id:'class',uid:3});
  const stale=state.groups[0].transfer.id;
  await post(2,bit,{action:'group_transfer',id:'class',uid:4});
  await assert.rejects(post(3,0n,{action:'group_transfer_accept',id:'class',transferId:stale}),ForbiddenError);
  const transferId=state.groups[0].transfer.id;
  await assert.rejects(post(2,bit,{action:'group_transfer_accept',id:'class',transferId}),ForbiddenError);
  const inbox=handler('cf_training_api');inbox.user._id=4;await inbox.get();
  const invitation=inbox.response.body.result.groups[0];
  assert.equal(invitation.transfer.id,transferId);assert.equal(invitation.uids.length,0);
  assert.equal((await post(4,0n,{action:'group_transfer_accept',id:'class',transferId})).ok,true);
  assert.equal(state.groups[0].ownerId,4);assert.deepEqual(state.groups[0].adminIds,[2]);
  await assert.rejects(post(4,0n,{action:'group_transfer_accept',id:'class',transferId}),ForbiddenError);
  await assert.rejects(post(2,bit,{action:'delete_group',id:'class'}),ForbiddenError);
  await post(4,0n,{action:'group_transfer',id:'class',uid:3});
  await post(3,0n,{action:'group_transfer_reject',id:'class',transferId:state.groups[0].transfer.id});
  assert.equal(state.groups[0].ownerId,4);assert.equal(state.groups[0].transfer,undefined);
  state.groups.push({id:'legacy',name:'Old class',uids:[2]});
  await assert.rejects(post(2,bit,{action:'delete_group',id:'legacy'}),ForbiddenError);
  assert.equal((await post(1,2n,{action:'group_claim',id:'legacy',uid:2})).ok,true);
  assert.equal(state.groups[1].ownerId,2);
  await post(2,bit,{action:'delete_group',id:'legacy'});
  assert.equal(state.groups.length,1);
});
