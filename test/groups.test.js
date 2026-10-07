'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TrainingService } = require('../lib/service');
const { GroupAccessDenied, changeGroup } = require('../lib/groups');

test('empty classes can be created and edited; over-capacity batch writes preserve every roster',async()=>{
  let state={accounts:Array.from({length:101},(_,i)=>({uid:i+1})),groups:[]};
  const auth={actor:200,coach:true,root:false,validateUser:async()=>{}};
  const apply=async a=>{const next=structuredClone(state);const result=await changeGroup(next,a,auth);state=next;return result;};
  const created=await apply({action:'group',name:'Empty',uids:[]});
  assert.equal(state.groups[0].ownerId,200);assert.deepEqual(state.groups[0].uids,[]);
  await apply({action:'group',id:created.id,version:1,name:'Renamed',uids:[1]});
  assert.equal(state.groups.length,1);assert.equal(state.groups[0].name,'Renamed');
  state.groups.push({id:'full',ownerId:200,name:'Full',uids:Array.from({length:100},(_,i)=>i+1)});
  const before=structuredClone(state);
  await assert.rejects(apply({action:'group_members',ids:[created.id,'full'],uids:[101],mode:'add'}),/100/);
  assert.deepEqual(state,before);
});

function fixture(onRead = () => {}) {
  const state = {groups:[{id:'g',name:'Class',ownerId:1,uids:[2,3,4,5],adminIds:[6]}],
    accounts:[2,3,4,5].map(uid=>({uid,bindingId:`b${uid}`,handle:`h${uid}`,historyComplete:uid!==3,status:uid===3?'syncing':'ready'}))};
  const submissions = [
    {account:'b2',data:{verdict:'OK',problem:{contestId:1,index:'A'}}},
    {account:'b2',data:{verdict:'OK',problem:{contestId:1,index:'a'}}},
    {account:'b2',data:{verdict:'OK',contestId:100001,problem:{index:'B'}}},
    {account:'b2',data:{verdict:'WRONG_ANSWER',problem:{contestId:1,index:'C'}}},
    {account:'b3',data:{verdict:'OK',problem:{contestId:2,index:'A'}}},
    {account:'old-binding',data:{verdict:'OK',problem:{contestId:2,index:'A'}}},
    {account:'b2',data:{verdict:'OK',problem:{contestId:1,index:'???'}}},
  ];
  const service = new TrainingService({collection:()=>({})});
  service.state=async()=>structuredClone(state);
  service.replay=async()=>({ratings:{2:1500,3:1500,4:1600},ledger:[]});
  service.records={find(query,options){
    assert.equal(query['data.verdict'],'OK');assert.equal(options.projection['data.problem.index'],1);
    return (async function*(){for(const r of submissions)if(query.account.$in.includes(r.account)&&r.data.verdict==='OK')yield r;onRead(state);})();
  }};
  return {service,state};
}
test('class ranking uses shared rating, ties, missing baseline and current-account AC deduplication',async()=>{
  const {service}=fixture();
  const result=await service.groupLeaderboard('d','g',2);
  assert.deepEqual(result.rows.map(r=>[r.uid,r.rating,r.rank,r.solvedTotal]),[[4,1600,1,0],[2,1500,2,2],[3,1500,2,1],[5,null,null,0]]);
  assert.equal(result.rows[2].historyComplete,false);
  await service.groupLeaderboard('d','g',6);
  await service.groupLeaderboard('d','g',99,true);
  await assert.rejects(service.groupLeaderboard('d','g',99),GroupAccessDenied);
  await assert.rejects(service.groupLeaderboard('d','missing',2),GroupAccessDenied);
});
test('ranking never returns stale private data after membership removal, delegation revocation or rebinding',async()=>{
  for(const [actor,change,error] of [
    [2,s=>{s.groups[0].uids=[3];},GroupAccessDenied],
    [6,s=>{s.groups[0].adminIds=[];},GroupAccessDenied],
    [2,s=>{s.accounts[0].bindingId='new';},/账号已变更/],
    [2,s=>{s.groups=[];},GroupAccessDenied],
  ]) {const {service}=fixture(change);await assert.rejects(service.groupLeaderboard('d','g',actor),error);}
});

test('cached rating response still rechecks class authorization after the rating read', async () => {
  const { service, state } = fixture();
  const replay = service.replay;
  service.replay = async (...args) => {
    const report = await replay(...args);
    state.groups[0].adminIds = [];
    return { ...report, status: 'ready' };
  };
  await assert.rejects(service.groupLeaderboard('d', 'g', 6), GroupAccessDenied);
});
