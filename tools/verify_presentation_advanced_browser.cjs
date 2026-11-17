// v5.1.2 Presentation Settings regression test. This file retains its old
// name so existing developer commands still work. There is no separate
// Advanced page anymore; media, dimming and appearance share one page.
// Run from a local deployment with NODE_PATH / Playwright configured.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((q,r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e,d) => { if(e) {r.writeHead(404); r.end(); return;} r.writeHead(200,{'content-type':mime[path.extname(p)] || 'application/octet-stream'}); r.end(d); });
}).listen(0);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers:'block' });
    await ctx.addInitScript(() => localStorage.setItem('sb-pres-fs','0'));
    const page = await ctx.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => typeof showPage === 'function' && document.querySelectorAll('#song-list > *').length > 5, null, {timeout:30000});
    await page.evaluate(() => showPage('presentation-settings'));
    await page.waitForSelector('#presentation-settings-content .pres-background-preview');
    const assert = require('node:assert/strict');
    assert.equal(await page.locator('#page-presentation-advanced').count(),0,'obsolete Advanced page removed');
    assert.equal(await page.locator('#presentation-advanced-nav-row').count(),0,'obsolete Advanced link removed');
    assert.equal(await page.locator('#pres-background-file').count(),1,'media picker moved to main settings');
    assert.equal(await page.locator('.pres-range').count(),1,'dimming slider moved to main settings');
    assert.equal(await page.locator('.pres-font-style-toggle button').count(),4,'four font styles');
    await page.locator('.pres-font-style-toggle [data-value="boldItalic"]').click();
    assert.deepEqual(await page.locator('.pres-background-sample').evaluate(el=>[getComputedStyle(el).fontWeight,getComputedStyle(el).fontStyle]),['700','italic']);
    await page.locator('.pres-preview-modes [data-value="title"]').click();
    assert.equal(await page.locator('.pres-background-preview .pres-title-text').count(),1,'title preview available');
    await page.locator('[role="switch"][aria-label="Song title"]').click();
    assert.equal(await page.locator('.pres-background-preview .pres-title-text').count(),0,'title preview follows title visibility');
    // From an actual presentation, Settings -> Back resumes the same slide.
    await page.evaluate(() => {const k=state.activeDbSource; const s=state.sources[k].songs.find(s=>s.lyrics?.length>5); openSong(s,{sourceKey:k});});
    await page.waitForTimeout(450);
    await page.evaluate(() => openPresentationMode());
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const before = await page.locator('.pres-slide.is-current').textContent();
    await page.evaluate(() => openPresentationSettingsFromOverlay());
    await page.goBack();
    await page.waitForFunction(()=>SongPresentation.isOpen());
    assert.equal(await page.locator('.pres-slide.is-current').textContent(),before,'Back restores the same slide');
    assert.deepEqual(errors,[], 'no browser errors');
    console.log('Presentation v5.1.2 browser regression checks passed');
    await ctx.close();
  } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
