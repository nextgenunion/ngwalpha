// Browser smoke test of the v4-style song transition restored in v5.0.100.
// Run with an available Playwright installation and CHROMIUM_EXECUTABLE.
// Tests the web/PWA and stubbed Android paths, not actual keyboard hardware.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const types = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server = http.createServer((req,res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const file = path.join(__dirname, '..', pathname === '/' ? 'index.html' : pathname);
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.readFile(file, (err, bytes) => {if (err) res.statusCode = 404; res.end(bytes);});
});
(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE});
  const errors=[];
  try {
    for(const mode of ['native','pwa','reduced']) {
      const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,
        serviceWorkers:'block',reducedMotion:mode==='reduced'?'reduce':'no-preference'});
      const page=await ctx.newPage();
      page.on('pageerror',err=>errors.push(err.message));
      await page.addInitScript(mode=>{
        localStorage.setItem('sb-ui-lang','en');
        if(mode==='native') window.Capacitor={isNativePlatform:()=>true,getPlatform:()=> 'android',
          Plugins:{App:{addListener:async(name,cb)=>{if(name==='backButton')window.__androidBack=cb;},exitApp:async()=>{}}}};
        if(mode==='pwa') {
          const mm=window.matchMedia.bind(window);
          window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true}:mm(q);
        }
      },mode);
      await page.goto('http://127.0.0.1:'+server.address().port+'/');
      await page.waitForFunction(()=>state.sources.official.loaded && document.querySelector('#song-list .song-row'));
      await page.locator('#splash-screen').waitFor({state:'hidden'});
      await page.evaluate(()=>{
        document.getElementById('page-songs').scrollTop=350;
        window.__savedScroll=document.getElementById('page-songs').scrollTop;
        document.querySelector('#song-list .song-row').click();
      });
      assert.equal(await page.evaluate(()=>state.currentPage),'song-view');
      assert.equal(await page.evaluate(()=>history.state.page),'song-view');
      const isReduced=mode==='reduced';
      if(!isReduced) {
        assert.equal(await page.locator('#page-songs').evaluate(el=>el.hidden),false);
        assert.equal(await page.locator('#page-song-view').evaluate(el=>el.classList.contains('page-slide-in')),true);
      }
      await page.waitForTimeout(390);
      assert.equal(await page.locator('#page-songs').evaluate(el=>el.hidden),true);
      if(mode==='native') await page.evaluate(()=>window.__androidBack({canGoBack:false}));
      else await page.goBack();
      await page.waitForFunction(()=>state.currentPage==='songs');
      if(!isReduced) assert.equal(await page.locator('#page-song-view').evaluate(el=>el.classList.contains('page-slide-out')),true);
      await page.waitForTimeout(370);
      assert.equal(await page.locator('#page-song-view').evaluate(el=>el.hidden),true);
      assert.equal(await page.locator('#page-songs').evaluate(el=>el.hidden),false);
      assert.equal(await page.locator('#page-songs').evaluate(el=>el.scrollTop),await page.evaluate(()=>window.__savedScroll));
      await ctx.close();
      console.log('PASS',mode,'v4-style push/pop, history, and scroll restoration');
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
