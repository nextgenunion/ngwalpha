// ============================================================================
// Presentation mode — full-screen lyric slides for projecting a song.
//
// Built desktop-first (most presentations are run from a computer: keyboard,
// mouse, fullscreen on a projector or second screen) while staying usable by
// touch. Chords are never shown. Lyrics are split into slides of 1-4 lines, or
// "Fill": as many lines as fit on the screen at the chosen text size, without
// crossing into the next part of the song.
//
// Built for a projector: it opens on a clean black title slide with nothing
// else on screen (no controls, counter, hint or cursor). The control panel is
// never shown by mouse movement alone — only by pushing the mouse to the top
// edge, pressing S, double-clicking the middle of the screen (or, on a phone,
// double-tapping the middle).
// Number keys select slides within the current song. Shift+number selects a playlist entry.
//
// It asks for full screen as soon as it opens (the open click is the user
// gesture browsers require) and remembers if the person leaves full screen on
// purpose. The panel has three quiet icon buttons: Blank screen, Full screen
// and Settings. For the first few launches a short hint shows how to open the
// panel; it stops for good once the panel has been opened.
//
// This module owns only the overlay. ui.js decides how it is opened/closed
// (history entry, popstate) and passes in what it needs — see
// openPresentationMode() there. No app state is read from here.
//
// Planned later (seams are left on purpose, nothing is implemented yet):
//   - PNG export: buildSlides() returns plain data (label + lines), separate
//     from the DOM in buildCard(), so a canvas exporter can reuse it.
// ============================================================================
(function () {
  'use strict';

  const LS_LINES = 'sb-pres-lines';
  const LS_SIZE = 'sb-pres-size';
  const LS_TRANSITION = 'sb-pres-transition';
  const FILL = 0; // lines setting: pack as many lines as fit (was "All" before 5.0.62)
  const LINE_CHOICES = [1, 2, 3, 4, FILL];
  const DEFAULT_LINES = 2;
  const TRANSITIONS = ['cut', 'fade'];
  const DEFAULT_TRANSITION = 'fade';
  const FADE_MS = 300;
  // Text size is a real, absolute setting (not a starting point that gets
  // shrunk to fit). Each step is ~20% bigger than the last, so every press
  // visibly changes the text; the multiplier applies to a unit that follows the
  // screen size (see baseUnit()).
  const SIZE_STEPS = [0.45, 0.55, 0.67, 0.82, 1.0, 1.2, 1.45, 1.75, 2.1, 2.5];
  const DEFAULT_SIZE = 4;
  const MIN_FONT_PX = 12;
  const CONTROLS_IDLE_MS = 2200;        // mouse / keyboard: the panel hides quickly
  const CONTROLS_IDLE_TOUCH_MS = 6000;  // touch: a finger needs longer to reach the next button
  const LS_INTRO = 'sb-pres-intro';     // { n: launches that showed the hint, done: panel was opened }
  const INTRO_MAX_LAUNCHES = 4;
  const INTRO_SHOW_MS = 4500;
  const EDGE_PX = 3;        // mouse this close to the top edge asks for the controls...
  const EDGE_DWELL_MS = 150; // ...and has to stay there briefly, so a fly-by doesn't flash them
  const SWIPE_PX = 50;
  const DOUBLE_CLICK_MS = 350; // two nearby middle clicks/taps toggle the panel once

  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  let root = null;        // overlay element while open
  let cfg = null;         // options passed to open()
  let slides = [];
  let index = 0;
  let linesPerSlide = DEFAULT_LINES;
  let sizeIndex = DEFAULT_SIZE;
  let transition = DEFAULT_TRANSITION;
  let blanked = false;
  let idleTimer = null;
  let edgeTimer = null;
  let panelHover = false;
  let refreshFrame = 0;
  let wakeLock = null;
  let restoreFocus = null;
  let swipe = null;
  let lastMiddleClick = null;
  let inputIsTouch = false; // last pointer was a finger/pen: keep the panel open longer
  let introTimer = null;
  // [string key, CSS background, text tone that reads well on it]
  const BACKGROUNDS = {
    black: ['presBlack', '#000', 'light'],
    charcoal: ['presCharcoal', '#1d2026', 'light'],
    ocean: ['presOcean', 'linear-gradient(160deg, #0a3d5c 0%, #0e86b8 100%)', 'light'],
    white: ['presWhite', '#fff', 'dark'],
    sky: ['presSky', 'linear-gradient(180deg, #d6efff 0%, #f4fbff 100%)', 'dark'],
    sunrise: ['presSunrise', 'linear-gradient(160deg, #fff1d6 0%, #ffd2c2 100%)', 'dark'],
  };
  const LS_TEXT = 'sb-pres-text';
  const TEXT_CHOICES = ['auto', 'light', 'dark'];
  let textPref = 'auto';
  let settingsTab = 'text'; // which Presentation settings tab is open (kept while the app runs)
  let background = { kind: 'preset', preset: 'black' };
  let mediaURL = null;

  function loadBackground() {
    try {
      const saved = JSON.parse(localStorage.getItem('sb-pres-background'));
      if (saved && saved.kind === 'preset' && BACKGROUNDS[saved.preset]) background = { kind: 'preset', preset: saved.preset };
      else if (saved && saved.kind === 'media' && ['image', 'video'].includes(saved.media) && typeof saved.name === 'string') background = saved;
    } catch (_) {}
  }

  function saveBackground() {
    // Only the choice and file name go to localStorage. The file itself is kept
    // in IndexedDB (see "picture / video background" below).
    try { localStorage.setItem('sb-pres-background', JSON.stringify(background)); } catch (_) {}
  }

  // ---------- picture / video background, kept on this device ----------
  // The chosen file is remembered automatically in this browser's IndexedDB
  // (database "ngw-presentation"). It is never put in Cache Storage, so the
  // service worker and the app's offline files are untouched; nothing is
  // uploaded; and it works offline. The overlay and the settings preview read
  // it through a blob: URL. Only one file is kept: choosing another file, a
  // colour or Reset removes the old one.
  const MEDIA_DB = 'ngw-presentation';
  const MEDIA_STORE = 'media';
  const MEDIA_KEY = 'background';
  const MEDIA_MAX_BYTES = 300 * 1024 * 1024;
  // none | saving | saved | session (could not be kept; works until the app closes) | missing
  let mediaState = 'none';
  let mediaRestore = null;

  function openMediaDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(MEDIA_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(MEDIA_STORE)) req.result.createObjectStore(MEDIA_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }
  function mediaTx(mode, action) {
    return openMediaDB().then(db => new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(MEDIA_STORE, mode);
        const request = action(tx.objectStore(MEDIA_STORE));
        tx.oncomplete = () => { db.close(); resolve(request ? request.result : undefined); };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction failed')); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction aborted')); };
      } catch (err) { db.close(); reject(err); }
    }));
  }
  function saveMediaFile(file, kind) {
    if (file.size > MEDIA_MAX_BYTES) return Promise.reject(new Error('file too large'));
    return mediaTx('readwrite', store => store.put({ blob: file, name: file.name, media: kind }, MEDIA_KEY));
  }
  function deleteMediaFile() {
    return mediaTx('readwrite', store => store.delete(MEDIA_KEY)).catch(() => {});
  }
  function releaseMedia() {
    if (mediaURL) URL.revokeObjectURL(mediaURL);
    mediaURL = null;
  }
  // Forget the current picture/video everywhere (memory and storage). Call it
  // before `background` is changed to something else.
  function dropMedia() {
    const had = background.kind === 'media' || !!mediaURL;
    releaseMedia();
    mediaState = 'none';
    if (had) deleteMediaFile();
  }
  // Bring the saved file back into memory (once per page load, and again if it
  // is needed while that is still running). Resolves true when it is ready.
  function ensureMedia() {
    if (background.kind !== 'media') return Promise.resolve(false);
    if (mediaURL) return Promise.resolve(true);
    if (mediaRestore) return mediaRestore;
    const wanted = background.name;
    const run = mediaTx('readonly', store => store.get(MEDIA_KEY)).then(record => {
      if (background.kind !== 'media' || mediaURL) return !!mediaURL; // changed while loading
      if (!record || !record.blob || record.name !== wanted) { mediaState = 'missing'; return false; }
      mediaURL = URL.createObjectURL(record.blob);
      mediaState = 'saved';
      return true;
    }).catch(() => { if (!mediaURL) mediaState = 'missing'; return !!mediaURL; });
    mediaRestore = run;
    run.then(() => { if (mediaRestore === run) mediaRestore = null; });
    return run;
  }

  // ---------- advanced look (font, colours, effect, dim) ----------
  const LS_ADV = 'sb-pres-adv';
  const HEX = /^#[0-9a-f]{6}$/i;
  const ADV_DEFAULTS = { font: 'standard', fontStyle: 'normal', textColor: null, bgColor: null, effect: 'shadow', effects: {}, dim: 0 };
  const FONTS = {
    standard: ['presFontStandard', 'var(--font-lyrics)'],
    classic: ['presFontClassic', "ui-serif, 'Times New Roman', Georgia, serif"],
    system: ['presFontSystem', "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"],
  };
  // Online fonts are listed only if they cover Cyrillic Extended (Ө, Ү), so a
  // Mongolian song visibly changes when one is chosen. Noto Sans KR is for the
  // Korean interface. The offline fonts above always work without internet.
  const ONLINE_FONTS = {
    roboto: 'Roboto',
    'open-sans': 'Open Sans',
    montserrat: 'Montserrat',
    inter: 'Inter',
    merriweather: 'Merriweather',
    'noto-sans-kr': 'Noto Sans KR',
  };
  function fontChoices(translate, selected) {
    const lang = document.documentElement.getAttribute('lang') || '';
    const korean = lang === 'kr' || lang.startsWith('ko');
    const tag = translate('presFontOnlineTag');
    const list = Object.entries(FONTS).map(([value, [label]]) => ({ value, label: translate(label) }));
    Object.entries(ONLINE_FONTS).forEach(([value, label]) => {
      if (value === 'noto-sans-kr' && !korean && selected !== value) return;
      list.push({ value, label: `${label} · ${tag}` });
    });
    return list;
  }
  const FONT_STYLES = { normal: 'lyricsWeightNormal', bold: 'lyricsWeightBold', italic: 'fontStyleItalic', boldItalic: 'fontStyleBoldItalic' };
  const EFFECTS = ['none', 'shadow', 'glow', 'outline'];
  const DIM_MAX = 70;
  const AUTO_DIM = 30; // a new picture/video starts a little dimmed so lyrics stay readable
  let adv = { ...ADV_DEFAULTS, effects: {} };

  function loadAdvanced() {
    adv = { ...ADV_DEFAULTS, effects: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(LS_ADV));
      if (!saved || typeof saved !== 'object') return;
      if (Object.hasOwn(FONTS, saved.font) || Object.hasOwn(ONLINE_FONTS, saved.font)) adv.font = saved.font;
      if (Object.hasOwn(FONT_STYLES, saved.fontStyle)) adv.fontStyle = saved.fontStyle;
      adv.textColor = readPaint(saved.textColor);
      adv.bgColor = readPaint(saved.bgColor);
      for (const effect of EFFECTS) {
        const prefs = saved.effects?.[effect];
        if (!prefs || effect === 'none') continue;
        const strength = Number.isFinite(prefs.strength) ? Math.min(100, Math.max(0, prefs.strength)) : 50;
        adv.effects[effect] = { strength, color: HEX.test(prefs.color) ? prefs.color : null };
      }
      if (EFFECTS.includes(saved.effect)) adv.effect = saved.effect;
      const dim = Number(saved.dim);
      if (Number.isFinite(dim)) adv.dim = Math.min(DIM_MAX, Math.max(0, Math.round(dim / 5) * 5));
    } catch (_) {}
  }
  function saveAdvanced() {
    try { localStorage.setItem(LS_ADV, JSON.stringify(adv)); } catch (_) {}
  }

  function loadTextPref() {
    try {
      const saved = localStorage.getItem(LS_TEXT);
      if (TEXT_CHOICES.includes(saved)) textPref = saved;
    } catch (_) {}
  }

  function readPaint(value) {
    if (typeof value === 'string' && HEX.test(value)) return value;
    if (!value || !HEX.test(value.start) || !HEX.test(value.end) || !Number.isFinite(value.angle)) return null;
    const position = Number.isFinite(value.position) ? Math.min(100, Math.max(0, value.position)) : 50;
    return { start: value.start, end: value.end, angle: ((value.angle % 360) + 360) % 360, position };
  }

  function paintCss(value) {
    return value && typeof value === 'object'
      ? (Number.isFinite(value.position) && value.position !== 50
        // A colour hint moves the point where the two colours are mixed 50/50,
        // so one colour can be given less or more of the space.
        ? `linear-gradient(${value.angle}deg, ${value.start}, ${value.position}%, ${value.end})`
        : `linear-gradient(${value.angle}deg, ${value.start}, ${value.end})`)
      : value;
  }

  function paintLuminance(value) {
    return typeof value === 'string' ? luminance(value) : (luminance(value.start) + luminance(value.end)) / 2;
  }

  function activeEffect() {
    return adv.effects[adv.effect] || { strength: 50, color: null };
  }

  function autoEffectColor() {
    const text = textColor();
    if (adv.effect === 'glow') return typeof text === 'string' ? text : text.start;
    return paintLuminance(text) > 0.179 ? '#000000' : '#ffffff';
  }

  // Relative luminance (WCAG). White vs black text is equally readable at 0.179.
  function luminance(hex) {
    const ch = (i) => {
      const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
  }
  function bgIsLight() {
    if (background.kind === 'media') return false;
    if (adv.bgColor) return paintLuminance(adv.bgColor) > 0.179;
    return BACKGROUNDS[background.preset][2] === 'dark';
  }
  // Auto follows the background (white on photos and video); White/Black force
  // it; an explicitly selected custom colour wins over all of them.
  function textColor() {
    if (adv.textColor) return adv.textColor;
    if (textPref === 'light') return '#ffffff';
    if (textPref === 'dark') return '#111111';
    return bgIsLight() ? '#111111' : '#ffffff';
  }
  // Sets everything the CSS needs on the overlay or the settings preview.
  function applyTone(node) {
    const text = textColor();
    const lightText = paintLuminance(text) > 0.179;
    node.dataset.tone = lightText ? 'light' : 'dark';
    node.dataset.bg = background.kind === 'media' ? 'media' : 'preset';
    node.dataset.bgTone = bgIsLight() ? 'light' : 'dark';
    node.dataset.effect = adv.effect;
    const gradient = typeof text === 'object';
    const effect = activeEffect();
    node.toggleAttribute('data-text-gradient', gradient);
    node.style.setProperty('--pres-text', gradient ? text.start : text);
    node.style.setProperty('--pres-text-gradient', gradient ? paintCss(text) : '');
    node.style.setProperty('--pres-fx', effect.color || autoEffectColor());
    node.style.setProperty('--pres-fx-size', String(effect.strength / 50));
    node.style.setProperty('--pres-fx-opacity', Math.min(100, effect.strength * 2) + '%');
    node.style.setProperty('--pres-dim', String(adv.dim / 100));
    const online = ONLINE_FONTS[adv.font];
    node.style.setProperty('--pres-font', online ? `"${online}", var(--font-lyrics)` : FONTS[adv.font][1]);
    node.style.setProperty('--pres-font-weight', (adv.fontStyle === 'bold' || adv.fontStyle === 'boldItalic') ? '700' : '400');
    node.style.setProperty('--pres-font-style', (adv.fontStyle === 'italic' || adv.fontStyle === 'boldItalic') ? 'italic' : 'normal');
    // Load only the selected online family. The bundled font remains in
    // the stack for offline use and glyphs missing from the selected font.
    const id = `pres-font-${adv.font}`;
    if (online && navigator.onLine && !document.getElementById(id)) {
      const stylesheet = el('link');
      stylesheet.id = id;
      stylesheet.rel = 'stylesheet';
      const axes = adv.font === 'noto-sans-kr' ? 'wght@400;700' : 'ital,wght@0,400;0,700;1,400;1,700';
      stylesheet.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(online)}:${axes}&display=swap`;
      stylesheet.addEventListener('error', () => stylesheet.remove(), { once: true });
      document.head.appendChild(stylesheet);
    }
  }

  function paintBackground(layer, preview = false, translate = cfg && cfg.t) {
    layer.replaceChildren();
    layer.style.background = background.kind === 'preset' ? (paintCss(adv.bgColor) || BACKGROUNDS[background.preset][1]) : '#000';
    if (background.kind !== 'media' || !mediaURL) return;
    const media = document.createElement(background.media === 'video' ? 'video' : 'img');
    if (background.media === 'video') {
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.preload = preview ? 'metadata' : 'auto';
    } else media.alt = '';
    media.onerror = () => {
      media.remove();
      const status = document.getElementById('pres-media-status');
      if (status && translate) status.textContent = translate('presMediaError');
    };
    media.src = mediaURL;
    layer.appendChild(media);
    if (background.media === 'video' && !preview) media.play().catch(() => { media.remove(); });
  }

  const titleOptions = ['presTitleSlide', 'presTitleText', 'presTitleNumber', 'presTitleArtist'];
  let titlePrefs = {};
  function loadTitlePrefs() {
    titlePrefs = { presTitleArtist: false };
    try { Object.assign(titlePrefs, JSON.parse(localStorage.getItem('sb-pres-title') || '{}')); }
    catch (_) {}
  }
  // ---------- settings pages ----------
  // Built from the app's own components: colour swatches (like Settings →
  // Colour), the sliding segmented control (like Chord style) and switches
  // (like Dark mode). Controls update in place instead of re-rendering the
  // page, so their press animations play.
  function loadTransition() {
    try {
      const saved = localStorage.getItem(LS_TRANSITION);
      transition = TRANSITIONS.includes(saved) ? saved : DEFAULT_TRANSITION;
    } catch (_) { transition = DEFAULT_TRANSITION; }
  }

  function loadAll() {
    loadTransition();
    loadTitlePrefs();
    loadBackground();
    loadTextPref();
    loadAdvanced();
  }

  // First stanza of song #1 in each bundled SDA collection, available offline.
  const ENGLISH_PREVIEW = {
    "number": 1,
    "title": "Praise to the Lord",
    "artist": "Traditional",
    "lines": [
      "Praise to the Lord, the Almighty, the King of creation!",
      "O my soul, praise Him, for He is thy health and salvation!",
      "All ye who hear, Now to His temple draw near;",
      "Join ye in glad adoration!"
    ]
  };
  const MONGOLIAN_PREVIEW = {
    "number": 1,
    "title": "Есүс Та Монголд алдаршаач",
    "artist": "Адвентист Сүм Магтаал",
    "lines": [
      "Орчлон Ертөнцийн ганц Эзэн",
      "Есүс Та Монголд алдаршаач Аа",
      "Мөнхийн үхэл аймшгийг",
      "Өөрөө туулан гарсан"
    ]
  };

  function makePreview(translate) {
    const wrap = el('div', 'pres-preview-wrap');
    const preview = el('div', 'pres-background-preview');
    const layer = el('div', 'pres-bg');
    const sample = el('div', 'pres-background-sample');
    sample.setAttribute('aria-live', 'polite');
    preview.append(layer, sample);

    const language = document.documentElement.lang;
    const song = ['mn', 'mn2'].includes(language) ? MONGOLIAN_PREVIEW : ENGLISH_PREVIEW;
    let mode = titlePrefs.presTitleSlide === false ? 'lyrics' : 'title';
    // Page dots under the slide (like an Instagram carousel): one per slide,
    // the current one is highlighted. Tap a dot or swipe the preview to switch.
    const dots = el('div', 'pres-dots');
    dots.setAttribute('role', 'group');
    const dotFor = {};
    [['title', 'presPreviewTitle'], ['lyrics', 'presPreviewLyrics']].forEach(([slideMode, labelKey]) => {
      const dot = el('button', 'pres-dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', translate(labelKey));
      dot.addEventListener('click', () => { mode = slideMode; renderSlide(); });
      dotFor[slideMode] = dot;
      dots.appendChild(dot);
    });

    const renderSlide = () => {
      sample.classList.toggle('is-title-preview', mode === 'title');
      // With the title slide switched off there is only one slide: no dots.
      dots.hidden = titlePrefs.presTitleSlide === false;
      Object.entries(dotFor).forEach(([slideMode, dot]) => dot.setAttribute('aria-current', String(slideMode === mode)));
      const slide = mode === 'lyrics'
        ? { kind: 'lyrics', lines: song.lines }
        : {
          kind: 'title',
          number: titlePrefs.presTitleNumber === false ? null : song.number,
          title: titlePrefs.presTitleText === false ? null : song.title,
          artist: titlePrefs.presTitleArtist === false ? null : song.artist,
        };
      sample.replaceChildren(buildCard(slide));
    };

    let swipeX = null;
    preview.addEventListener('pointerdown', (event) => { swipeX = event.clientX; });
    preview.addEventListener('pointerup', (event) => {
      if (swipeX == null || titlePrefs.presTitleSlide === false) { swipeX = null; return; }
      const dx = event.clientX - swipeX;
      swipeX = null;
      if (Math.abs(dx) < 40) return;
      mode = dx < 0 ? 'lyrics' : 'title';
      renderSlide();
    });
    preview.addEventListener('pointercancel', () => { swipeX = null; });
    wrap.append(preview, dots);
    const refresh = () => {
      if (titlePrefs.presTitleSlide === false) mode = 'lyrics';
      paintBackground(layer, true, translate);
      applyTone(preview);
      renderSlide();
    };
    refresh();
    return { preview: wrap, refresh, showTitle: () => { mode = 'title'; refresh(); } };
  }

  function settingsRow(translate, titleKey, control, wide) {
    const r = el('div', 'settings-row' + (wide ? ' pres-row-wide' : ''));
    const text = el('div', 'settings-row-text');
    text.appendChild(el('span', 'settings-row-title', translate(titleKey)));
    r.append(text, control);
    return r;
  }

  // A sliding segmented control (same component as Chord style).
  function segControl(translate, labelKey, choices, current, onChange) {
    const seg = el('div', 'seg-toggle');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', translate(labelKey));
    const thumb = el('div', 'seg-toggle-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    seg.appendChild(thumb);
    // data-pending stays on until the highlight has really been placed. While it
    // is on, the chosen label is drawn in the normal text colour (see the CSS),
    // so it can never be white text on a missing highlight.
    seg.setAttribute('data-pending', '');
    const place = (opts) => {
      if (typeof positionSegToggleThumb !== 'function') return;
      positionSegToggleThumb(seg, opts);
      if (thumb.style.width) seg.removeAttribute('data-pending');
    };
    // select(value) moves the highlight; select(null) clears it (used when a
    // custom colour is active and none of the fixed choices applies).
    seg.select = (value) => {
      seg.querySelectorAll('.seg-toggle-btn').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.value === value)));
      seg.classList.toggle('is-none', value == null);
      place();
    };
    choices.forEach(([value, labelText]) => {
      const b = el('button', 'seg-toggle-btn', labelText);
      b.type = 'button';
      b.dataset.value = value;
      b.setAttribute('aria-pressed', String(value === current));
      b.addEventListener('click', () => {
        seg.select(value);
        onChange(value);
      });
      seg.appendChild(b);
    });
    seg.classList.toggle('is-none', current == null);
    // The page may still be hidden while it is built, and fonts can change the
    // button widths after the first measurement. Without the thumb in place the
    // chosen label (white) is invisible until the next tap, so re-place it
    // whenever the control appears or any button changes size.
    if (typeof ResizeObserver === 'function') {
      const watcher = new ResizeObserver(() => {
        if (!seg.isConnected) { watcher.disconnect(); return; }
        place({ instant: true });
      });
      watcher.observe(seg);
      seg.querySelectorAll('.seg-toggle-btn').forEach(b => watcher.observe(b));
    }
    requestAnimationFrame(() => requestAnimationFrame(() => place({ instant: true })));
    return seg;
  }

  function settings(translate) {
    loadAll();
    const container = document.getElementById('presentation-settings-content');
    container.replaceChildren();
    const { preview, refresh, showTitle } = makePreview(translate);
    ensureMedia().then(ok => { if (ok) refresh(); });

    // Background colours: two rows, Plain colors and Gradients. Each ends with
    // its own custom swatch (a plain colour or a two-colour gradient). The
    // custom swatch is lit while that kind of custom colour is in use, and is
    // cleared by picking any fixed choice or the other kind.
    const plainSwatches = el('div', 'accent-swatches');
    const gradientSwatches = el('div', 'accent-swatches');
    const presetButtons = [];
    const applyCustomBg = (paint) => {
      const wasMedia = background.kind === 'media';
      dropMedia(); // a colour replaces any picture/video (and its saved file)
      if (wasMedia) { background = { kind: 'preset', preset: 'black' }; saveBackground(); }
      adv.bgColor = paint; saveAdvanced();
      presetButtons.forEach(b => b.setAttribute('aria-pressed', 'false'));
      (typeof paint === 'string' ? customGradient : customPlain).setColor(null);
      refresh();
    };
    const bgFallback = () => (bgIsLight() ? '#ffffff' : '#000000');
    const customPlain = colorPicker(translate, 'presCustomBgColor',
      typeof adv.bgColor === 'string' ? adv.bgColor : null, bgFallback, applyCustomBg, { kind: 'solid' });
    const customGradient = colorPicker(translate, 'presCustomBgGradient',
      adv.bgColor && typeof adv.bgColor === 'object' ? adv.bgColor : null, bgFallback, applyCustomBg, { kind: 'gradient' });
    Object.entries(BACKGROUNDS).forEach(([id, [label, css]]) => {
      const button = el('button', 'accent-swatch pres-swatch');
      button.type = 'button';
      button.style.setProperty('--pres-swatch-color', css);
      button.dataset.presBackground = id;
      button.setAttribute('aria-label', translate(label));
      button.setAttribute('aria-pressed', String(background.kind === 'preset' && !adv.bgColor && background.preset === id));
      button.addEventListener('click', () => {
        dropMedia(); // a colour replaces any picture/video (and its saved file)
        background = { kind: 'preset', preset: id };
        adv.bgColor = null;
        saveBackground();
        saveAdvanced();
        presetButtons.forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        customPlain.setColor(null);
        customGradient.setColor(null);
        refresh();
      });
      presetButtons.push(button);
      (css.startsWith('linear-gradient') ? gradientSwatches : plainSwatches).appendChild(button);
    });
    plainSwatches.appendChild(customPlain);
    gradientSwatches.appendChild(customGradient);
    const plainRow = settingsRow(translate, 'presPlainColors', plainSwatches);
    const gradientRow = settingsRow(translate, 'presGradients', gradientSwatches);

    // Text colour: Auto / White / Black with the custom swatch beside it
    // (same two-line shape as the Effect row).
    const textChoices = TEXT_CHOICES.map(c => [c, translate('presText' + c[0].toUpperCase() + c.slice(1))]);
    const textSeg = segControl(translate, 'presTextColor', textChoices, adv.textColor ? null : textPref, (choice) => {
      textPref = choice;
      adv.textColor = null; // a fixed choice replaces any custom colour
      customText.setColor(null);
      savePref(LS_TEXT, choice);
      saveAdvanced();
      refresh();
    });
    const customText = colorPicker(translate, 'presCustomTextColor', adv.textColor, bgIsLight() ? '#111111' : '#ffffff', (paint) => {
      adv.textColor = paint; saveAdvanced();
      textSeg.select(null);
      refresh();
    }, { kind: 'both' });
    const textControl = el('div', 'pres-text-control');
    textControl.append(textSeg, customText);
    const textColorRow = settingsRow(translate, 'presTextColor', textControl, true);

    // One panel per tab: Text, Background, Effects, Other.
    const text = el('section', 'settings-section pres-panel');
    const effects = el('section', 'settings-section pres-panel');
    text.appendChild(choiceRow(translate, 'presFont', fontChoices(translate, adv.font), adv.font, (value) => {
      adv.font = value; saveAdvanced(); refresh();
    }));
    const fontStyleControl = segControl(translate, 'fontStyle',
      Object.entries(FONT_STYLES).map(([value, label]) => [value, translate(label)]), adv.fontStyle, (value) => {
        adv.fontStyle = value; saveAdvanced(); refresh();
      });
    fontStyleControl.classList.add('pres-font-style-toggle');
    text.appendChild(settingsRow(translate, 'fontStyle', fontStyleControl, true));
    text.appendChild(textColorRow);
    const effectOptions = el('div', 'pres-effect-options');
    const strength = el('input', 'app-range pres-range');
    strength.type = 'range';
    strength.min = '0';
    strength.max = '100';
    strength.step = '5';
    strength.setAttribute('aria-label', translate('presEffectStrength'));
    const strengthValue = el('output', 'pres-range-value');
    const strengthControl = el('div', 'pres-range-wrap');
    strengthControl.append(strength, strengthValue);
    effectOptions.appendChild(settingsRow(translate, 'presEffectStrength', strengthControl));

    const colorControl = el('div', 'pres-text-control');
    const auto = segControl(translate, 'presColor', [['auto', translate('presTextAuto')]],
      activeEffect().color ? null : 'auto', () => updateEffect({ color: null }));
    const custom = colorPicker(translate, 'presEffectCustomColor', activeEffect().color,
      autoEffectColor, color => updateEffect({ color }));
    colorControl.append(auto, custom);
    effectOptions.appendChild(settingsRow(translate, 'presColor', colorControl));

    function syncEffect() {
      const prefs = activeEffect();
      effectOptions.hidden = adv.effect === 'none';
      strength.value = prefs.strength;
      strengthValue.textContent = prefs.strength + '%';
      strength.style.setProperty('--p', prefs.strength + '%');
      auto.select(prefs.color ? null : 'auto');
      custom.setColor(prefs.color);
    }
    function updateEffect(changes) {
      adv.effects[adv.effect] = { ...activeEffect(), ...changes };
      saveAdvanced();
      syncEffect();
      refresh();
    }
    strength.addEventListener('input', () => updateEffect({ strength: Number(strength.value) }));

    effects.appendChild(settingsRow(translate, 'presEffect', segControl(translate, 'presEffect',
      EFFECTS.map(e => [e, translate('presEffect' + e[0].toUpperCase() + e.slice(1))]), adv.effect, (value) => {
        adv.effect = value;
        saveAdvanced();
        syncEffect();
        refresh();
      }), true));
    effects.appendChild(effectOptions);
    syncEffect();
    // Slide change: Cut or Fade. (Used to live in the presentation panel; it is
    // rarely changed mid-song. Hidden when the device asks for reduced motion,
    // because slides always cut then.)
    if (!reducedMotion()) {
      effects.appendChild(settingsRow(translate, 'presentationTransitionLabel', segControl(translate, 'presentationTransitionLabel',
        TRANSITIONS.map(tr => [tr, translate(tr === 'cut' ? 'presentationCut' : 'presentationFade')]), transition, (value) => {
          transition = value; savePref(LS_TRANSITION, value);
        }), true));
    }

    // Title slide: one switch per part.
    const titles = el('section', 'settings-section pres-panel');
    const switches = {};
    for (const key of titleOptions) {
      const sw = el('button', 'switch');
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-label', translate(key));
      sw.setAttribute('aria-checked', String(titlePrefs[key] !== false));
      sw.appendChild(el('span', 'switch-knob'));
      switches[key] = sw;
      sw.addEventListener('click', () => {
        const on = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', String(on));
        titlePrefs[key] = on;
        try { localStorage.setItem('sb-pres-title', JSON.stringify(titlePrefs)); } catch (_) {}
        if (key === 'presTitleSlide') titleOptions.slice(1).forEach(k => { switches[k].disabled = !on; });
        if (titlePrefs.presTitleSlide === false) refresh();
        else showTitle();
      });
      if (key !== 'presTitleSlide') sw.disabled = titlePrefs.presTitleSlide === false;
      titles.appendChild(settingsRow(translate, key, sw));
    }

    // Background media and dimming belong directly to Presentation Settings;
    // there is no separate Advanced page to hunt through.
    const media = mediaControls(translate, refresh);
    media.classList.add('pres-panel');
    media.insertBefore(gradientRow, media.firstChild); // Plain colors, then Gradients, then picture/video
    media.insertBefore(plainRow, media.firstChild);

    // One Reset for the entire look. Title-slide switches
    // are content choices, not look, so they stay.
    const reset = el('button', 'btn-secondary', translate('presResetLook'));
    reset.type = 'button';
    reset.id = 'presentation-reset';
    reset.addEventListener('click', () => {
      dropMedia();
      background = { kind: 'preset', preset: 'black' };
      adv = { ...ADV_DEFAULTS, effects: {} };
      textPref = 'auto';
      transition = DEFAULT_TRANSITION;
      saveBackground();
      saveAdvanced();
      savePref(LS_TEXT, 'auto');
      savePref(LS_TRANSITION, DEFAULT_TRANSITION);
      settings(translate); // rebuild with the defaults
    });
    const resetRow = el('div', 'settings-row pres-reset-row');
    resetRow.appendChild(reset);
    titles.appendChild(resetRow);

    // The pill selector under the preview (same look as the song database
    // picker) shows one panel at a time.
    const panels = { text, background: media, effects, other: titles };
    const showTab = (tab) => {
      settingsTab = tab;
      Object.entries(panels).forEach(([name, panel]) => { panel.hidden = name !== tab; });
    };
    const tabs = segControl(translate, 'presSettingsTitle', [
      ['text', translate('presAdvText')],
      ['background', translate('presAdvBackground')],
      ['effects', translate('presTabEffects')],
      ['other', translate('presTabOther')],
    ], settingsTab, showTab);
    tabs.classList.add('pres-tabs');
    showTab(settingsTab);
    container.append(preview, tabs, text, media, effects, titles);
    if (typeof initIcons === 'function') initIcons(container);
  }

  // A row that opens a list in a dialog (used for Font).
  function choiceRow(translate, labelKey, choices, selected, onChoose) {
    const button = el('button', 'settings-row settings-row-nav');
    const text = el('div', 'settings-row-text');
    const labelOf = (value) => (choices.find(choice => choice.value === value) || choices[0]).label;
    const current = el('span', 'settings-row-sub', labelOf(selected));
    text.append(el('span', 'settings-row-title', translate(labelKey)), current);
    button.innerHTML = '<svg class="settings-row-chevron" data-icon="back-arrow" viewBox="0 0 24 24" aria-hidden="true"></svg>';
    button.prepend(text);
    button.type = 'button';
    button.dataset.presPicker = labelKey;
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
      openChoiceModal(translate(labelKey), choices, selected, value => {
        selected = value;
        current.textContent = labelOf(value);
        onChoose(value);
      });
    });
    return button;
  }

  // HEX box plus Hue / Saturation / Lightness sliders for ONE colour. The same
  // selector is used for a plain colour and for each end of a gradient.
  // onChange gets the new '#rrggbb', or null while the typed HEX is not valid.
  function colorFields(translate, onChange) {
    const box = el('div', 'pres-color-fields');
    const hexRow = el('label', 'pres-color-row', 'HEX');
    const hexInput = el('input', 'pres-color-hex');
    hexInput.type = 'text';
    hexInput.spellcheck = false;
    hexInput.maxLength = 7;
    hexRow.appendChild(hexInput);
    box.appendChild(hexRow);
    const sliders = [['colorHue', 359, 1], ['colorSaturation', 100, 0.1], ['colorLightness', 100, 0.1]].map(([label, max, step]) => {
      const row = el('label', 'pres-color-row', translate(label));
      const slider = el('input', 'app-range');
      slider.type = 'range';
      slider.min = '0';
      slider.max = String(max);
      slider.step = String(step);
      row.appendChild(slider);
      box.appendChild(row);
      return slider;
    });
    sliders[0].style.setProperty('--pres-channel-track', 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)');
    const paintTracks = () => {
      const [h, s, l] = sliders.map(slider => Number(slider.value));
      sliders[1].style.setProperty('--pres-channel-track', `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))`);
      sliders[2].style.setProperty('--pres-channel-track', `linear-gradient(to right, #000, hsl(${h} ${s}% 50%), #fff)`);
    };
    const moveSliders = (hex) => {
      const { h, s, l } = hexToHsl(hex);
      [h, s * 100, l * 100].forEach((v, i) => { sliders[i].value = String(v); });
      paintTracks();
    };
    hexInput.addEventListener('input', () => {
      const candidate = hexInput.value.trim();
      const hex = candidate.startsWith('#') ? candidate : '#' + candidate;
      const valid = HEX.test(hex);
      hexInput.setAttribute('aria-invalid', String(!valid));
      if (!valid) { onChange(null); return; }
      moveSliders(hex);
      onChange(hex.toLowerCase());
    });
    for (const slider of sliders) {
      slider.addEventListener('input', () => {
        const [h, s, l] = sliders.map(x => Number(x.value));
        const hex = hslToHex(h, s / 100, l / 100);
        hexInput.value = hex;
        hexInput.setAttribute('aria-invalid', 'false');
        paintTracks();
        onChange(hex);
      });
    }
    return {
      el: box,
      // Shows a colour without reporting a change.
      set(hex) {
        hexInput.value = hex;
        hexInput.setAttribute('aria-invalid', 'false');
        moveSliders(hex);
      },
    };
  }

  // kind: 'solid' (one colour), 'gradient' (two colours) or 'both' (a Solid /
  // Gradient switch at the top of the editor).
  function colorPicker(translate, labelKey, value, fallback, onInput, { kind = 'solid' } = {}) {
    const button = el('button', 'accent-swatch pres-swatch pres-custom');
    button.type = 'button';
    button.dataset.presPicker = labelKey;
    button.setAttribute('aria-label', translate(labelKey));
    button.setAttribute('aria-haspopup', 'dialog');
    const show = (hex) => {
      button.style.setProperty('--pres-swatch-color', paintCss(hex) || 'conic-gradient(#f44, #fd4, #4d6, #4bf, #84f, #f4a, #f44)');
      button.dataset.selected = String(!!hex);
      button.setAttribute('aria-pressed', String(!!hex));
    };
    show(value);
    // Lets the page clear (or set) this swatch when a fixed choice is picked.
    button.setColor = (hex) => { value = hex || null; show(value); };
    button.addEventListener('click', () => {
      const editor = el('div', 'pres-color-editor');
      const preview = el('div', 'pres-color-sample');
      const defaultColor = typeof fallback === 'function' ? fallback() : fallback;
      const initialGradient = value && typeof value === 'object' ? value : null;
      const solidStart = typeof value === 'string' ? value : (initialGradient ? initialGradient.start : defaultColor);
      const actions = el('div', 'modal-actions');
      const cancel = el('button', 'btn-secondary', translate('cancelBtn'));
      const done = el('button', 'btn-primary', translate('doneBtn'));
      cancel.type = done.type = 'button';
      actions.append(cancel, done);

      let draft = null;
      let solidHex = solidStart.toLowerCase();

      // Plain colour.
      const solid = colorFields(translate, (hex) => {
        solidHex = hex;
        draft = hex;
        done.disabled = !hex;
        if (hex) preview.style.background = hex;
      });
      solid.set(solidHex);

      // Gradient: pick which end to edit, then use the same colour selector.
      const stops = { start: (initialGradient?.start || solidHex).toLowerCase(), end: (initialGradient?.end || '#40a8e8').toLowerCase() };
      let editing = 'start';
      const gradientBox = el('div', 'pres-color-editor');
      const stopFields = colorFields(translate, (hex) => {
        if (!hex) { done.disabled = true; return; }
        stops[editing] = hex;
        drawGradient();
      });
      stopFields.set(stops.start);
      const stopTabs = segControl(translate, labelKey,
        [['start', translate('presGradientStart')], ['end', translate('presGradientEnd')]], 'start', (which) => {
          editing = which;
          stopFields.set(stops[which]);
        });
      const rangeRow = (key, min, max, initial, format) => {
        const row = el('label', 'pres-color-row', translate(key));
        const input = el('input', 'app-range');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.value = String(initial);
        const output = el('output', 'pres-range-value');
        const wrap = el('span', 'pres-range-wrap');
        wrap.append(input, output);
        row.append(wrap);
        const sync = () => {
          output.textContent = format(Number(input.value));
          input.style.setProperty('--p', ((Number(input.value) - min) / (max - min) * 100) + '%');
        };
        input.addEventListener('input', () => { sync(); drawGradient(); });
        sync();
        return { row, input };
      };
      const angle = rangeRow('presGradientAngle', 0, 359, initialGradient?.angle ?? 90, v => v + '°');
      const position = rangeRow('presGradientPosition', 0, 100, initialGradient?.position ?? 50, v => v + '%');
      function drawGradient() {
        draft = { start: stops.start, end: stops.end, angle: Number(angle.input.value), position: Number(position.input.value) };
        preview.style.background = paintCss(draft);
        done.disabled = false;
      }
      gradientBox.append(stopTabs, stopFields.el, angle.row, position.row);

      const selectMode = (selected) => {
        solid.el.hidden = selected !== 'solid';
        gradientBox.hidden = selected !== 'gradient';
        if (selected === 'gradient') drawGradient();
        else {
          draft = solidHex;
          done.disabled = !solidHex;
          if (solidHex) preview.style.background = solidHex;
        }
      };
      const startMode = kind === 'both' ? (initialGradient ? 'gradient' : 'solid') : kind;
      if (kind === 'both') {
        editor.append(segControl(translate, labelKey,
          [['solid', translate('presSolid')], ['gradient', translate('presGradient')]], startMode, selectMode));
      }
      editor.append(preview, solid.el, gradientBox, actions);
      selectMode(startMode);

      cancel.addEventListener('click', () => closeModal({ immediate: true }));
      done.addEventListener('click', () => {
        value = draft;
        show(value);
        onInput(value);
        closeModal({ immediate: true });
      });
      openModal(translate(labelKey), editor);
    });
    return button;
  }

  // Media / dimming controls on the ordinary Presentation Settings page.
  // The picker is an ordinary app dialog; nothing requires a second page.
  function mediaControls(translate, refresh) {
    const bg = el('section', 'settings-section');

    // Picture or video from this device. It is remembered automatically on
    // this device (IndexedDB), so it is still there after the app is closed.
    const picker = el('input'); picker.type = 'file'; picker.accept = 'image/*,video/*'; picker.hidden = true;
    picker.id = 'pres-background-file';
    const choose = el('button', 'btn-secondary');
    choose.type = 'button'; choose.addEventListener('click', () => picker.click());
    const remove = el('button', 'btn-secondary', translate('presRemoveMedia'));
    remove.type = 'button'; remove.id = 'pres-background-remove';
    const mediaRow = el('div', 'settings-row pres-row-wide');
    const mediaText = el('div', 'settings-row-text');
    mediaText.append(el('span', 'settings-row-title', translate('presMedia')), el('p', 'settings-row-sub', translate('presLocalHelp')));
    const status = el('p', 'settings-row-sub'); status.id = 'pres-media-status'; status.setAttribute('role', 'status');
    mediaText.appendChild(status);
    const actions = el('div', 'settings-row-actions');
    actions.append(choose, remove);
    mediaRow.append(mediaText, actions, picker);
    bg.appendChild(mediaRow);

    function mediaStatusKey() {
      return { saved: 'presFileSaved', session: 'presFileNotSaved', missing: 'presFileMissing' }[mediaState] || null;
    }
    function syncMediaUI() {
      const isMedia = background.kind === 'media';
      choose.textContent = translate(!isMedia ? 'presChooseMedia' : mediaState === 'missing' ? 'presRelinkMedia' : 'presChangeMedia');
      remove.hidden = !isMedia;
      const key = mediaStatusKey();
      status.textContent = isMedia ? background.name + (key ? ' — ' + translate(key) : '') : '';
      status.hidden = !status.textContent; // an empty line would leave a gap above the buttons
    }

    const range = el('input', 'pres-range app-range');
    range.type = 'range'; range.min = '0'; range.max = String(DIM_MAX); range.step = '5';
    range.value = String(adv.dim);
    range.setAttribute('aria-label', translate('presDim'));
    const value = el('span', 'pres-range-value', adv.dim + '%');
    // --p is the filled part of the shared .app-range groove (0–100%).
    const fill = () => range.style.setProperty('--p', (Number(range.value) / DIM_MAX * 100) + '%');
    fill();
    function syncDim() { range.value = String(adv.dim); value.textContent = adv.dim + '%'; fill(); }
    range.addEventListener('input', () => {
      adv.dim = Number(range.value); value.textContent = adv.dim + '%';
      fill();
      saveAdvanced(); refresh();
    });

    picker.addEventListener('change', () => {
      const file = picker.files[0];
      if (!file) return;
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null;
      if (!kind) { status.textContent = translate('presMediaError'); picker.value = ''; return; }
      releaseMedia();
      mediaURL = URL.createObjectURL(file);
      background = { kind: 'media', media: kind, name: file.name };
      saveBackground();
      mediaState = 'saving';
      // Lyrics over a raw photo are hard to read: start a little dimmed.
      if (adv.dim === 0) { adv.dim = AUTO_DIM; saveAdvanced(); syncDim(); }
      syncMediaUI();
      refresh();
      const stillCurrent = () => background.kind === 'media' && background.name === file.name;
      saveMediaFile(file, kind).then(() => {
        if (stillCurrent()) { mediaState = 'saved'; syncMediaUI(); }
      }).catch(() => {
        deleteMediaFile(); // never leave an older file behind under the new name
        if (stillCurrent()) { mediaState = 'session'; syncMediaUI(); }
      });
      picker.value = '';
    });
    remove.addEventListener('click', () => {
      dropMedia();
      background = { kind: 'preset', preset: 'black' };
      saveBackground();
      syncMediaUI();
      refresh();
    });

    const rangeWrap = el('div', 'pres-range-wrap');
    rangeWrap.append(range, value);
    bg.appendChild(settingsRow(translate, 'presDim', rangeWrap));

    syncMediaUI();
    ensureMedia().then(ok => { syncMediaUI(); if (ok) refresh(); });

    return bg;
  }

  // ---------- preferences ----------
  function loadPrefs() {
    loadTitlePrefs();
    loadBackground();
    loadTextPref();
    loadAdvanced();
    try {
      const lines = parseInt(localStorage.getItem(LS_LINES), 10);
      if (LINE_CHOICES.includes(lines)) linesPerSlide = lines;
      const size = parseInt(localStorage.getItem(LS_SIZE), 10);
      if (Number.isInteger(size) && size >= 0 && size < SIZE_STEPS.length) sizeIndex = size;
      const tr = localStorage.getItem(LS_TRANSITION);
      if (TRANSITIONS.includes(tr)) transition = tr;
    } catch (_) {}
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
  }

  // Devices that ask for reduced motion always get Cut; the saved choice is
  // left alone so it comes back if the setting is turned off.
  function reducedMotion() { return !!(motionQuery && motionQuery.matches); }
  function effectiveTransition() { return reducedMotion() ? 'cut' : transition; }
  function canAnimate() {
    return effectiveTransition() === 'fade' && typeof Element.prototype.animate === 'function';
  }

  // ---------- slide model (plain data, no DOM) ----------
  function plainLine(raw) {
    return String(raw).replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Same section rules as renderLyrics(): blank lines separate sections, and
  // "Label:" at the start of a line names a part. Chord-only lines and
  // instrumental sections produce no slide.
  function buildSections(lyrics) {
    const sections = [];
    let current = [];
    (lyrics || []).forEach(raw => {
      if (String(raw).trim() === '') {
        if (current.length) { sections.push(current); current = []; }
      } else current.push(raw);
    });
    if (current.length) sections.push(current);

    const out = [];
    sections.forEach(sectionLines => {
      let label = null;
      const lines = [];
      sectionLines.forEach((raw, i) => {
        let line = i === 0 ? String(raw).replace(/^\s+/, '') : String(raw);
        const split = typeof splitLyricSectionLabel === 'function' ? splitLyricSectionLabel(line) : null;
        if (split) {
          // A later label starts a new part inside the same blank-line block.
          if (lines.length) { out.push({ label, lines: lines.splice(0) }); }
          label = split.label;
          line = split.content;
        }
        const text = plainLine(line);
        if (text) lines.push(line.replace(/\[[^\]]*\]/g, ''));
      });
      if (lines.length) out.push({ label, lines });
    });
    return out;
  }

  // perSlide: 1-4 = that many lines per slide; 0 (FILL) = as many lines as
  // fit. "Fits" is decided by the optional fits(label, lines) callback, because
  // it depends on the screen and text size; without it (tests, a future PNG
  // exporter) Fill keeps a whole section together. A part never spills into the
  // next one, and every lyric slide records where it came from (section, start)
  // so the audience can be kept on the same lyric when the grouping changes.
  function buildSlides(song, perSlide, titleInfo, fits) {
    const result = [];
    if (titleInfo && (titleInfo.title || titleInfo.artist || (titleInfo.number != null && titleInfo.number !== ''))) result.push({ kind: 'title', number: titleInfo.number, title: titleInfo.title, artist: titleInfo.artist });
    buildSections(song.lyrics).forEach((section, si) => {
      const total = section.lines.length;
      let start = 0;
      while (start < total) {
        let end;
        if (perSlide > 0) end = Math.min(total, start + perSlide);
        else if (typeof fits !== 'function') end = total;
        else {
          // The first line always gets a slide (it is shrunk later if it is
          // taller than the screen); more lines join while they still fit.
          end = start + 1;
          while (end < total && fits(section.label, section.lines.slice(start, end + 1))) end++;
        }
        result.push({ kind: 'lyrics', label: section.label, lines: section.lines.slice(start, end), section: si, start });
        start = end;
      }
    });
    return result;
  }

  function anchorOf(slide) {
    return slide && slide.kind === 'lyrics' ? { section: slide.section, line: slide.start } : null;
  }
  function locate(list, anchor) {
    if (!anchor) return 0;
    const found = list.findIndex(s => s.kind === 'lyrics' && s.section === anchor.section &&
      anchor.line >= s.start && anchor.line < s.start + s.lines.length);
    return found >= 0 ? found : 0;
  }
  function sameSlides(a, b) {
    return a.length === b.length && a.every((s, i) => s.kind === b[i].kind && s.section === b[i].section &&
      s.start === b[i].start && (s.lines ? s.lines.length : 0) === (b[i].lines ? b[i].lines.length : 0));
  }

  // ---------- DOM ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function escapeHtmlLocal(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const escapeAttr = escapeHtmlLocal;

  function addLyricText(parent, rawLine) {
    if (typeof encodeLyricMarkdown === 'function' && typeof appendFormattedLyricText === 'function') {
      appendFormattedLyricText(parent, encodeLyricMarkdown(rawLine).replace(/\s+/g, ' ').trim(),
        { italic: false, bold: false, boldItalic: false });
    } else parent.textContent = plainLine(rawLine);
  }

  function buildLine(rawLine) {
    const p = el('p', 'pres-line');
    addLyricText(p, rawLine);
    return p;
  }

  function buildCard(slide) {
    const card = el('div', 'pres-slide ' + (slide.kind === 'title' ? 'is-title' : 'is-lyrics'));
    if (slide.kind === 'title') {
      if (slide.number != null && slide.number !== '') card.appendChild(el('div', 'pres-title-number', '#' + slide.number));
      if (slide.title) card.appendChild(el('div', 'pres-title-text', slide.title));
      if (slide.artist) card.appendChild(el('div', 'pres-title-artist', slide.artist));
    } else {
      if (slide.label) card.appendChild(el('div', 'pres-label', slide.label));
      slide.lines.forEach(line => card.appendChild(buildLine(line)));
    }
    if (adv.textColor && typeof adv.textColor === 'object') {
      const fill = el('div', 'pres-gradient-fill');
      fill.append(...card.childNodes);
      if (adv.effect !== 'none' && activeEffect().strength > 0) {
        const effect = fill.cloneNode(true);
        effect.className = 'pres-gradient-effect';
        effect.setAttribute('aria-hidden', 'true');
        card.append(effect);
      }
      card.append(fill);
    }
    return card;
  }

  function buildOverlay() {
    const t = cfg.t;
    const o = el('div', 'pres-overlay');
    o.id = 'presentation-overlay';
    o.tabIndex = -1;
    o.dataset.transition = effectiveTransition();
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-label', t('presentationModeBtn'));

    const backgroundLayer = el('div', 'pres-bg');
    paintBackground(backgroundLayer);
    applyTone(o);
    o.appendChild(backgroundLayer);
    const stage = el('div', 'pres-stage');
    stage.setAttribute('aria-live', 'polite');
    o.appendChild(stage);

    const chip = (attr, value, text, extra) =>
      `<button type="button" class="pres-btn pres-chip${attr === 'data-pres-lines' && value !== FILL ? ' pres-round-btn' : ''}" ${attr}="${value}" aria-pressed="false"${extra || ''}>${escapeHtmlLocal(text)}</button>`;
    const bar = el('div', 'pres-bar');
    bar.innerHTML = `
      <div class="pres-head">
        <button type="button" class="pres-btn pres-icon-btn" data-pres="close" aria-label="${escapeAttr(t('presentationExit'))}"><svg data-icon="close" viewBox="0 0 24 24"></svg></button>
        <span class="pres-counter" aria-hidden="true"></span>
      </div>
      <div class="pres-group" role="group" aria-label="${escapeAttr(t('presentationLinesLabel'))}">
        <span class="pres-group-label">${escapeHtmlLocal(t('presentationLinesLabel'))}</span>
        ${LINE_CHOICES.map(n => chip('data-pres-lines', n, n === FILL ? t('presentationFillLines') : String(n))).join('')}
      </div>
      <div class="pres-group" role="group" aria-label="${escapeAttr(t('presentationTextSize'))}">
        <span class="pres-group-label">${escapeHtmlLocal(t('presentationTextSize'))}</span>
        <button type="button" class="pres-btn pres-chip pres-round-btn" data-pres="smaller" aria-label="${escapeAttr(t('presentationSmaller'))}">A−</button>
        <button type="button" class="pres-btn pres-chip pres-round-btn" data-pres="larger" aria-label="${escapeAttr(t('presentationLarger'))}">A+</button>
      </div>
      <div class="pres-tools">
        <button type="button" class="pres-btn pres-icon-btn" data-pres="blank" aria-pressed="false" aria-label="${escapeAttr(t('presentationBlank'))}" title="${escapeAttr(t('presentationBlank'))}"><svg data-icon="visibility-off" viewBox="0 0 24 24"></svg></button>
        <button type="button" class="pres-btn pres-icon-btn" data-pres="fullscreen" aria-pressed="false" aria-label="${escapeAttr(t('presentationFullscreen'))}" title="${escapeAttr(t('presentationFullscreen'))}"><svg class="pres-fs-on" data-icon="fullscreen" viewBox="0 0 24 24"></svg><svg class="pres-fs-off" data-icon="fullscreen-exit" viewBox="0 0 24 24" hidden></svg></button>
        <button type="button" class="pres-btn pres-icon-btn" data-pres="settings" aria-label="${escapeAttr(t('presentationSettings'))}" title="${escapeAttr(t('presentationSettings'))}"><svg data-icon="nav-settings" viewBox="0 0 24 24"></svg></button>
      </div>`;
    // Only offer what can work here: no Full screen where the browser has no
    // element full screen (iPhone), no Settings button without a handler.
    bar.querySelector('[data-pres="fullscreen"]').hidden = !fsSupported();
    bar.querySelector('[data-pres="settings"]').hidden = typeof cfg.onOpenSettings !== 'function';
    o.appendChild(bar);

    const hint = el('div', 'pres-hint');
    hint.textContent = t('presentationHint');
    o.appendChild(hint);

    // Shown briefly on the first few launches (see showIntro) so the hidden
    // panel can be found without reading any manual.
    const intro = el('div', 'pres-intro');
    intro.setAttribute('aria-hidden', 'true');
    intro.textContent = t(window.matchMedia && window.matchMedia('(hover: none)').matches ? 'presentationIntroTouch' : 'presentationIntroMouse');
    o.appendChild(intro);
    return o;
  }

  // ---------- sizing ----------
  // One unit for the whole screen: ~7% of the geometric mean of width and
  // height, so a desktop window and a phone both get a comfortable default
  // (about 67px on 1280x720, 40px on a phone) and the step multipliers feel
  // the same everywhere.
  function baseUnit() {
    return Math.sqrt(window.innerWidth * window.innerHeight) * 0.07;
  }

  // The area a slide must fit in (the stage minus its padding) and the chosen
  // lyric text size.
  function metrics() {
    const stage = root.querySelector('.pres-stage');
    const cs = getComputedStyle(stage);
    return {
      px: baseUnit() * SIZE_STEPS[sizeIndex],
      availW: stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      availH: stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
    };
  }

  // The chosen size is applied exactly. Long lines wrap between words (they
  // never shrink the text). Only if a slide still cannot fit on the screen at
  // that size - too tall, or one word wider than the screen - is that one slide
  // reduced, to the largest size that fits (binary search, so the result never
  // wobbles between steps).
  function fitText() {
    if (!root) return;
    const card = root.querySelector('.pres-slide.is-current');
    if (!card) return;
    const m = metrics();
    const chosen = m.px * (card.classList.contains('is-title') ? 0.9 : 1);
    card.style.overflowWrap = '';
    const fits = (px) => {
      card.style.fontSize = px + 'px';
      return card.scrollWidth <= m.availW + 1 && card.scrollHeight <= m.availH + 1;
    };
    if (fits(chosen)) return;
    // Search a fixed 0.5px grid, so the result is always "the largest size on
    // the grid that fits" and does not depend on where the search started.
    let lo = Math.min(Math.ceil(MIN_FONT_PX * 2), Math.floor(chosen * 2));
    let hi = Math.floor(chosen * 2) + 1; // never fits: it is at or above the chosen size
    // Not even the smallest size fits (an absurdly long word): only now break inside words.
    if (!fits(lo / 2)) { card.style.overflowWrap = 'anywhere'; card.style.fontSize = (lo / 2) + 'px'; return; }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (fits(mid / 2)) lo = mid; else hi = mid;
    }
    card.style.fontSize = (lo / 2) + 'px';
  }

  // Measures candidate groups of lines in a hidden card that has exactly the
  // width, text size and styling of a real slide, for Fill. Lines are added one
  // at a time to the previous measurement, so a part costs one layout per line.
  function createFitter() {
    const m = metrics();
    if (m.availW <= 0 || m.availH <= 0) return { fits: () => false, done() {} };
    const stage = root.querySelector('.pres-stage');
    const card = el('div', 'pres-slide is-lyrics pres-measure');
    card.setAttribute('aria-hidden', 'true');
    card.style.fontSize = m.px + 'px';
    card.style.width = m.availW + 'px';
    stage.appendChild(card);
    let label = null, measured = [];
    return {
      fits(lbl, lines) {
        const grows = lbl === label && lines.length === measured.length + 1 && measured.every((l, i) => l === lines[i]);
        if (grows) card.appendChild(buildLine(lines[lines.length - 1]));
        else {
          card.textContent = '';
          if (lbl) card.appendChild(el('div', 'pres-label', lbl));
          lines.forEach(l => card.appendChild(buildLine(l)));
          label = lbl;
        }
        measured = lines;
        return card.scrollHeight <= m.availH + 1;
      },
      done() { card.remove(); },
    };
  }

  function computeSlides() {
    const title = cfg.titleInfo && titlePrefs.presTitleSlide !== false ? { ...cfg.titleInfo } : null;
    if (title) {
      if (titlePrefs.presTitleText === false) delete title.title;
      if (titlePrefs.presTitleNumber === false) delete title.number;
      if (titlePrefs.presTitleArtist === false) delete title.artist;
    }
    if (linesPerSlide !== FILL) return buildSlides(cfg.song, linesPerSlide, title);
    const fitter = createFitter();
    try { return buildSlides(cfg.song, FILL, title, fitter.fits); }
    finally { fitter.done(); }
  }

  // Regroup the slides (the lines setting, or the screen/text size behind Fill,
  // changed) and stay on the lyric the audience is looking at.
  function regroup() {
    const anchor = anchorOf(slides[index]);
    slides = computeSlides();
    index = locate(slides, anchor);
  }

  // Window resized or fonts finished loading. Fill depends on both; anything
  // else only needs the current slide re-fitted.
  function scheduleRefresh() {
    if (refreshFrame || !root) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      if (!root) return;
      if (linesPerSlide === FILL) {
        const before = slides;
        regroup();
        if (!sameSlides(before, slides)) { renderSlide(); return; }
      }
      fitText();
    });
  }

  // ---------- rendering ----------
  // A slide change in Fade mode is a true crossfade: the new slide is laid over
  // the old one (same grid cell), the old fades out while the new fades in, and
  // the old is removed when done. Cut swaps instantly. Settings changes
  // (regrouping, size) never animate.
  function retire(node) {
    let from = parseFloat(getComputedStyle(node).opacity);
    if (!(from >= 0)) from = 1;
    node.getAnimations().forEach(a => a.cancel());
    node.classList.remove('is-current');
    node.classList.add('is-leaving');
    node.setAttribute('aria-hidden', 'true');
    const anim = node.animate([{ opacity: from }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease-in-out', fill: 'forwards' });
    anim.onfinish = () => node.remove();
  }

  function renderSlide(opts) {
    if (!root) return;
    const stage = root.querySelector('.pres-stage');
    const slide = slides[index];
    const card = slide ? buildCard(slide) : null;
    const fade = !!(opts && opts.animate) && !!card && canAnimate();
    const old = stage.querySelector('.pres-slide.is-current');
    if (old) {
      if (fade) retire(old);
      else old.remove();
    }
    if (!fade) stage.querySelectorAll('.pres-slide.is-leaving').forEach(n => n.remove());
    if (card) {
      card.classList.add('is-current');
      stage.appendChild(card);
      fitText();
      if (fade) card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-in-out' });
    }
    root.querySelector('.pres-counter').textContent = slides.length ? `${index + 1} / ${slides.length}` : '';
  }

  function setBlank(value) {
    blanked = value;
    if (root) {
      root.querySelector('.pres-stage').classList.toggle('is-blank', blanked);
      syncControls();
    }
  }

  function syncControls() {
    if (!root) return;
    root.dataset.transition = effectiveTransition();
    root.querySelectorAll('[data-pres-lines]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.presLines, 10) === linesPerSlide));
    });
    root.querySelector('[data-pres="smaller"]').disabled = sizeIndex <= 0;
    root.querySelector('[data-pres="larger"]').disabled = sizeIndex >= SIZE_STEPS.length - 1;
    root.querySelector('[data-pres="blank"]').setAttribute('aria-pressed', String(blanked));
    const full = root.querySelector('[data-pres="fullscreen"]');
    const isFull = !!fsElement();
    full.setAttribute('aria-pressed', String(isFull));
    const fullLabel = cfg.t(isFull ? 'presentationExitFullscreen' : 'presentationFullscreen');
    full.setAttribute('aria-label', fullLabel);
    full.title = fullLabel;
    full.querySelector('.pres-fs-on').hidden = isFull;
    full.querySelector('.pres-fs-off').hidden = !isFull;
  }

  // ---------- navigation and settings ----------
  let queuePosition = -1;
  function selectSong(position, fromEnd = false) {
    const song = cfg.queue?.[position];
    if (!song) return;
    queuePosition = position;
    cfg.song = song;
    cfg.titleInfo = { title: song.title, artist: song.artist, number: song.number };
    slides = computeSlides();
    index = fromEnd ? Math.max(0, slides.length - 1) : 0;
    setBlank(false);
    renderSlide({ animate: true });
  }

  function go(to) {
    resetNumber();
    if (queuePosition >= 0 && to > index && to >= slides.length) {
      selectSong(queuePosition + 1);
      return;
    }
    if (queuePosition > 0 && to < 0) {
      selectSong(queuePosition - 1, true);
      return;
    }
    if (!slides.length) return;
    const next = Math.max(0, Math.min(slides.length - 1, to));
    setBlank(false);
    if (next === index) return;
    index = next;
    renderSlide({ animate: true });
  }

  // A short delay only for ambiguous prefixes lets 12 select slide/song 12.
  let pendingNumber = '', numberTimer = null, queueNumber = false;
  function resetNumber() {
    clearTimeout(numberTimer);
    pendingNumber = '';
  }
  function numberKey(digit, queue) {
    const limit = queue ? (queuePosition >= 0 ? cfg.queue.length : 0) : slides.length;
    if (queue !== queueNumber) resetNumber();
    queueNumber = queue;
    clearTimeout(numberTimer);
    pendingNumber += digit;
    const n = Number(pendingNumber);
    if (!n || n > limit) { resetNumber(); return; }
    const jump = () => {
      resetNumber();
      if (queue) selectSong(n - 1);
      else if (n <= slides.length) go(n - 1);
    };
    if (n * 10 <= limit) numberTimer = setTimeout(jump, 450);
    else jump();
  }

  function setLines(n) {
    if (!LINE_CHOICES.includes(n) || n === linesPerSlide) return;
    linesPerSlide = n;
    savePref(LS_LINES, n);
    regroup();
    setBlank(false);
    syncControls();
    renderSlide();
  }

  function setSize(next) {
    const clamped = Math.min(SIZE_STEPS.length - 1, Math.max(0, next));
    if (clamped === sizeIndex) return;
    sizeIndex = clamped;
    savePref(LS_SIZE, sizeIndex);
    syncControls();
    if (linesPerSlide === FILL) { regroup(); renderSlide(); }
    else fitText();
  }

  // ---------- full screen ----------
  // Opening presentation mode asks for full screen right away: the click that
  // opened it is the user gesture browsers insist on. Browsers without element
  // full screen (iPhone Safari) simply skip it; an installed PWA there already
  // has no browser bars.
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function fsSupported(element = document.documentElement) {
    return !!((document.fullscreenEnabled && element.requestFullscreen)
      || (document.webkitFullscreenEnabled && element.webkitRequestFullscreen));
  }
  function enterFullscreen() {
    if (!root || fsElement() || !fsSupported()) return;
    try {
      const result = document.fullscreenEnabled && root.requestFullscreen
        ? root.requestFullscreen({ navigationUI: 'hide' })
        : root.webkitRequestFullscreen();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {}
  }
  function exitFullscreen() {
    try {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const result = exit && exit.call(document);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {}
  }
  function toggleFullscreen() {
    if (!root) return;
    if (fsElement()) exitFullscreen(); else enterFullscreen();
  }
  function onFullscreenChange() {
    if (!root) return;
    syncControls();
    scheduleRefresh();
  }

  function openSettings() {
    if (cfg && typeof cfg.onOpenSettings === 'function') cfg.onOpenSettings();
  }

  // ---------- first-launch hint ----------
  function readIntro() {
    try {
      const rec = JSON.parse(localStorage.getItem(LS_INTRO));
      if (rec && typeof rec === 'object') return { n: Number(rec.n) || 0, done: !!rec.done };
    } catch (_) {}
    return { n: 0, done: false };
  }
  function writeIntro(rec) {
    try { localStorage.setItem(LS_INTRO, JSON.stringify(rec)); } catch (_) {}
  }
  // A small line at the bottom for a few seconds, only for the first few
  // launches and never again once the panel has been opened.
  function showIntro() {
    const rec = readIntro();
    if (!root || rec.done || rec.n >= INTRO_MAX_LAUNCHES) return;
    rec.n += 1;
    writeIntro(rec);
    root.classList.add('show-intro');
    introTimer = setTimeout(() => { introTimer = null; if (root) root.classList.remove('show-intro'); }, INTRO_SHOW_MS);
  }
  function endIntro(learned) {
    clearTimeout(introTimer);
    introTimer = null;
    if (root) root.classList.remove('show-intro');
    if (learned) {
      const rec = readIntro();
      if (!rec.done) { rec.done = true; writeIntro(rec); }
    }
  }

  // ---------- controls visibility ----------
  // Hidden at launch and never shown by mouse movement alone. They appear for
  // the top edge, S, or a double-click/tap in the middle, and hide again by
  // themselves — but not while the pointer is on the panel.
  function controlsVisible() {
    return !!root && root.classList.contains('controls-visible');
  }

  function scheduleHide() {
    clearTimeout(idleTimer);
    if (panelHover) return;
    idleTimer = setTimeout(hideControls, inputIsTouch ? CONTROLS_IDLE_TOUCH_MS : CONTROLS_IDLE_MS);
  }

  function showControls() {
    if (!root) return;
    root.classList.add('controls-visible');
    endIntro(true);
    scheduleHide();
  }

  function hideControls() {
    clearTimeout(idleTimer);
    clearTimeout(edgeTimer);
    edgeTimer = null;
    if (root) root.classList.remove('controls-visible');
  }

  function onPointerMove(e) {
    if (e.pointerType !== 'mouse') return;
    if (e.clientY > EDGE_PX) {
      clearTimeout(edgeTimer);
      edgeTimer = null;
      return;
    }
    if (controlsVisible()) { scheduleHide(); return; }
    if (edgeTimer) return;
    edgeTimer = setTimeout(() => { edgeTimer = null; showControls(); }, EDGE_DWELL_MS);
  }

  // ---------- events ----------
  function onKeydown(e) {
    if (!root || e.ctrlKey || e.metaKey || e.altKey) return;
    const inBar = e.target && e.target.closest && e.target.closest('.pres-bar');
    const digit = /^Digit([0-9])$/.exec(e.code)?.[1] || (/^[0-9]$/.test(e.key) ? e.key : null);
    if (digit !== null) {
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat) {
        if (digit === '0' && !pendingNumber && !e.shiftKey) go(0);
        else numberKey(digit, e.shiftKey);
      }
      return;
    }
    resetNumber();
    let handled = true;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'n': case 'N':
        if (e.key === ' ' && inBar && e.target.tagName === 'BUTTON') { handled = false; break; }
        go(index + 1); break;
      case 'Enter':
        if (inBar && e.target.tagName === 'BUTTON') { handled = false; break; }
        go(index + 1); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': case 'p': case 'P':
        go(index - 1); break;
      case 'Home': go(0); break;
      case 'End': go(slides.length - 1); break;
      case 'b': case 'B': case '.':
        setBlank(!blanked); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 's': case 'S':
        if (!e.repeat) { if (controlsVisible()) hideControls(); else showControls(); }
        break;
      case '+': case '=': setSize(sizeIndex + 1); break;
      case '-': case '_': setSize(sizeIndex - 1); break;
      case 'Escape': requestClose(); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onBarClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    e.stopPropagation();
    if (btn.dataset.presLines != null) setLines(parseInt(btn.dataset.presLines, 10));
    else if (btn.dataset.pres === 'close') requestClose();
    else if (btn.dataset.pres === 'smaller') setSize(sizeIndex - 1);
    else if (btn.dataset.pres === 'larger') setSize(sizeIndex + 1);
    else if (btn.dataset.pres === 'blank') setBlank(!blanked);
    else if (btn.dataset.pres === 'fullscreen') toggleFullscreen();
    else if (btn.dataset.pres === 'settings') { openSettings(); return; }
    // After a mouse/touch click give focus back to the slide, so the panel's
    // focus doesn't keep it open and Space/arrows keep changing slides.
    if (e.detail > 0 && root) root.focus({ preventScroll: true });
    if (controlsVisible()) scheduleHide();
  }

  function onStagePointerDown(e) {
    if (e.target.closest('.pres-bar')) { lastMiddleClick = null; return; }
    swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }
  function onStagePointerUp(e) {
    if (!swipe || e.pointerId !== swipe.id || e.target.closest('.pres-bar')) { swipe = null; lastMiddleClick = null; return; }
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      lastMiddleClick = null;
      go(dx < 0 ? index + 1 : index - 1);
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { lastMiddleClick = null; return; }
    // Side taps navigate immediately. Only a nearby pair of middle taps or
    // clicks toggles controls; one stray middle tap leaves the projection clean.
    const x = e.clientX / window.innerWidth;
    if (x < 1 / 3) { lastMiddleClick = null; go(index - 1); }
    else if (x > 2 / 3) { lastMiddleClick = null; go(index + 1); }
    else {
      const now = performance.now();
      const last = lastMiddleClick;
      const tolerance = e.pointerType === 'mouse' ? 10 : 24;
      if (last && last.type === e.pointerType && now - last.t <= DOUBLE_CLICK_MS && Math.abs(e.clientX - last.x) <= tolerance && Math.abs(e.clientY - last.y) <= tolerance) {
        lastMiddleClick = null;
        if (controlsVisible()) hideControls(); else showControls();
      } else lastMiddleClick = { t: now, x: e.clientX, y: e.clientY, type: e.pointerType };
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && root) acquireWakeLock();
  }

  function onMotionChange() {
    if (root) syncControls();
  }

  async function acquireWakeLock() {
    try {
      if (!('wakeLock' in navigator) || wakeLock) return;
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) { wakeLock = null; }
  }
  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (_) {}
    wakeLock = null;
  }

  // ---------- open / close ----------
  // Capture a presentation before visiting Settings. An unsaved playlist
  // order or current slide must not disappear just because Settings was opened.
  function snapshot() {
    if (!root || !cfg) return null;
    return {
      song: cfg.song, queue: cfg.queue, titleInfo: { ...cfg.titleInfo },
      index, queuePosition, anchor: anchorOf(slides[index]),
      onTitle: slides[index]?.kind === 'title', blanked,
    };
  }
  // cfg: { song, titleInfo:{number,title,artist}, t, onRequestClose, resume? }
  function open(options) {
    if (root || !options || !options.song) return;
    cfg = { ...options };
    queuePosition = cfg.queue ? cfg.queue.indexOf(cfg.song) : -1;
    if (options.resume && Number.isInteger(options.resume.queuePosition) &&
        options.resume.queuePosition >= 0 && options.resume.queuePosition < (cfg.queue?.length || 0)) {
      queuePosition = options.resume.queuePosition;
    }
    loadPrefs();
    index = 0;
    blanked = false;
    panelHover = false;
    swipe = lastMiddleClick = null;
    restoreFocus = document.activeElement;

    root = buildOverlay();
    document.body.appendChild(root);
    if (typeof initIcons === 'function') initIcons(root);
    // Fill measures real layout, so the slides are built once the overlay is in
    // the page.
    slides = computeSlides();
    if (options.resume) {
      const previous = options.resume;
      index = previous.onTitle && slides[0]?.kind === 'title' ? 0 :
        previous.anchor ? locate(slides, previous.anchor) : Math.min(previous.index || 0, Math.max(0, slides.length - 1));
      blanked = !!previous.blanked;
    }
    syncControls();
    renderSlide();
    if (blanked) setBlank(true);

    const bar = root.querySelector('.pres-bar');
    bar.addEventListener('click', onBarClick);
    bar.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { panelHover = true; clearTimeout(idleTimer); } });
    bar.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { panelHover = false; if (controlsVisible()) scheduleHide(); } });
    root.addEventListener('pointerdown', e => { inputIsTouch = e.pointerType !== 'mouse'; }, true);
    root.addEventListener('pointerdown', onStagePointerDown);
    root.addEventListener('pointerup', onStagePointerUp);
    root.addEventListener('pointercancel', () => { swipe = lastMiddleClick = null; });
    root.addEventListener('pointermove', onPointerMove);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', scheduleRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    if (document.fonts) {
      // Lyric fonts can arrive after the first layout; Fill depends on them.
      document.fonts.addEventListener('loadingdone', scheduleRefresh);
      if (document.fonts.ready) document.fonts.ready.then(scheduleRefresh);
    }
    if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);

    document.documentElement.classList.add('pres-open');
    root.focus({ preventScroll: true });
    acquireWakeLock();

    // A saved picture/video that is not in memory yet (rare: it is normally
    // restored when the app starts) is painted as soon as it arrives.
    if (background.kind === 'media' && !mediaURL) {
      ensureMedia().then(ok => { if (ok && root) paintBackground(root.querySelector('.pres-bg')); });
    }
    // Request fullscreen while the launch click still has user activation.
    enterFullscreen();
    syncControls();
    showIntro();
  }

  function requestClose() {
    if (!root) return;
    if (cfg && typeof cfg.onRequestClose === 'function') cfg.onRequestClose();
    else close();
  }

  function close() {
    if (!root) return;
    clearTimeout(idleTimer);
    clearTimeout(edgeTimer);
    idleTimer = edgeTimer = null;
    if (refreshFrame) { cancelAnimationFrame(refreshFrame); refreshFrame = 0; }
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', scheduleRefresh);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    if (document.fonts) document.fonts.removeEventListener('loadingdone', scheduleRefresh);
    if (motionQuery && motionQuery.removeEventListener) motionQuery.removeEventListener('change', onMotionChange);
    clearTimeout(introTimer);
    introTimer = null;
    // The listener is already removed, so leaving full screen here is not
    // mistaken for the person turning it off.
    if (fsElement()) exitFullscreen();
    releaseWakeLock();
    root.querySelectorAll('.pres-bg video').forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); });
    root.remove();
    root = null;
    swipe = lastMiddleClick = null;
    resetNumber();
    cfg = null;
    slides = [];
    document.documentElement.classList.remove('pres-open');
    const back = restoreFocus;
    restoreFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') {
      try { back.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  // Bring a saved picture/video back into memory while the app is idle, so the
  // first presentation after a restart already has its background.
  loadBackground();
  ensureMedia();

  window.SongPresentation = {
    settings,
    snapshot,
    open,
    close,
    isOpen: () => !!root,
    // Exposed for tests and the future PNG exporter.
    buildSlides,
  };
})();
