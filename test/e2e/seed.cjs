const fs = require('node:fs');
module.exports = async () => {
  const { db } = require('hydrooj');
  const { TrainingService } = require('/root/.hydro/addons/cf-training/lib/service');
  const { rules } = require('/root/.hydro/addons/cf-training/lib/core');
  const cfg = JSON.parse(fs.readFileSync('/tmp/cf-training-e2e.json'));
  const svc = new TrainingService(db);
  if (!/^cftrain-e2e-[a-f0-9]+$/.test(cfg.domain)) throw new Error('Not a test domain');
  await svc.states.deleteOne({_id:cfg.domain});
  await svc.jobs.deleteMany({domainId:cfg.domain});
  await svc.records.deleteMany({account:cfg.domain+'-binding'});
  const snapshot = cfg.domain + '-snapshot';
  await svc.refs.deleteMany({$or:[{_id:snapshot},{snapshot}]});
  await svc.catalog.deleteMany({_id:{$in:['contest:99001','problem:99001/A','problem:99002/A']},'data.name':'AUTOMATED TEST FIXTURE'});
  const original = {contestId:99001,index:'A',name:'AUTOMATED TEST FIXTURE',rating:800,points:500};
  const replacement = {...original,contestId:99002};
  const slots = [{index:'A',original,actual:original,points:500}];
  const contest = {id:99001,name:'AUTOMATED TEST FIXTURE',type:'CF',phase:'FINISHED',durationSeconds:7200};
  await svc.refs.insertMany([{_id:snapshot,contest,slots,warnings:['Synthetic test fixture'],contestId:99001},
    {_id:snapshot+':0',snapshot,rows:[{points:500,penalty:0,rating:1800},{points:100,penalty:0,rating:1400},{points:0,penalty:0,rating:1000}]}]);
  await svc.catalog.insertMany([{_id:'contest:99001',kind:'contest',data:contest,problems:[original],snapshot},
    {_id:'problem:99001/A',kind:'problem',data:original},{_id:'problem:99002/A',kind:'problem',data:replacement}]);
  const binding = cfg.domain + '-binding';
  await svc.change(cfg.domain, s => {
    s.ratingBaselines = { [cfg.studentId]: { rating: 1600, source: 'cf', handle: 'fixture_student', at: Date.now() } };
    s.accounts.push({uid:cfg.studentId,handle:'fixture_student',bindingId:binding,approved:true,verified:true,
      historyComplete:false,status:'queued',lastSyncAt:0,ratingHistory:[],scanned:0});
    s.runs.push({id:'past-run',title:'AUTOMATED TEST: past run',contestId:99001,snapshot,
      startAt:Date.now()-5*3600000,durationSeconds:7200,rules:rules('CF'),slots,
      warnings:['Synthetic test fixture'],rated:true,status:'published',
      members:[{uid:cfg.studentId,handle:'fixture_student',bindingId:binding}],attendees:[cfg.studentId]});
  });
  const run = (await svc.state(cfg.domain)).runs[0];
  const submissions = [{id:2,contestId:99003,
    creationTimeSeconds:Math.floor(run.startAt/1000)+180,
    problem:{contestId:99003,index:'B',name:'AUTOMATED TEST: attempted'},verdict:'COMPILATION_ERROR',
    author:{members:[{handle:'fixture_student'}],participantType:'PRACTICE'}},
  {id:1,contestId:99001,
    creationTimeSeconds:Math.floor(run.startAt/1000)+120,problem:original,verdict:'OK',
    author:{members:[{handle:'fixture_student'}],participantType:'PRACTICE'}}];
  svc.client = {call: async method => method === 'user.rating' ? [] : method === 'user.status' ? submissions : []};
  await svc.syncPage(cfg.domain, {uid:cfg.studentId,bindingId:binding,since:run.startAt/1000});
  return {seeded:true,domain:cfg.domain};
};

