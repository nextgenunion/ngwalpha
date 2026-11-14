// Desktop Chromium with a stubbed Capacitor bridge. Checks navigation behavior;
// this is not a measurement of physical Android frame delivery.
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
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE});
  const errors = [];
  async function open(mode) {
    const ctx = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',reducedMotion: mode.endsWith('reduced') ? 'reduce' : 'no-preference'});
    const page = await ctx.newPage();
    page.on('pageerror',err=>errors.push(err.message));
    await page.addInitScript(mode => {
      localStorage.setItem('sb-ui-lang', localStorage.getItem('sb-ui-lang') || 'en');
      if (mode === 'native' || mode === 'native-reduced') {
        window.__exitCount = 0;
        window.Capacitor = {isNativePlatform:()=>true, getPlatform:()=> 'android', Plugins:{
          App:{
            addListener:async (name, cb) => { if(name === 'backButton') window.__androidBack=cb; },
            exitApp:async () => { window.__exitCount++; }
          }
        }};
      }
      if (mode === 'pwa') {
        const mm = window.matchMedia.bind(window);
        window.matchMedia = q => q === '(display-mode: standalone)' ? {matches:true} : mm(q);
      }
    }, mode);
    await page.goto(base + '/');
    await page.waitForFunction(() => state.sources.official.loaded && document.querySelector('#song-list .song-row'));
    await page.locator('#splash-screen').waitFor({state:'hidden'});
    return {ctx,page};
  }
  try {
    for (const mode of ['native','native-reduced','pwa','reduced']) {
      const {ctx,page} = await open(mode);
      const native = mode === 'native';
      await page.evaluate(() => {
        document.getElementById('page-songs').scrollTop = 400;
        window.__listScroll = document.getElementById('page-songs').scrollTop;
        document.querySelector('#song-list .song-row').click();
        window.__immediate = {page:state.currentPage,history:history.state.page,
          underneath:!document.getElementById('page-songs').hidden,
          frames:document.getElementById('page-song-view').getAnimations().map(a=>a.effect.getKeyframes())};
      });
      const instant = await page.evaluate(()=>window.__immediate);
      assert.equal(instant.page,'song-view'); assert.equal(instant.history,'song-view');
      assert.equal(instant.underneath,native);
      // The slide's animation is created a few frames after the tap, once the
      // pages have been laid out, so none exists yet at tap time. The song
      // page is already parked off-screen, not showing at its final place.
      assert.equal(instant.frames.some(frames=>frames.some(f=>f.transform)),false);
      if (native) {
        await page.waitForFunction(() => document.getElementById('page-song-view').getAnimations().length > 0);
      }
      if (native) {
        // Catch the page mid-slide (polled every frame, so a slow runner cannot
        // miss the window the way a fixed delay could).
        await page.waitForFunction(() => {
          const x = new DOMMatrix(getComputedStyle(document.getElementById('page-song-view')).transform).m41;
          return x > 0 && x < 390;
        }, null, { polling: 'raf', timeout: 2000 });
        // The tab bar must not vanish while the list is still visible, and it
        // must sit under the sliding song page, not over it.
        assert.equal(await page.locator('#bottom-nav').evaluate(el=>el.hidden),false);
        assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('bottom-nav')).zIndex),'1');
      }
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#page-songs').evaluate(el=>el.hidden),true);
      assert.equal(await page.locator('#bottom-nav').evaluate(el=>el.hidden),true);
      assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('bottom-nav')).zIndex),'20');
      if (mode.startsWith('native')) await page.evaluate(()=>window.__androidBack({canGoBack:false}));
      else await page.goBack();
      await page.waitForFunction(()=>state.currentPage==='songs');
      if (native) {
        assert.equal(await page.locator('#page-song-view').evaluate(el=>el.hidden),false);
        // Back: the list's tab bar is already there, under the song page.
        assert.equal(await page.locator('#bottom-nav').evaluate(el=>el.hidden),false);
      }
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#page-song-view').evaluate(el=>el.hidden),true);
      assert.equal(await page.locator('#page-songs').evaluate(el=>el.scrollTop),await page.evaluate(()=>window.__listScroll));
      assert.equal(await page.locator('#bottom-nav').evaluate(el=>el.hidden),false);
      if (native) {
        for(let i=0;i<3;i++) {
          await page.evaluate(()=>document.querySelector('#song-list .song-row').click());
          await page.waitForTimeout(60);
          await page.evaluate(()=>window.__androidBack({canGoBack:false}));
          await page.waitForFunction(()=>state.currentPage==='songs');
          await page.waitForTimeout(40);
          // Programmatic reopening exercises a second interruption even while
          // pointer input to the underlying page is intentionally inert.
          await page.evaluate(()=>document.querySelector('#song-list .song-row').click());
          await page.waitForTimeout(380);
          assert.equal(await page.locator('#page-song-view').evaluate(el=>el.hidden),false);
          await page.locator('#back-btn').tap();
          await page.waitForFunction(()=>state.currentPage==='songs');
          await page.waitForTimeout(350);
          assert.equal(await page.locator('#page-songs').evaluate(el=>el.hidden || el.inert),false);
        }
        assert.equal(await page.evaluate(()=>window.__exitCount),0);
        await page.evaluate(()=>document.querySelector('#song-list .song-row').click());
        await page.waitForTimeout(50);
        await page.evaluate(()=>showPage('settings'));
        await page.waitForTimeout(400);
        assert.equal(await page.locator('#page-settings').evaluate(el=>el.hidden),false);
        assert.equal(await page.evaluate(()=>nativeSongSlide),null);
      }
      await ctx.close(); console.log('PASS',mode,'slide/fade, history, Back, scroll, interruption, cleanup');
    }
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
