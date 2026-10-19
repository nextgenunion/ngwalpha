'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
const BASE='http://127.0.0.1:8877/';
const QA=process.env.QA_DIR||path.join(require('node:os').tmpdir(),'ngw-adversarial-qa');
fs.mkdirSync(QA,{recursive:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const failures=[],results=[],errors=[];
let browser,server,assertions=0;
function eq(a,b,message){assertions++;assert.deepEqual(a,b,message);}
async function makeContext(options={}) {
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',...options});
 await ctx.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{get:()=>false});});
 await ctx.route('**/*',route=>route.request().url().startsWith(BASE)?route.continue():route.abort());
 return ctx;
}
async function open(ctx,{rows=360}={}) {
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE);
 await page.waitForFunction(()=>state.sources.official.loaded&&!state.sources.official.loadPromise);
 if(rows!==null)await page.waitForFunction(count=>document.querySelectorAll('#song-list>li[data-row-key]').length===count,rows);
 return page;
}
async function songOne(page) {
 await page.locator('#song-list li[data-row-key="official:s001"] button').click();
 await page.waitForFunction(()=>state.currentPage==='song-view');
}
async function ready(page) {
 await page.waitForFunction(()=>getSongbookSource().loaded&&document.getElementById('song-list').dataset.renderSelection===songbookSelectionKey()
  &&document.querySelectorAll('#song-list>li[data-row-key]').length===getSongbookSource().songs.length);
}
async function settledPopup(page) {
 await page.waitForFunction(()=>{
  const card=document.querySelector('.modal-card');
  return card&&getComputedStyle(document.getElementById('modal-overlay')).opacity==='1'
   &&card.getAnimations({subtree:true}).every(animation=>animation.playState!=='running');
 });
}
async function test(name,fn){
 try{await fn();results.push({name,passed:true});console.log('PASS',name);}
 catch(error){failures.push({name,error:error.message});results.push({name,passed:false,error:error.message});console.log('FAIL',name,error.message.slice(0,420));}
}
async function interruptedChord(target) {
 const ctx=await makeContext({hasTouch:true,isMobile:true});
 await ctx.addInitScript(()=>{
  window.__interruptAudit=[];
  for(const type of ['pointerdown','click'])document.addEventListener(type,event=>window.__interruptAudit.push({type,time:performance.now(),x:event.clientX,y:event.clientY,chord:event.target.closest&&event.target.closest('.chord-tag[data-chord]')?.dataset.chord,target:event.target.id||event.target.className}),true);
 });
 const page=await open(ctx);await songOne(page);
 const first=await page.locator('#lyrics-container .chord-tag[data-chord="Am"]').first().boundingBox();
 const second=target==='lyric'?await page.locator('#lyrics-container .lyric-word').nth(1).boundingBox():null;
 await page.touchscreen.tap(first.x+first.width/2,first.y+first.height/2);
 if(target==='menu')await page.locator('#sv-menu-btn').tap();
 else if(target==='lyric')await page.touchscreen.tap(second.x+second.width/2,second.y+second.height/2);
 else if(target==='escape')await page.keyboard.press('Escape');
 else if(target==='back')await page.locator('#back-btn').tap();
 await pause(600);await page.screenshot({path:path.join(QA,`interrupted-${target}.png`)});
 try {
  eq(await page.locator('#modal-overlay').isVisible(),false,`pending chord tap is canceled by ${target}; ${JSON.stringify(await page.evaluate(()=>window.__interruptAudit.slice(-4)))}`);
  if(target==='menu')eq(await page.locator('#sv-kebab-dropdown').isVisible(),true,'chosen menu remains visible');
 }finally{await ctx.close();}
}
async function retryDatabase() {
 const ctx=await makeContext();let unavailable=true,attempts=0;
 await ctx.route('**/data/english/**',route=>{
  if(unavailable){attempts++;return route.fulfill({status:503,body:'temporary failure'});}
  return route.continue();
 });
 const page=await open(ctx);
 await page.locator('#song-db-btn').click();await page.locator('.db-picker-multi').click();
 await page.locator('[data-db-group="all"]').click();await page.locator('[data-db-source="english"]').click();
 await page.waitForFunction(()=>state.sources.english.loaded&&state.sources.english.loadFailed);await ready(page);
 eq(await page.locator('#song-list li[data-row-key]').count(),360,'temporary failure leaves the working book visible');
 const previousAttempts=attempts;
 await page.locator('[data-db-source="mongolian2"]').click();await ready(page);
 eq(attempts,previousAttempts,'an unrelated selection does not retry a retained failure');
 await page.locator('[data-db-source="mongolian2"]').click();await ready(page);
 await page.locator('[data-db-source="english"]').click();unavailable=false;
 await page.locator('[data-db-source="english"]').click();await pause(600);await ready(page);
 await page.screenshot({path:path.join(QA,'retry-database.png')});
 try{
  eq(await page.locator('#song-list li[data-row-key]').count(),3503,'reselecting after server recovery retries the failed book');
  eq(await page.locator('#song-list .load-error').count(),0,'failure warning clears after recovery');
  assert(attempts>0);assertions++;
 }finally{await ctx.close();}
}
async function unavailableStorage() {
 const ctx=await makeContext();
 await ctx.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{value:{open(){throw new Error('Test: storage unavailable');}}});});
 const page=await open(ctx,{rows:null});await page.screenshot({path:path.join(QA,'storage-unavailable.png')});
 try{
  eq(await page.locator('#song-list li[data-row-key]').count(),360,'working network data survives unavailable IndexedDB');
  await page.locator('#song-db-btn').click();await page.locator('.db-picker-multi').click();
  await page.locator('[data-db-source="sda"]').click();await ready(page);
  eq(await page.locator('#song-list li[data-row-key]').count(),1055,'multiple databases work when cache writes are blocked');
 }finally{await ctx.close();}
}
async function physicalPickerMatrix() {
 const ctx=await makeContext({hasTouch:true,isMobile:true});const page=await open(ctx);
 const keys=['official','english','sda','mongolian2'];const counts={official:360,english:3143,sda:695,mongolian2:1433};
 await page.locator('#song-db-btn').tap();await page.locator('.db-picker-multi').tap();
 async function tapSource(key){
  await page.locator(`[data-db-group="${['official','sda'].includes(key)?'sda':'all'}"]`).tap();
  await page.locator(`[data-db-source="${key}"]`).tap();
 }
 let selected=['official'];
 for(let mask=1;mask<16;mask++){
  const wanted=keys.filter((_,i)=>mask&1<<i);
  for(const key of wanted)if(!selected.includes(key)){await tapSource(key);selected.push(key);}
  for(const key of [...selected])if(!wanted.includes(key)){await tapSource(key);selected=selected.filter(k=>k!==key);}
  await ready(page);
  const total=wanted.reduce((n,k)=>n+counts[k],0);const numbered=wanted.filter(k=>['official','sda'].includes(k));
  eq(await page.locator('#song-list>li[data-row-key]').count(),total,`${wanted}: actual taps show all selected songs`);
  eq(await page.locator('#song-list .song-badge').count(),numbered.length===1?counts[numbered[0]]:0,'numeric visibility follows whole selection');
  eq(await page.locator('.sort-btn[data-sort-by="num"]').isVisible(),numbered.length===1,'numeric sort is visually hidden/shown');
  eq(await page.locator('#modal-overlay').isVisible(),true,'multi-selection remains open across group switches');
 }
 await page.locator('#modal-close-btn').tap();await page.locator('#song-db-btn').tap();
 eq(await page.evaluate(()=>state.selectedDbSources),keys,'reopening retains all four choices');
 await page.locator('[data-db-group="sda"]').tap();
 for(let i=0;i<50;i++)await page.locator('[data-db-source="sda"]').tap();
 await ready(page);eq(await page.evaluate(()=>state.selectedDbSources),keys,'50 real tap toggles are reversible');
 await page.locator('#modal-close-btn').tap();await page.reload();await ready(page);
 eq(await page.locator('#song-list>li[data-row-key]').count(),5631,'all choices persist after actual reload');
 await ctx.close();
}
async function keyboardModal() {
 const ctx=await makeContext();const page=await open(ctx);
 await page.locator('#song-db-btn').click();
 try {
  eq(await page.evaluate(()=>document.querySelector('.modal-card').contains(document.activeElement)),true,'opening the picker moves keyboard focus inside it');
  for(let i=0;i<12;i++) {
   await page.keyboard.press('Tab');
   eq(await page.evaluate(()=>document.querySelector('.modal-card').contains(document.activeElement)),true,'Tab stays within the active dialog');
  }
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('modal-overlay').hidden);
  eq(await page.evaluate(()=>document.activeElement.id),'song-db-btn','closing the picker returns focus to its button');
 }finally{await ctx.close();}
}
async function longListClicks() {
 for(const touch of [false,true]) {
  const ctx=await makeContext({hasTouch:touch,isMobile:touch,viewport:touch?{width:390,height:844}:{width:1440,height:900}});
  const page=await open(ctx);
  const activate=locator=>touch?locator.tap():locator.click();
  await activate(page.locator('#song-db-btn'));await activate(page.locator('.db-picker-multi'));
  await activate(page.locator('[data-db-source="sda"]'));
  await activate(page.locator('[data-db-group="all"]'));
  await activate(page.locator('[data-db-source="english"]'));
  const started=Date.now();await activate(page.locator('[data-db-source="mongolian2"]'));await ready(page);
  console.log(`${touch?'Touch':'Mouse'}: all 5,631 rows ready ${Date.now()-started}ms after final source input`);
  await activate(page.locator('#modal-close-btn'));
  for(const [index,view] of ['list','compact','tiles'].entries()) {
   // Change views through the actual Search tools picker.
   await activate(page.locator('#song-search-tools-btn'));
   await activate(page.locator('.song-search-tools-section').first().locator('.checklist-item').nth(index));
   await activate(page.locator('#modal-close-btn'));
   eq(await page.locator('#song-list').getAttribute('data-view'),view,'chosen list view is active');
   for(const fraction of [.99,.8,.55]) {
    const row=page.locator('#song-list li[data-row-key]').nth(Math.floor(5631*fraction));
    const expected=await row.evaluate(li=>({source:li.dataset.sourceKey,id:li.dataset.songId}));
    // No settling delay: jump directly to an unseen row and activate it.
    // Focusing a lazily estimated row previously shrank it between down/up.
    await activate(row.locator('button'));
    await page.waitForFunction(()=>state.currentPage==='song-view');
    eq(await page.evaluate(()=>({source:state.activeSourceKey,id:String(state.activeSong.id)})),expected,`${touch?'touch':'mouse'} ${view}: far-down click opens the intended source-qualified song`);
    await activate(page.locator('#back-btn'));
    await page.waitForFunction(()=>state.currentPage==='songs');
   }
  }
  await ctx.close();
 }
}
async function lateLoadingNavigation() {
 const ctx=await makeContext();let release;
 const gate=new Promise(resolve=>{release=resolve;});
 await ctx.route('**/data/english/database.json*',async route=>{await gate;await route.continue();});
 const page=await open(ctx);
 await page.locator('#song-db-btn').click();await page.locator('.db-picker-multi').click();
 await page.locator('[data-db-group="all"]').click();await page.locator('[data-db-source="english"]').click();
 await page.locator('#modal-close-btn').click();
 await page.locator('[data-nav="settings"]').click();await page.locator('#db-nav-row').click();
 await page.locator('[data-db-source="english"]').click();
 await page.locator('[data-db-group="sda"]').click();await page.locator('[data-db-source="sda"]').click();
 await page.locator('#modal-close-btn').click();
 await page.locator('[data-nav="songs"]').click();await ready(page);
 release();await page.waitForFunction(()=>state.sources.english.loaded);await pause(150);
 eq(await page.evaluate(()=>state.selectedDbSources),['official','sda'],'late English response cannot replace the choices made in Settings');
 eq(await page.locator('#song-list li[data-row-key]').count(),1055,'actual mid-load navigation keeps only the final selected sources');
 eq(await page.locator('#song-list .song-badge').count(),0,'late response cannot restore numbers from an outdated selection');
 eq(await page.locator('#modal-overlay').isVisible(),false,'late response does not reopen a closed dialog');
 await ctx.close();
}
async function chordTiming(delay) {
 const ctx=await makeContext();
 await ctx.addInitScript(()=>{
  window.__tapAudit=[];
  document.addEventListener('click',event=>{
   const chord=event.target.closest&&event.target.closest('.chord-tag[data-chord]');
   window.__tapAudit.push({time:performance.now(),chord:chord&&chord.dataset.chord,detail:event.detail,pointerType:event.pointerType,target:event.target.id||event.target.className});
  },true);
 });
 const page=await open(ctx);await songOne(page);
 await page.locator('#lyrics-container .chord-tag[data-chord="Am"]').first().dblclick({delay});
 await pause(650);
 const observed=await page.evaluate(()=>({page:state.currentPage,taps:window.__tapAudit}));
 try{
  eq(observed.page,'chord-finder',`double-click ${delay}ms must reach finder; ${JSON.stringify(observed.taps.slice(-3))}`);
  eq(await page.locator('#cf-search-input').inputValue(),'Am','double-click loads Am');
  await page.locator('#chord-finder-back-btn').click();
  await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
  eq(await page.locator('#modal-title').textContent(),'Am','Back restores exact popup after timing variation');
 }finally{await ctx.close();}
}
async function unavailableChordChart() {
 const ctx=await makeContext();const page=await open(ctx);
 // Fixture for a misspelled/new chord with no available diagram.
 await page.evaluate(()=>openSong({id:'audit-no-chart',title:'Chart unavailable',lyrics:['[H7]Test lyric']},{sourceKey:'user'}));
 await page.locator('#lyrics-container .chord-tag[data-chord="H7"]').click();
 await page.waitForFunction(()=>!document.getElementById('modal-overlay').hidden);
 eq(await page.locator('.song-chord-viewer-empty').isVisible(),true,'a missing chart displays the fallback');
 eq(await page.locator('.song-chord-viewer-nav').isVisible(),false,'a missing chart hides its unusable voicing controls');
 await ctx.close();
}
async function boundaryVisuals() {
 for(const [name,width,height]of [['small-phone',320,568],['phone',390,844],['landscape',844,390],['desktop',1440,900]])for(const theme of ['light','dark']){
  const ctx=await makeContext({viewport:{width,height},colorScheme:theme,reducedMotion:'no-preference'});
  await ctx.addInitScript(theme=>{localStorage.setItem('sb-theme',theme);},theme);
  const page=await open(ctx);
  await page.locator('#song-db-btn').click();await page.locator('.db-picker-multi').click();await page.locator('[data-db-source="sda"]').click();await ready(page);
  await settledPopup(page);
  const bounds=await page.locator('.db-picker-toolbar').evaluate(toolbar=>{
   const rect=toolbar.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,overflow:toolbar.scrollWidth>toolbar.clientWidth+1,centerDifference:Math.max(...Array.from(toolbar.querySelectorAll('button'),b=>{const r=b.getBoundingClientRect();return Math.abs((r.top+r.bottom)/2-(rect.top+rect.bottom)/2);} ))};
  });
  eq(bounds.overflow,false,`${name} ${theme}: controls do not overflow`);
  assert(bounds.left>=0&&bounds.right<=width&&bounds.top>=0&&bounds.bottom<=height);assertions++;
  assert(bounds.centerDifference<=1);assertions++;
  await page.screenshot({path:path.join(QA,`picker-${name}-${theme}.png`)});
  await page.locator('#modal-close-btn').click();await page.locator('#song-list li[data-row-key="official:s001"] button').click();
  await page.locator('#lyrics-container .chord-tag[data-chord="Am"]').first().click();
  await page.waitForFunction(()=>!document.getElementById('modal-overlay').hidden);
  await settledPopup(page);
  await page.screenshot({path:path.join(QA,`chord-${name}-${theme}.png`)});
  await page.locator('.song-chord-viewer-instrument-btn[data-instrument="piano"]').click();await page.locator('.song-chord-viewer-diagram').press('Enter');
  await page.waitForFunction(()=>state.currentPage==='chord-finder');await page.locator('#chord-finder-back-btn').click();
  await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
  await page.locator('#page-chord-finder').waitFor({state:'hidden'});
  await settledPopup(page);
  const card=await page.locator('.modal-card').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});
  assert(card.left>=-1&&card.right<=width+1&&card.top>=-1&&card.bottom<=height+1);assertions++;
  const controls=await page.locator('#modal-body').evaluate(body=>{
   const clip=body.getBoundingClientRect();
   return Array.from(body.querySelectorAll('.song-chord-viewer-instrument, .song-chord-viewer-nav'),el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,clipTop:clip.top,clipBottom:clip.bottom};});
  });
  assert(controls.every(r=>r.top>=r.clipTop-1&&r.bottom<=r.clipBottom+1),`${name} ${theme}: instrument and voicing controls are fully visible ${JSON.stringify(controls)}`);assertions++;
  await page.screenshot({path:path.join(QA,`return-${name}-${theme}.png`)});await ctx.close();
 }
}
(async()=>{
 server=http.createServer((request,response)=>{
  const relative=decodeURIComponent(new URL(request.url,BASE).pathname);
  const file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
  const mime={'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.mp3':'audio/mpeg'}[path.extname(file)]||'application/octet-stream';
  const body=fs.readFileSync(file);response.writeHead(200,{'Content-Type':mime,'Content-Length':body.length});response.end(body);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8877,'127.0.0.1',resolve);});
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const selected=process.env.AUDIT_CASE;
 if(!selected||selected==='interrupt')for(const target of ['menu','lyric','escape','back'])await test('interrupted chord: '+target,()=>interruptedChord(target));
 if(!selected||selected==='retry')await test('temporary failure and user-driven retry',retryDatabase);
 if(!selected||selected==='storage')await test('blocked cache storage',unavailableStorage);
 if(!selected||selected==='picker')await test('all 15 combinations through actual mobile taps',physicalPickerMatrix);
 if(!selected||selected==='keyboard')await test('dialog keyboard focus and restoration',keyboardModal);
 if(!selected||selected==='rows')await test('far-down mixed-library clicks in all views with mouse and touch',longListClicks);
 if(!selected||selected==='loading')await test('actual UI navigation while a download is held',lateLoadingNavigation);
 if(!selected||selected==='timing')for(const delay of [30,150,280,350,450])await test(`double-click ${delay}ms`,()=>chordTiming(delay));
 if(!selected||selected==='empty')await test('missing chord diagram has no unusable navigation controls',unavailableChordChart);
 if(!selected||selected==='visual')await test('eight viewport/theme visual boundaries and animated returns',boundaryVisuals);
 await browser.close();server.close();eq(errors,[],'no uncaught browser errors');
 fs.writeFileSync(path.join(QA,'audit-results.json'),JSON.stringify({assertions,results,failures,errors},null,2));
 console.log('Audit assertions:',assertions,'failures:',failures.length);if(failures.length)process.exitCode=1;
})().catch(async error=>{console.error(error);if(browser)await browser.close();if(server)server.close();process.exit(1);});
