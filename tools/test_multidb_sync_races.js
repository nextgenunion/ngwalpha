'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = {songs:[],loaded:true,loadFailed:false,syncAttempted:false,syncController:null,syncPromise:null};
let sweeps=0,active=0,maxActive=0,complete;
const context={console,AbortController,setTimeout,clearTimeout,
 state:{sources:{future:source},currentPage:'settings'},DB_SOURCES:{future:{}},
 navigator:{onLine:true},isSelectedDbSource:()=>true,
 setSongSyncProgress(){},resetSongSyncProgress(){},finishSongSyncProgress(){},
 saveSongsToIndexedDb:async()=>{},searchCacheWarmSources:new Set(),
 document:{getElementById:()=>null},isAbortError:e=>e.name==='AbortError',
 fetchIndividualSongData:(_,{signal})=>new Promise((resolve,reject)=>{
  sweeps++;active++;maxActive=Math.max(maxActive,active);
  const finish=result=>{active--;resolve(result);};
  if(sweeps===1)signal.addEventListener('abort',()=>setTimeout(()=>{active--;reject(Object.assign(new Error('aborted'),{name:'AbortError'}));},20),{once:true});
  else complete=()=>finish({songs:[{id:'same',title:'Latest'}],hadFailures:false});
 })};
const app=fs.readFileSync(path.join(__dirname,'../js/app.js'),'utf8');
vm.runInNewContext(app.slice(app.indexOf('async function syncSongDataFromIndividuals('),app.indexOf('function scheduleSongDataSync(')),context);
(async()=>{
 const first=context.syncSongDataFromIndividuals('future');
 source.syncController.abort();
 const waiting=Array.from({length:100},()=>context.syncSongDataFromIndividuals('future'));
 await new Promise(r=>setTimeout(r,35));
 assert.equal(sweeps,2,'100 waiting re-selections restart exactly one aborted sweep');
 assert.equal(maxActive,1,'no overlapping updates for the same database');
 complete();
 await Promise.all([first,...waiting]);
 assert.equal(source.syncPromise,null);
 assert.equal(source.syncController,null);
 assert.equal(source.syncAttempted,true);
 assert.equal(source.songs[0].title,'Latest');
 console.log('100 concurrent re-selections after an aborted sync: one replacement, no overlap, final state clean PASS');
})().catch(e=>{console.error(e);process.exit(1)});
