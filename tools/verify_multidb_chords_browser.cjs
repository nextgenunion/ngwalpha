'use strict';
// Serve the app, then run with Playwright available (BASE_URL and
// CHROMIUM_EXECUTABLE may override the local defaults).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8876/';
const http = require('node:http');
let server;
const root = path.resolve(__dirname,'..');
const QA=process.env.QA_DIR||path.join(require('node:os').tmpdir(),'ngw-browser-qa');
fs.mkdirSync(QA,{recursive:true});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let checks=0;
const eq=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
let browser;
const errors=[];
async function context(options={}) {
 const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',...options});
 await ctx.addInitScript(()=>{
  // Keep optional per-file background updates out of UI-only tests. Bundle
  // requests still use the real HTTP server; offline verification is separate.
  Object.defineProperty(navigator,'onLine',{get:()=>false});
 });
 await ctx.route('**/*',route=>{
  const url=route.request().url();
  return url.startsWith(BASE)?route.continue():route.abort();
 });
 return ctx;
}
async function open(ctx) {
 const page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE);
 await page.waitForFunction(()=>state.sources.official.loaded && document.querySelectorAll('#song-list>li[data-row-key]').length===360);
 return page;
}
async function select(page,keys) {
 await page.evaluate(async keys=>{state.multiDbSelect=true;applyDbSelection(keys);await loadSelectedSongDatabases();},keys);
 await page.waitForFunction(()=>getSongbookSource().loaded && (state.currentPage!=='songs'||document.getElementById('song-list').dataset.renderSelection===songbookSelectionKey()));
}
async function matrix(page,name) {
 const keys=['official','english','sda','mongolian2'];
 const counts={official:360,english:3143,sda:695,mongolian2:1433};
 for(let mask=1;mask<16;mask++) {
  const selected=keys.filter((_,i)=>mask&1<<i);
  await select(page,selected);
  const total=selected.reduce((n,k)=>n+counts[k],0);
  const numbered=selected.filter(k=>k==='official'||k==='sda');
  const badges=numbered.length===1?counts[numbered[0]]:0;
  for(const view of ['list','compact','tiles']) for(const direction of ['asc','desc']) {
   const result=await page.evaluate(({view,direction})=>{
    state.query='';state.songLabelFilters=[];
    state.sortOrder=direction;
    state.sortBy=sourceHasSongNumbers(SONGBOOK_SOURCE)?'num':'alpha';
    state.songListView=view;applySongListView();
    const rows=Array.from(document.querySelectorAll('#song-list>li[data-row-key]'));
    return {count:rows.length,unique:new Set(rows.map(r=>r.dataset.rowKey)).size,
     badges:document.querySelectorAll('#song-list .song-badge').length,
     invalid:rows.some(r=>r.textContent.includes('undefined')||r.dataset.sourceKey==='undefined'),
     entries:scrollIndexEntries.length,connected:scrollIndexEntries.every(e=>e.row&&e.row.isConnected),
     numberHidden:document.querySelector('.sort-btn[data-sort-by="num"]').hidden,
     numeric:scrollIndexIsNumeric,
     numberedOrder:rows.filter(r=>r.querySelector('.song-badge')).map(r=>Number(r.querySelector('.song-badge').firstChild.textContent))};
   },{view,direction});
   eq(result.count,total,`${name} ${selected} ${view} ${direction}: count`);
   eq(result.unique,total,'row identities stay distinct');
   eq(result.badges,badges,'numbers follow selected numbered-source count');
   eq(result.invalid,false,'no undefined titles/numbers/origins');
   eq(result.entries,total,'fast-scroll includes all songs');
   eq(result.connected,true,'fast-scroll resolves each actual row');
   eq(result.numberHidden,numbered.length!==1,'numeric sorting visibility');
   eq(result.numeric,numbered.length===1,'scroll indexing mode');
   if(badges) eq(result.numberedOrder,[...result.numberedOrder].sort((a,b)=>direction==='asc'?a-b:b-a),'printed numbers sort correctly');
  }
 }
 console.log(`PASS ${name}: all 15 subsets × 3 views × 2 directions`);
}
async function uiAndStress(page) {
 await select(page,['official']);
 await page.evaluate(()=>{state.multiDbSelect=false;applyDbSelection(['official']);});
 await page.locator('#song-db-btn').click();
 await page.locator('.db-picker-multi').click();
 eq(await page.locator('.db-picker-multi').getAttribute('aria-pressed'),'true','multi button enters selection mode');
 eq(await page.locator('[data-db-source="official"]').isDisabled(),true,'last database cannot be deselected');
 await page.locator('[data-db-source="sda"]').click();
 await page.waitForFunction(()=>state.selectedDbSources.length===2);
 eq(await page.locator('#modal-overlay').isVisible(),true,'multi selection keeps picker open');
 // Same live button sees every synchronous click; loads/rendering must coalesce.
 await page.locator('[data-db-source="sda"]').evaluate(button=>{for(let i=0;i<201;i++)button.click();});
 eq(await page.evaluate(()=>state.selectedDbSources),['official'],'201 rapid source toggles produce expected final selection');
 await page.locator('[data-db-group="all"]').click();
 await page.locator('[data-db-source="english"]').click();
 await page.locator('[data-db-source="mongolian2"]').click();
 await page.locator('[data-db-group="sda"]').click();
 await page.locator('[data-db-source="sda"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('#song-list>li[data-row-key]').length===5631);
 eq(await page.evaluate(()=>state.selectedDbSources),['official','english','sda','mongolian2'],'cross-group selection retains every source');
 await page.locator('.db-picker-multi').evaluate(button=>{for(let i=0;i<101;i++)button.click();});
 eq(await page.evaluate(()=>({mode:state.multiDbSelect,selected:state.selectedDbSources})),{mode:false,selected:['sda']},'rapid mode toggles safely collapse to the last selected source');
 await page.locator('[data-db-source="official"]').click();
 eq(await page.locator('#modal-overlay').isVisible(),false,'ordinary single selection still closes');
 await select(page,['official','english','sda','mongolian2']);
 await page.reload();
 await page.waitForFunction(()=>getSongbookSource().loaded && document.querySelectorAll('#song-list>li[data-row-key]').length===5631);
 eq(await page.evaluate(()=>state.selectedDbSources),['official','english','sda','mongolian2'],'selection survives reload');
 // Real search and label menus use the merged collection.
 await page.locator('#search-input').fill('Есүс Та Монголд алдаршаач');
 await page.waitForFunction(()=>document.querySelectorAll('#song-list>li[data-row-key]').length<5631);
 eq(await page.locator('#song-list li[data-row-key="official:s001"]').count(),1,'search includes numbered Mongolian song in merged collection');
 await page.locator('#search-input').fill('Amazing Grace');
 await page.waitForFunction(()=>!document.querySelector('#song-list>li[data-row-key="official:s001"]'));
 const sources=await page.locator('#song-list>li[data-row-key]').evaluateAll(rows=>[...new Set(rows.map(row=>row.dataset.sourceKey))]);
 assert(sources.includes('sda')&&sources.includes('english'));checks++;
 await page.locator('#search-input').fill('');
 await page.waitForFunction(()=>document.querySelectorAll('#song-list>li[data-row-key]').length===5631);
 await page.locator('#song-db-btn').click();
 await page.screenshot({path:path.join(QA,'picker-mobile.png')});
 await page.locator('#modal-close-btn').click();
 console.log('PASS UI: single/multi mode, 403 rapid toggles, cross-group selection, reload, merged search');
}
async function chordFlows(page,touch=false) {
 await select(page,['official']);
 await page.evaluate(()=>openSong(state.sources.official.songs.find(s=>s.id==='s001'),{sourceKey:'official'}));
 const chord=page.locator('#lyrics-container .chord-tag[data-chord="Am"]').first();
 if(touch) {
  await chord.tap();await sleep(100);await chord.tap();
 } else await chord.dblclick({delay:100});
 await page.waitForFunction(()=>state.currentPage==='chord-finder');
 eq(await page.locator('#cf-search-input').inputValue(),'Am','double activation searches the displayed chord');
 assert((await page.locator('#cf-chord-name').textContent()).includes('Am'));checks++;
 const toolSequence=await page.evaluate(()=>currentNavSeq);
 await page.locator('#chord-finder-back-btn').click();
 await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
 eq(await page.locator('#modal-title').textContent(),'Am','tool Back restores the song chord popup');
 eq(await page.evaluate(()=>[state.activeSourceKey,state.activeSong.id]),['official','s001'],'Back restores the same song and database');
 await page.goForward();
 await page.waitForFunction(()=>state.currentPage==='chord-finder');
 eq(await page.evaluate(()=>currentNavSeq),toolSequence,'browser Forward uses the existing entry');
 eq(await page.locator('#cf-search-input').inputValue(),'Am','Forward reopens the chord search');
 await page.goBack();
 await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
 // From an existing popup, keep instrument + selected voicing as well.
 await page.locator('.song-chord-viewer-instrument-btn[data-instrument="piano"]').click();
 await page.locator('.song-chord-viewer-nav .song-chord-viewer-arrow').last().click();
 const popup=await page.evaluate(()=>SongChordViewer.snapshot());
 if(touch) {
  await page.locator('.song-chord-viewer-diagram').tap();await sleep(100);await page.locator('.song-chord-viewer-diagram').tap();
 } else await page.locator('.song-chord-viewer-diagram').dblclick({delay:100});
 await page.waitForFunction(()=>state.currentPage==='chord-finder');
 eq(await page.locator('[data-cf-instrument="piano"]').getAttribute('aria-pressed'),'true','popup instrument carries into finder');
 await page.locator('#chord-finder-back-btn').click();
 await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
 eq(await page.evaluate(()=>SongChordViewer.snapshot()),popup,'Back preserves popup instrument and voicing');
 await page.locator('#modal-close-btn').click();
 eq(await page.evaluate(()=>history.state.chordViewer||null),null,'closing popup removes stale history state');
 // Use a real SDA English Am7 song; preserve transpose and scroll.
 await select(page,['sda']);
 const songId=await page.evaluate(()=>{
  const song=state.sources.sda.songs.find(s=>s.lyrics.some(line=>line.includes('[Am7]')));
  openSong(song,{sourceKey:'sda'});return song.id;
 });
 await page.locator('#transpose-up').click();
 await page.locator('#transpose-up').click();
 const transposed=page.locator('#lyrics-container .chord-tag[data-chord="Bm7"]').first();
 await transposed.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>({scroll:document.getElementById('page-song-view').scrollTop,transpose:state.transpose}));
 if(touch){await transposed.tap();await sleep(100);await transposed.tap();}
 else await transposed.dblclick({delay:100});
 await page.waitForFunction(()=>state.currentPage==='chord-finder');
 eq(await page.locator('#cf-search-input').inputValue(),'Bm7','finder uses transposed chord, not original Am7');
 await page.locator('#chord-finder-back-btn').click();
 await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
 eq(await page.evaluate(()=>({id:state.activeSong.id,transpose:state.transpose,scroll:document.getElementById('page-song-view').scrollTop})),{id:songId,transpose:before.transpose,scroll:before.scroll},'Back preserves transposition and exact song scroll');
 eq(await page.locator('#modal-title').textContent(),'Bm7','Back restores the displayed transposed chord');
 await page.screenshot({path:path.join(QA,`chord-back-${touch?'touch':'desktop'}.png`)});
 await page.locator('#modal-close-btn').click();
 // Single tap remains a popup; rapid repeated dblclicks push only once.
 const single=page.locator('#lyrics-container .chord-tag').first();
 await single.click();
 await page.waitForFunction(()=>!document.getElementById('modal-overlay').hidden);
 eq(await page.evaluate(()=>state.currentPage),'song-view','single tap opens only the popup');
 await page.locator('#modal-close-btn').click();
 const seq=await page.evaluate(()=>navSeq);
 await single.evaluate(el=>{for(let i=0;i<12;i++)el.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));});
 await page.waitForFunction(()=>state.currentPage==='chord-finder');
 eq(await page.evaluate(()=>currentNavSeq),seq+1,'repeated double taps never duplicate navigation entries');
 await page.goBack();
 await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
 await page.locator('#modal-close-btn').click();
 // A tap canceled by leaving the song must not spawn a popup on another page.
 await page.locator('#lyrics-container .chord-tag').first().click();
 await page.evaluate(()=>showPage('songs'));
 await sleep(400);
 eq(await page.locator('#modal-overlay').isVisible(),false,'pending single tap cannot open on another page');
 console.log(`PASS ${touch?'mobile touch':'desktop mouse'}: song→finder→popup, Back/Forward, piano/voicing, transposition/scroll, rapid gestures`);
}
async function futureSources() {
 const ctx=await context();
 if(process.env.TRACE_FUTURE) await ctx.addInitScript(()=>{
  window.futureEvents=[];
  for(const type of ['pointerdown','pointerup','click']) document.addEventListener(type,event=>{
   const button=document.querySelector('#song-list li[data-row-key="futureNumbered:s001"] button');
   window.futureEvents.push({type,target:event.target.outerHTML?.slice(0,160),row:event.target.closest('li[data-row-key]')?.dataset.rowKey,detail:event.detail,x:event.clientX,y:event.clientY,scroll:document.getElementById('page-songs')?.scrollTop,rect:button?.getBoundingClientRect().toJSON()});
  },true);
 });
 const registry=fs.readFileSync(path.join(root,'js/song-sources.js'),'utf8').replace('const databases = Object.freeze({',`const databases = Object.freeze({
 futureNumbered:Object.freeze({folder:'future-numbered',hasNumbers:true,group:'future',label:'Future numbered',store:'future-numbered'}),
 futureUnnumbered:Object.freeze({folder:'future-unnumbered',hasNumbers:false,group:'future',label:'Future unnumbered',store:'future-unnumbered'}),
 futureBroken:Object.freeze({folder:'future-broken',hasNumbers:true,group:'future',label:'Future broken',store:'future-broken'}),`);
 await ctx.route('**/js/song-sources.js',r=>r.fulfill({contentType:'text/javascript',body:registry}));
 const songs=[{id:'s001',number:7,title:'Future Alpha',lyrics:['[Am7]Future song']},{id:'future2',number:109,title:'Future Beta',lyrics:['[C]Future song']}];
 const unnumbered=[{id:'s001',title:'Future Delta',number:999,lyrics:['[Em]Unnumbered song']}];
 await ctx.route('**/data/future-*/**',route=>{
  const url=route.request().url();
  if(url.includes('future-broken'))return route.fulfill({status:503,body:'unavailable'});
  const data=url.includes('future-numbered')?songs:unnumbered;
  const file=new URL(url).pathname.split('/').pop();
  const body=file==='database.json'?{count:data.length,songs:data}:file==='manifest.json'?data.map(s=>s.id+'.json'):data.find(s=>s.id+'.json'===file);
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 const page=await open(ctx);
 await select(page,['futureNumbered','english','futureUnnumbered']);
 eq(await page.locator('#song-list .song-badge').count(),2,'future numbered database retains exact sparse numbers beside unnumbered databases');
 await page.evaluate(()=>{state.sortBy='num';renderSongList();});
 eq(await page.locator('#song-list .song-badge').allTextContents(),['7','109'],'future sparse numbers are real song numbers');
 eq(await page.evaluate(()=>scrollIndexEntries.find(e=>e.sourceKey==='futureUnnumbered').label),'F','unnumbered metadata hides stray number fields in scroll indicator too');
 await select(page,['futureNumbered','official','futureUnnumbered']);
 eq(await page.locator('#song-list .song-badge').count(),0,'future second numbered source suppresses all combined list numbers');
 eq(await page.locator('#song-list li[data-song-id="s001"]').count(),3,'three databases can reuse the same song ID safely');
 await page.locator('#song-list li[data-row-key="futureNumbered:s001"] button').click();
 try { await page.waitForFunction(()=>state.currentPage==='song-view'); }
 catch (error) {
  console.error('Future source navigation state', await page.evaluate(()=>({page:state.currentPage,source:state.activeSourceKey,song:state.activeSong?.title,modal:!document.getElementById('modal-overlay').hidden,selection:state.selectedDbSources,active:document.activeElement?.outerHTML})));
  console.error('Browser errors', errors);
  if(process.env.TRACE_FUTURE) console.error('Future input events',await page.evaluate(()=>window.futureEvents));
  await page.screenshot({path:path.join(QA,'future-navigation-failure.png')});
  throw error;
 }
 eq(await page.evaluate(()=>[state.activeSourceKey,state.activeSong.title]),['futureNumbered','Future Alpha'],'colliding ID opens its original database song');
 await page.goBack();
 await page.waitForFunction(()=>state.currentPage==='songs');
 await page.evaluate(()=>addPersonalLabel('futureNumbered','s001','Only future'));
 await page.evaluate(()=>{state.songLabelFilters=['Only future'];renderSongList({animate:true});});
 eq(await page.locator('#song-list li[data-row-key]').evaluateAll(rows=>rows.filter(r=>r.dataset.state!=='exiting').map(r=>r.dataset.rowKey)),['futureNumbered:s001'],'labels use source-qualified identities');
 await page.evaluate(()=>{state.songLabelFilters=[];state.query='';renderSongList();openAddSongsModal('favorites');});
 await page.locator('#modal-body li[data-song-key="futureNumbered:s001"] button').click();
 await page.locator('#modal-body li[data-song-key="official:s001"] button').click();
 const refs=await page.evaluate(()=>getPlaylist('favorites').songs.filter(s=>s.songId==='s001').map(s=>s.sourceKey).sort());
 eq(refs,['futureNumbered','official'],'Favorites/playlist picker preserves colliding IDs separately');
 await page.locator('#add-songs-search').fill('Future');
 await page.waitForFunction(()=>document.querySelectorAll('#modal-body li[data-song-key]:not([data-state="exiting"])').length===3);
 eq(await page.locator('#modal-body li[data-song-key="futureNumbered:s001"] button').getAttribute('aria-pressed'),'true','search diff retains playlist membership');
 await page.locator('#modal-close-btn').click();
 await select(page,['official','futureBroken']);
 eq(await page.locator('#song-list li[data-row-key]').count(),360,'a failed selected library does not hide available songs');
 eq(await page.locator('#song-list .load-error').count(),1,'a failed selected library is reported instead of silently omitted');
 await select(page,['official']);
 eq(await page.locator('#song-list .load-error').count(),0,'deselection removes stale failures');
 eq(await page.locator('#song-list .song-badge').count(),360,'deselection restores single-book numbers');
 await page.locator('#song-db-btn').click();
 eq(await page.locator('[data-db-group="future"]').count(),1,'a future registry group appears without hardcoding');
 await ctx.close();
 console.log('PASS future databases: new group, sparse numbering, colliding IDs, label filtering, Favorites, search diff and partial failure');
}
async function animationAndLandscape() {
 const ctx=await context({viewport:{width:844,height:390},hasTouch:true,isMobile:true,reducedMotion:'no-preference'});
 const page=await open(ctx);
 await select(page,['official','sda']);
 await page.locator('#song-db-btn').click();
 for(let i=0;i<10;i++) {
  await page.locator(`[data-db-group="${i%2?'sda':'all'}"]`).click();
 }
 const geometry=await page.locator('.db-picker-toolbar').evaluate(toolbar=>{
  const bounds=toolbar.getBoundingClientRect();
  return Array.from(toolbar.querySelectorAll('button')).every(button=>{
   const b=button.getBoundingClientRect();return b.width>0&&b.height>=32&&b.left>=bounds.left&&b.right<=bounds.right+1
    &&Math.abs((b.top+b.bottom)/2-(bounds.top+bounds.bottom)/2)<=1;
  });
 });
 eq(geometry,true,'landscape toolbar has aligned usable targets without overflow');
 await page.locator('#modal-close-btn').click();
 await page.evaluate(()=>openSong(state.sources.official.songs[0],{sourceKey:'official'}));
 await page.locator('#lyrics-container .chord-tag[data-chord="Am"]').first().press('Shift+Enter');
 await page.waitForFunction(()=>state.currentPage==='chord-finder');
 eq(await page.locator('#cf-search-input').inputValue(),'Am','keyboard direct chord handoff works with animations');
 await page.goBack();
 await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
 eq(await page.locator('#modal-title').textContent(),'Am','animated Back restores the chord popup');
 await page.locator('.song-chord-viewer-instrument-btn[data-instrument="piano"]').click();
 await page.locator('.song-chord-viewer-nav .song-chord-viewer-arrow').last().click();
 const saved=await page.evaluate(()=>SongChordViewer.snapshot());
 await page.locator('.song-chord-viewer-diagram').press('Enter');
 await page.waitForFunction(()=>state.currentPage==='chord-finder');
 await page.goBack();
 await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
 eq(await page.evaluate(()=>SongChordViewer.snapshot()),saved,'navigation cancels pending paints and restores the chosen voicing');
 await page.locator('#page-chord-finder').waitFor({state:'hidden'});
 await page.waitForFunction(()=>getComputedStyle(document.getElementById('modal-overlay')).opacity==='1');
 await page.screenshot({path:path.join(QA,'landscape-chord-return.png')});
 await page.locator('#modal-close-btn').click();
 await page.waitForFunction(()=>document.getElementById('modal-overlay').hidden);
 eq(await page.evaluate(()=>history.state.chordViewer||null),null,'animated close does not leave stale popup history');
 await ctx.close();
 console.log('PASS landscape with animations, rapid group switching and accessible keyboard navigation');
}
async function delayedSelection() {
 const ctx=await context();
 await ctx.route('**/data/english/database.json*',async route=>{await sleep(900);await route.continue();});
 await ctx.route('**/data/hymn/database.json*',async route=>{await sleep(300);await route.continue();});
 const page=await open(ctx);
 await page.evaluate(()=>{state.multiDbSelect=true;applyDbSelection(['official','english']);applyDbSelection(['official','sda']);applyDbSelection(['mongolian2']);});
 await page.waitForFunction(()=>state.sources.mongolian2.loaded && document.querySelectorAll('#song-list li[data-row-key]').length===1433);
 await sleep(1100);
 eq(await page.evaluate(()=>state.selectedDbSources),['mongolian2'],'late responses cannot replace a newer selection');
 eq(await page.locator('#song-list li[data-row-key]').count(),1433,'late responses cannot replace displayed rows');
 eq(await page.locator('#song-list .song-badge').count(),0,'late responses cannot restore obsolete numbered badges');
 await ctx.close();
 console.log('PASS delayed and out-of-order database loads');
}
async function offline() {
 const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await ctx.route('**/*',route=>route.request().url().startsWith(BASE)?route.continue():route.abort());
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(BASE);
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{timeout:30000});
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await ctx.setOffline(true);
 await page.reload();
 await page.waitForFunction(()=>state.sources.official.loaded);
 await select(page,['official','english','sda','mongolian2']);
 eq(await page.locator('#song-list li[data-row-key]').count(),5631,'all previously unopened databases combine offline');
 await page.reload();
 await page.waitForFunction(()=>getSongbookSource().loaded && document.querySelectorAll('#song-list>li[data-row-key]').length===5631);
 eq(await page.evaluate(()=>state.selectedDbSources.length),4,'combined selection reloads offline');
 await page.evaluate(()=>openSong(state.sources.official.songs[0],{sourceKey:'official'}));
 await page.locator('#lyrics-container .chord-tag[data-chord="Am"]').first().dblclick({delay:100});
 await page.waitForFunction(()=>state.currentPage==='chord-finder');
 eq(await page.locator('#cf-search-input').inputValue(),'Am','chord handoff works offline');
 await page.goBack();
 await page.waitForFunction(()=>state.currentPage==='song-view'&&!document.getElementById('modal-overlay').hidden);
 eq(await page.locator('#modal-title').textContent(),'Am','popup return works offline');
 await ctx.close();
 console.log('PASS real service worker: unopened libraries, merged selection, reload, chord finder and return while offline');
}
(async()=>{
 if(!process.env.BASE_URL) {
  server=http.createServer((request,response)=>{
   const relative=decodeURIComponent(new URL(request.url,BASE).pathname);
   const file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) {response.writeHead(404);response.end();return;}
   const mime={'.js':'text/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.mp3':'audio/mpeg'}[path.extname(file)]||'application/octet-stream';
   const body=fs.readFileSync(file);response.writeHead(200,{'Content-Type':mime,'Content-Length':body.length});response.end(body);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8876,'127.0.0.1',resolve);});
 }
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 if(process.env.ONLY_LAYOUT){await animationAndLandscape();eq(errors,[],'layout has no uncaught errors');await browser.close();if(server)server.close();return;}
 if(process.env.ONLY_FUTURE){await futureSources();eq(errors,[],'future sources have no uncaught errors');await browser.close();if(server)server.close();console.log(`PASS ${checks} future-source assertions`);return;}
 const phone=await context({hasTouch:true,isMobile:true});const p=await open(phone);
 if(!process.env.SKIP_MATRIX)await matrix(p,'phone');await uiAndStress(p);await chordFlows(p,true);await phone.close();
 const desktop=await context({viewport:{width:1440,height:1000}});const d=await open(desktop);
 if(!process.env.SKIP_MATRIX)await matrix(d,'desktop');else await select(d,['official','sda']);await chordFlows(d,false);await desktop.close();
 await futureSources();await delayedSelection();await animationAndLandscape();await offline();
 eq(errors,[],'no uncaught browser errors');
 console.log(`PASS ${checks} assertions; no uncaught browser errors`);
 await browser.close();
 if(server)server.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();if(server)server.close();process.exit(1);});
