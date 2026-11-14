/* Platform layer — the ONE place that knows whether NGWorship is running as a
   website, an installed PWA, or inside a native wrapper (Capacitor, or any
   wrapper that defines window.NGWorshipNative). See WRAPPING.md.

   Rule: on web and PWA every function here does exactly what the app did
   before it existed. Native behaviour is used only when a wrapper actually
   provides it, so nothing changes for the website.

   Sets <html data-platform="web|pwa|native"> so CSS can target a wrapper
   without touching the website (e.g. no text selection on UI chrome). Loaded
   before every other app script. Classic script, no module/IIFE exports:
   it exposes window.NGPlatform. */
(function () {
  const cap = window.Capacitor || null;
  const bridge = window.NGWorshipNative || null;

  const capNative = !!(cap && (
    (typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) ||
    (typeof cap.getPlatform === 'function' && cap.getPlatform() !== 'web')
  ));
  const isNative = !!bridge || capNative;
  const isAndroid = capNative && cap.getPlatform?.() === 'android';
  const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true;
  const kind = isNative ? 'native' : (isStandalone ? 'pwa' : 'web');
  document.documentElement.setAttribute('data-platform', kind);

  const plugin = (name) => (cap && cap.Plugins && cap.Plugins[name]) || null;
  const isCancel = (err) => /cancel/i.test(String((err && (err.message || err)) || ''));

  function webDownload(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Hands a text file to the person. Resolves 'downloaded' (web/PWA, the
  // original download link), 'shared' (native share sheet), 'native' (wrapper
  // bridge) or 'cancelled' (they closed the share sheet — no "saved" toast).
  async function saveFile({ filename, text, mime = 'application/json' }) {
    if (bridge && typeof bridge.saveFile === 'function') {
      try { await bridge.saveFile({ filename, text, mime }); return 'native'; }
      catch (err) { if (isCancel(err)) return 'cancelled'; console.error('Songbook: native saveFile failed —', err); }
    } else if (isNative) {
      const fs = plugin('Filesystem');
      const share = plugin('Share');
      if (fs && share) {
        try {
          const written = await fs.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
          await share.share({ title: filename, dialogTitle: filename, url: written.uri });
          return 'shared';
        } catch (err) {
          if (isCancel(err)) return 'cancelled';
          console.error('Songbook: share sheet failed —', err);
        }
      }
    }
    webDownload(filename, text, mime);
    return 'downloaded';
  }

  // Opens a web address outside the app. Web/PWA: a normal new tab.
  function openExternal(url) {
    if (bridge && typeof bridge.openExternal === 'function') { bridge.openExternal(url); return; }
    const browser = isNative ? plugin('Browser') : null;
    if (browser) { browser.open({ url }); return; }
    window.open(url, '_blank', 'noopener');
  }

  // Android sends hardware and gesture Back through the App plugin.
  // The caller handles in-app history and leaves root-level Back to Android.
  async function bindSystemBack(handleBack) {
    if (!isAndroid) return;
    const app = plugin('App');
    if (!app) return;
    try {
      await app.addListener('backButton', async () => {
        if (handleBack()) return;
        try { await app.exitApp(); }
        catch (err) { console.warn('Songbook: Android Back exit failed —', err); }
      });
    } catch (err) {
      console.warn('Songbook: Android Back listener failed —', err);
    }
  }

  // Inside a wrapper, target="_blank" links would replace or trap the app's
  // own web view, so send them to the system browser. Not installed on
  // web/PWA, where the links already behave correctly.
  if (isNative) {
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[target="_blank"][href^="http"]') : null;
      if (!a) return;
      e.preventDefault();
      openExternal(a.href);
    });
  }

  window.NGPlatform = { kind, isNative, isAndroid, isInstalled: isNative || isStandalone, saveFile, openExternal, bindSystemBack };
})();
