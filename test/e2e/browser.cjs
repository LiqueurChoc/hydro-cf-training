const {chromium} = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const cfg = JSON.parse(fs.readFileSync(process.env.CFTRAIN_E2E_CONFIG || __dirname+'/../../.test-output/session.json','utf8').replace(/^\uFEFF/,''));
const base = process.env.CFTRAIN_E2E_URL || 'http://127.0.0.1';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:"msedge"});
 try {
  const errors=[];
  async function login(uname){
   const context=await browser.newContext({viewport:{width:1365,height:1000}});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   const r=await context.request.post(base+'/login',{form:{uname,password:cfg.password,rememberme:'false'},maxRedirects:0});
   assert.ok([200,302,303].includes(r.status()),'login status '+r.status());
   await page.goto(`${base}/d/${cfg.domain}/cf-training`);
   await page.screenshot({path:__dirname+'/../../.test-output/debug.png',fullPage:true});
   if(uname===cfg.coach) await page.locator('#ct-runs table').waitFor();
   else await page.locator('#ct-account').getByText('fixture_student',{exact:true}).or(page.locator('#ct-account').getByText('尚未绑定账号')).waitFor();
   return page;
  }
  async function api(page,action,args={},post=false,csrf=true){return page.evaluate(async({action,args,post,csrf})=>{
    const root=document.querySelector('#cf-training');const u=new URL(root.dataset.api,location.origin);
    if(!post)for(const[k,v]of Object.entries({action,...args}))u.searchParams.set(k,v);
    const r=await fetch(u,post?{method:'POST',headers:{'Content-Type':'application/json',...(csrf?{'x-cf-training-csrf':root.dataset.token}:{})},body:JSON.stringify({action,...args})}:{});
    return {status:r.status,body:await r.json().catch(()=>null)};
  },{action,args,post,csrf});}
  async function ratingReady(page, action = 'dashboard', args = {}) {
    const deadline = Date.now() + 15000; // Tiny fixture, not a large production archive.
    while (Date.now() < deadline) {
      const response = await api(page, action, args);
      assert.equal(response.body?.ok, true, response.body?.error);
      const result = response.body.result;
      assert.notEqual(result.ratingStatus, 'failed', result.ratingError);
      if (result.ratingStatus === 'ready') return response;
      assert.ok(['computing', 'busy'].includes(result.ratingStatus), 'expected the candidate Rating API');
      await page.waitForTimeout(100);
    }
    assert.fail(`Timed out waiting for fixture ${action} Rating`);
  }
  const coach=await login(cfg.coach);const student=await login(cfg.student);
  assert.match(coach.url(), /\/cf-training\/coach$/);
  assert.match(student.url(), /\/cf-training\/student$/);
  assert.equal(await coach.locator('#ct-bind').count(),0);
  assert.equal(await student.locator('#ct-bind').count(),1);
  assert.equal((await api(coach,'dashboard')).body.result.isCoach,true);
  assert.equal((await api(student,'dashboard')).body.result.isCoach,false);
  assert.equal((await ratingReady(student)).body.result.accounts[0].rating,1600);
  const problems=(await api(student,'problems')).body.result;
  assert.equal(problems.counts.solved,1);
  assert.equal(problems.counts.attempted,1,'non-AC submission counts as attempted');
  const stats=(await api(student,'problem_stats')).body.result;
  assert.equal(stats.solvedTotal,1);
  assert.deepEqual(stats.rating,{bins:[{min:800,max:899,count:1}],unrated:0});
  assert.deepEqual(stats.tagDistribution,{total:1,rows:[{kind:'unknown',tag:null,count:1}]});
  await student.locator('#ct-stats-rating-chart rect[data-stats-index]').waitFor();
  await student.locator('#ct-stats-tags-chart circle[data-stats-index]').waitFor();
  await student.locator('[data-problem-status="attempted"]').click();
  await student.getByText('99003/B AUTOMATED TEST: attempted').waitFor();
  await student.getByText('补充我已见过的题目或比赛').click();
  await student.locator('#ct-seen input[name=value]').fill('99004/C');
  await student.locator('#ct-seen button').click();
  await student.locator('[data-unsee-value="99004/C"]').waitFor();
  await student.locator('[data-unsee-value="99004/C"]').click();
  await student.locator('[data-unsee-value="99004/C"]').waitFor({state:'detached'});
  assert.deepEqual((await api(student,'dashboard')).body.result.notices,[]);
  await student.locator('#ct-seen select[name=kind]').selectOption('contest');
  await student.locator('#ct-seen input[name=value]').fill('99004');
  await student.locator('#ct-seen button').click();
  await student.locator('[data-unsee-value="99004"]').waitFor();
  await student.locator('[data-unsee-value="99004"]').click();
  await student.locator('[data-unsee-value="99004"]').waitFor({state:'detached'});
  assert.deepEqual((await api(student,'dashboard')).body.result.notices,[]);
  await student.getByText('初始评分 1600，来自 fixture_student',{exact:false}).waitFor();
  assert.equal(await student.getByRole('button',{name:'教练工作台',exact:true}).count(),0);
  assert.equal((await api(student,'catalog',{},true)).status,403);
  assert.equal(await student.locator('#ct-bind').isVisible(),false);
  assert.equal((await api(student,'bind',{handle:'other_handle'},true)).body.ok,false);
  assert.equal((await api(student,'rebind',{uid:cfg.studentId,handle:'other_handle'},true)).status,403);
  await coach.getByRole('button',{name:'选赛与组赛',exact:true}).click();
  const contestGroup=(await api(coach,'group',{name:'自动化选赛班',uids:[cfg.studentId]},true)).body.result;
  await coach.reload();
  await coach.getByRole('button',{name:'选赛与组赛',exact:true}).click();
  await coach.locator('#ct-contest-group').selectOption(contestGroup.id);

  assert.equal((await api(coach,'catalog',{},true,false)).status,403);
  assert.equal((await api(student,'export')).status,403);
  assert.equal((await api(coach,'dashboard',{domainId:'system'})).status,403);
  await coach.locator('[data-tab=classes]').click();
  await coach.locator('#ct-class-new').click();
  await coach.locator('#ct-class-create input[name=name]').fill('自动化测试班');
  await coach.locator('#ct-class-create input[name=members]').fill(String(cfg.studentId));
  await coach.locator('#ct-class-create button:not([type])').click();
  await coach.locator('#ct-class-dialog').waitFor({state:'hidden'});
  assert.equal((await api(coach,'dashboard')).body.result.groups.length,2);
  await coach.locator('#ct-groups').selectOption({label:'自动化测试班（1人）'});
  const confirmDelete=coach.waitForEvent('dialog').then(d=>d.accept());
  await coach.locator('#ct-delete-group').click();
  await confirmDelete;
  await coach.getByText('班级已删除',{exact:true}).waitFor();
  assert.equal((await api(coach,'dashboard')).body.result.groups.length,1);
  await coach.getByRole('button',{name:'选赛与组赛',exact:true}).click();

  await coach.locator('#ct-discover input[name=query]').fill('99001');
  await coach.locator('#ct-discover select[name=mode]').selectOption('all');
  await coach.getByRole('button',{name:'搜索 / 筛选',exact:true}).click();
  await coach.locator('#ct-pagination').getByText('共 1 场',{exact:false}).waitFor();
  assert.equal(await coach.getByRole('button',{name:'下一页',exact:true}).isDisabled(),true);
  await coach.screenshot({path:__dirname+'/../../.test-output/coach.png',fullPage:true});
  const created=await api(coach,'create',{contestId:99001,title:'自动化测试未来训练',groupId:contestGroup.id,startAt:new Date(Date.now()+3600000).toISOString(),rated:true},true);
  assert.equal(created.body.ok,true,JSON.stringify(created.body));
  const id=created.body.result.id;
  assert.equal((await api(student,'run',{id})).status,403,'draft access denied');
  const replacement=await api(coach,'replace',{id,index:'A',problem:'99002/A'},true);assert.equal(replacement.body.ok,true);
  assert.equal((await api(coach,'publish',{id},true)).body.ok,true);
  const hidden=await api(student,'run',{id});assert.equal(hidden.body.result.hidden,true);assert.equal(hidden.body.result.run.slots,undefined);
  assert.equal((await api(coach,'replace',{id,index:'A',problem:'99001/A'},true)).body.ok,false);
  assert.equal((await api(student,'attend',{id},true)).body.ok,true);
  const pre=await ratingReady(coach,'preview',{id:'past-run'});assert.equal(pre.body.ok,true);assert.equal(pre.body.result.changes.length,1);
  assert.equal(pre.body.result.changes[0].oldRating,1600);
  const token=pre.body.result.token;
  assert.equal((await api(student,'settle',{id:'past-run',token},true)).status,403);
  assert.equal((await api(coach,'settle',{id:'past-run',token},true)).body.ok,true);
  assert.equal((await api(coach,'settle',{id:'past-run',token},true)).body.ok,false);
  assert.equal((await ratingReady(student)).body.result.ledger.length,1);
  await student.reload();await student.locator('#ct-runs button[data-open]').first().waitFor();
  await student.screenshot({path:__dirname+'/../../.test-output/student.png',fullPage:true});
  assert.equal((await api(coach,'void',{id:'past-run'},true)).body.ok,true);
  const revoked = (await ratingReady(student)).body.result;
  assert.equal(revoked.ledger.length,0);
  assert.equal(revoked.accounts[0].rating,1600);
  assert.deepEqual(errors,[],'no browser JS errors');
  console.log(JSON.stringify({passed:true,checks:['coach/student permissions','CSRF','problem history','problem statistics charts','manual problem/contest deletion','group deletion','create','replace','publish','prestart secrecy','signup','settle','deduplicate','void'],screenshots:['coach.png','student.png']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});







