'use strict';
// Constructed users only: exercise real templates and class mutations without a running Hydro.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { template } = require('./ui.cjs');
const groups = require('../../lib/groups');
(async () => {
  const browser = await chromium.launch({headless:true,channel:'msedge'});
  const errors=[];
  let state={accounts:[{uid:2},{uid:3}],groups:[
    {id:'g',name:'提高班',uids:[2],ownerId:7,adminIds:[],version:0},
    {id:'h',name:'竞赛班',uids:[2],ownerId:7,adminIds:[],version:0}],audit:[]};
  const posts=[];
  let delay=false,held;
  const respond=(route,result)=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,result})});
  async function pageFor(uid,isCoach) {
    const page=await browser.newPage({viewport:{width:1280,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',async d=>{if(d.type()==='alert')errors.push(d.message());await d.accept();});
    await page.route('http://classes.test/',route=>route.fulfill({contentType:'text/html',body:template(isCoach)}));
    await page.route('http://classes.test/api**',async route=>{
      const req=route.request(),a=req.method()==='POST'?req.postDataJSON():Object.fromEntries(new URL(req.url()).searchParams);
      if(a.action==='dashboard')return respond(route,{isCoach,uid,accounts:isCoach?[{uid:2,handle:'Student2',approved:true},{uid:3,handle:'Student3',approved:true}]:[],people:[2,3,7].map(uid=>({uid,uname:`User${uid}`})),notices:[],runs:[],ledger:[],jobs:[],
        groups:state.groups.filter(g=>groups.sees(g,uid)||g.transfer?.to===uid).map(g=>groups.view(g,uid,false))});
      if(a.action==='group_user') {
        if(![2,3,7].includes(Number(a.uid)))return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:false,error:'请选择当前域内已加入的有效用户'})});
        return respond(route,{uid:Number(a.uid),uname:`User${a.uid}`});
      }
      if(a.action==='group_leaderboard') {
        if(delay && a.id==='g') {held=route;return;}
        return respond(route,{id:a.id,rows:[{uid:2,handle:a.id==='g'?'StudentG':'StudentH',rating:1600,rank:1,solvedTotal:12,historyComplete:false,status:'syncing'}]});
      }
      if(req.method()==='POST') {
        posts.push(a);
        try {const copy=structuredClone(state);const result=await groups.changeGroup(copy,a,{actor:uid,coach:isCoach,root:false,validateUser:async()=>{}});state=copy;return respond(route,result);}
        catch(e){return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:false,error:e.message})});}
      }
      throw new Error(`Unexpected action ${a.action}`);
    });
    await page.goto('http://classes.test/');
    await page.locator('[data-tab="classes"]').first().click();
    return page;
  }
  try {
    const coach=await pageFor(7,true);
    const output=path.resolve(__dirname,'../../.test-output');fs.mkdirSync(output,{recursive:true});
    assert.equal(await coach.locator('#ct-class-bulk').count(),0);
    assert.equal(await coach.locator('#ct-class-transfer').count(),0,'transfer fields are only in a dialog');
    await coach.locator('#ct-class-new').click();
    await coach.locator('#ct-class-dialog').waitFor({state:'visible'});
    await coach.locator('#ct-class-create input[name=name]').fill('新建班级演示');
    await coach.locator('#ct-class-create input[name=members]').fill('3');
    await coach.screenshot({path:path.join(output,'class-create.png'),fullPage:true});
    await coach.locator('#ct-class-create button:not([type])').click();
    await coach.locator('#ct-class-dialog').waitFor({state:'hidden'});
    await coach.waitForFunction(()=>document.querySelector('#ct-groups').selectedOptions[0].textContent.includes('新建班级演示'));
    assert.equal(state.groups.length,3);assert.deepEqual(state.groups[2].uids,[3]);
    await coach.locator('#ct-class-new').click();await coach.locator('[data-dialog-cancel]').click();
    assert.equal(state.groups.length,3,'cancel does not create a class');
    await coach.locator('#ct-groups').selectOption('g');
    await coach.locator('#ct-group input[name=name]').fill('提高班（更新）');
    await coach.locator('#ct-class-save').click();
    await coach.waitForFunction(()=>document.querySelector('#ct-groups').selectedOptions[0].textContent.includes('更新'));
    assert.equal(state.groups.length,3,'renaming must not create another class');
    assert.equal(posts.at(-1).action,'group_rename');assert.deepEqual(state.groups[0].uids,[2]);
    await coach.locator('[data-tab=coach]').click();
    await coach.locator('[data-select="2"]').check();await coach.locator('[data-select="3"]').check();
    await coach.locator('[data-tab=classes]').click();await coach.locator('#ct-groups').selectOption('h');
    await coach.locator('[data-tab=coach]').click();
    assert.equal(await coach.locator('[data-select="3"]').isChecked(),true,'switching classes preserves student selection');
    await coach.locator('#ct-add-to-classes').click();
    await coach.locator('#ct-class-bulk-form input[value=g]').check();await coach.locator('#ct-class-bulk-form input[value=h]').check();
    await coach.locator('#ct-class-bulk-form button:not([type])').click();
    await coach.locator('#ct-class-dialog').waitFor({state:'hidden'});
    assert(state.groups.slice(0,2).every(g=>g.uids.length===2));
    await coach.locator('[data-tab=classes]').click();await coach.locator('#ct-groups').selectOption('g');
    await coach.locator('[data-remove-member="3"]').click();await coach.getByText('学生已从当前班级移除',{exact:true}).waitFor();
    assert.deepEqual(state.groups[0].uids,[2]);assert.deepEqual(state.groups[1].uids,[2,3]);
    await coach.locator('#ct-class-members-add input').fill('3');await coach.locator('#ct-class-members-add button').click();
    await coach.locator('[data-remove-member="3"]').waitFor();
    await coach.locator('#ct-class-member-all').check();await coach.locator('#ct-class-remove-selected').click();
    await coach.locator('#ct-class-members table').waitFor({state:'detached'});assert.deepEqual(state.groups[0].uids,[]);
    await coach.locator('#ct-class-members-add input').fill('2,3');await coach.locator('#ct-class-members-add button').click();
    await coach.locator('[data-remove-member="3"]').waitFor();
    await coach.locator('#ct-class-admin input[name=uid]').fill('2');await coach.locator('#ct-class-admin button').click();
    await coach.locator('[data-remove-admin="2"]').waitFor();
    await coach.locator('[data-remove-admin="2"]').click();await coach.locator('[data-remove-admin="2"]').waitFor({state:'detached'});
    assert.deepEqual(state.groups[0].adminIds,[]);
    await coach.locator('#ct-class-admin input[name=uid]').fill('2');await coach.locator('#ct-class-admin button').click();
    await coach.locator('[data-remove-admin="2"]').waitFor();
    assert.match(await coach.locator('#ct-class-admins').textContent(),/User2/);
    await coach.screenshot({path:path.join(output,'classes-coach.png'),fullPage:true});
    const student=await pageFor(2,false);
    await student.locator('#ct-class-editor').waitFor({state:'visible'});
    assert.equal(await student.locator('#ct-class-owner form').count(),0);
    assert.equal(await student.locator('#ct-delete-group').isDisabled(),true);
    assert.equal(await student.locator('#ct-account').count(),1,'delegated managers retain their student page');
    await student.locator('#ct-groups').selectOption('h');
    await student.getByText('2 / StudentH（我）',{exact:true}).waitFor();
    await student.reload();await student.locator('[data-tab="classes"]').click();
    await student.waitForFunction(()=>document.querySelector('#ct-groups').value==='h');
    delay=true;
    await student.locator('#ct-groups').selectOption('g');
    await student.getByText('正在加载班级榜…',{exact:true}).waitFor();
    await student.locator('#ct-groups').selectOption('h');
    await student.getByText('2 / StudentH（我）',{exact:true}).waitFor();
    assert(held);
    await respond(held,{id:'g',rows:[{uid:2,handle:'StaleG',rating:1,rank:1,solvedTotal:0}]});
    await student.waitForFunction(()=>document.querySelector('#ct-class-board').textContent.includes('StudentH'));
    assert.equal(await student.getByText('StaleG',{exact:false}).count(),0);
    delay=false;
    await coach.locator('#ct-class-transfer-open').click();
    assert.equal(await coach.locator('#ct-transfer-confirm').isDisabled(),true);
    await coach.locator('#ct-transfer-lookup input').fill('99');await coach.locator('#ct-transfer-lookup button').click();
    await coach.locator('#ct-transfer-preview .ct-error').waitFor();
    assert.equal(await coach.locator('#ct-transfer-confirm').isDisabled(),true);
    await coach.locator('#ct-transfer-candidate').selectOption('2');
    await coach.locator('#ct-transfer-preview .ct-success').waitFor();
    await coach.screenshot({path:path.join(output,'class-transfer.png'),fullPage:true});
    await coach.locator('#ct-transfer-confirm').click();
    await coach.locator('#ct-class-dialog').waitFor({state:'hidden'});
    await coach.getByText('等待 User2（UID 2） 接收',{exact:false}).waitFor();
    await student.locator('#ct-refresh').click();
    await student.locator('[data-class-action=group_transfer_accept]').click();
    await student.getByText('班级权限已更新',{exact:true}).waitFor();
    assert.equal(state.groups[0].ownerId,2);assert(state.groups[0].adminIds.includes(7));
    await student.locator('#ct-groups').selectOption('g');
    await student.setViewportSize({width:375,height:1000});
    await student.locator('#ct-class-board table').waitFor();
    await student.screenshot({path:path.resolve(__dirname,'../../.test-output/classes-mobile.png'),fullPage:true});
    assert.equal(await student.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: creation dialog, isolated rename, student/admin lists and removal, multi-class selection dialog, preserved selections, recipient lookup, transfer acceptance, saved class, stale response isolation and mobile layout');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
