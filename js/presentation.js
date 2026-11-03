// ============================================================================
// Presentation mode — full-screen lyric slides for projecting a song.
//
// Built desktop-first (most presentations are run from a computer: keyboard,
// mouse, fullscreen on a projector or second screen) while staying usable by
// touch. Chords are never shown. Lyrics are split into slides of N lines
// (1-4, or a whole section), shown large and centered.
//
// This module owns only the overlay. ui.js decides how it is opened/closed
// (history entry, popstate) and passes in what it needs — see
// openPresentationMode() there. No app state is read from here.
//
// Planned later (seams are left on purpose, nothing is implemented yet):
//   - changeable background: picture, animated background, video. The
//     background lives in its own layer (.pres-bg) so it can be swapped
//     without touching the lyric stage.
//   - PNG export: buildSlides() returns plain data (label + lines), separate
//     from the DOM in renderSlide(), so a canvas exporter can reuse it.
// ============================================================================
(function () {
  'use strict';

  const LS_LINES = 'sb-pres-lines';
  const LS_SIZE = 'sb-pres-size';
  const LINE_CHOICES = [1, 2, 3, 4, 0]; // 0 = whole section
  const DEFAULT_LINES = 2;
  // Text size is a real, absolute setting (not a starting point that gets
  // shrunk to fit). Each step is ~20% bigger than the last, so every press
  // visibly changes the text; the multiplier applies to a unit that follows the
  // screen size (see baseUnit()).
  const SIZE_STEPS = [0.45, 0.55, 0.67, 0.82, 1.0, 1.2, 1.45, 1.75, 2.1, 2.5];
  const DEFAULT_SIZE = 4;
  const MIN_FONT_PX = 12;
  const CONTROLS_IDLE_MS = 2500;
  const SWIPE_PX = 50;

  let root = null;        // overlay element while open
  let cfg = null;         // options passed to open()
  let slides = [];
  let index = 0;
  let linesPerSlide = DEFAULT_LINES;
  let sizeIndex = DEFAULT_SIZE;
  let blanked = false;
  let idleTimer = null;
  let wakeLock = null;
  let restoreFocus = null;
  let swipe = null;

  // ---------- preferences ----------
  function loadPrefs() {
    try {
      const lines = parseInt(localStorage.getItem(LS_LINES), 10);
      if (LINE_CHOICES.includes(lines)) linesPerSlide = lines;
      const size = parseInt(localStorage.getItem(LS_SIZE), 10);
      if (Number.isInteger(size) && size >= 0 && size < SIZE_STEPS.length) sizeIndex = size;
    } catch (_) {}
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) {}
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

  function buildSlides(song, perSlide, titleInfo) {
    const result = [];
    if (titleInfo && titleInfo.title) result.push({ kind: 'title', number: titleInfo.number, title: titleInfo.title, artist: titleInfo.artist });
    buildSections(song.lyrics).forEach(section => {
      const size = perSlide > 0 ? perSlide : section.lines.length;
      for (let i = 0; i < section.lines.length; i += size) {
        result.push({ kind: 'lyrics', label: section.label, lines: section.lines.slice(i, i + size) });
      }
    });
    return result;
  }

  // ---------- DOM ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function addLyricText(parent, rawLine) {
    if (typeof encodeLyricMarkdown === 'function' && typeof appendFormattedLyricText === 'function') {
      appendFormattedLyricText(parent, encodeLyricMarkdown(rawLine).replace(/\s+/g, ' ').trim(),
        { italic: false, bold: false, boldItalic: false });
    } else parent.textContent = plainLine(rawLine);
  }

  function buildOverlay() {
    const t = cfg.t;
    const o = el('div', 'pres-overlay');
    o.id = 'presentation-overlay';
    o.tabIndex = -1;
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-label', t('presentationModeBtn'));

    o.appendChild(el('div', 'pres-bg'));
    const stage = el('div', 'pres-stage');
    stage.setAttribute('aria-live', 'polite');
    o.appendChild(stage);

    const bar = el('div', 'pres-bar');
    bar.innerHTML = `
      <button type="button" class="pres-btn pres-icon-btn" data-pres="close" aria-label="${escapeAttr(t('presentationExit'))}"><svg data-icon="close" viewBox="0 0 24 24"></svg></button>
      <span class="pres-counter" aria-hidden="true"></span>
      <div class="pres-group" role="group" aria-label="${escapeAttr(t('presentationLinesLabel'))}">
        <span class="pres-group-label">${escapeHtmlLocal(t('presentationLinesLabel'))}</span>
        ${LINE_CHOICES.map(n => `<button type="button" class="pres-btn pres-chip" data-pres-lines="${n}" aria-pressed="false">${n === 0 ? escapeHtmlLocal(t('presentationAllLines')) : n}</button>`).join('')}
      </div>
      <div class="pres-group" role="group" aria-label="${escapeAttr(t('presentationTextSize'))}">
        <span class="pres-group-label">${escapeHtmlLocal(t('presentationTextSize'))}</span>
        <button type="button" class="pres-btn pres-chip" data-pres="smaller" aria-label="${escapeAttr(t('presentationSmaller'))}">A−</button>
        <button type="button" class="pres-btn pres-chip" data-pres="larger" aria-label="${escapeAttr(t('presentationLarger'))}">A+</button>
      </div>`;
    o.appendChild(bar);

    const hint = el('div', 'pres-hint');
    hint.textContent = t('presentationHint');
    o.appendChild(hint);
    return o;
  }

  function escapeHtmlLocal(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const escapeAttr = escapeHtmlLocal;

  function renderSlide() {
    if (!root) return;
    const stage = root.querySelector('.pres-stage');
    const slide = slides[index];
    stage.textContent = '';
    stage.classList.toggle('is-blank', blanked);
    if (slide) {
      const card = el('div', 'pres-slide ' + (slide.kind === 'title' ? 'is-title' : 'is-lyrics'));
      if (slide.kind === 'title') {
        if (slide.number != null && slide.number !== '') card.appendChild(el('div', 'pres-title-number', '#' + slide.number));
        card.appendChild(el('div', 'pres-title-text', slide.title));
        if (slide.artist) card.appendChild(el('div', 'pres-title-artist', slide.artist));
      } else {
        if (slide.label) card.appendChild(el('div', 'pres-label', slide.label));
        slide.lines.forEach(line => {
          const p = el('p', 'pres-line');
          addLyricText(p, line);
          card.appendChild(p);
        });
      }
      stage.appendChild(card);
    }
    root.querySelector('.pres-counter').textContent = slides.length ? `${index + 1} / ${slides.length}` : '';
    fitText();
  }

  // One unit for the whole screen: ~7% of the geometric mean of width and
  // height, so a desktop window and a phone both get a comfortable default
  // (about 67px on 1280x720, 40px on a phone) and the step multipliers feel
  // the same everywhere.
  function baseUnit() {
    return Math.sqrt(window.innerWidth * window.innerHeight) * 0.07;
  }

  // The chosen size is applied exactly. Only if a slide cannot fit on the
  // screen at that size is that one slide reduced, to the largest size that
  // fits (binary search, so the result never wobbles between steps).
  function fitText() {
    if (!root) return;
    const stage = root.querySelector('.pres-stage');
    const card = stage.firstElementChild;
    if (!card) return;
    const chosen = baseUnit() * SIZE_STEPS[sizeIndex] * (card.classList.contains('is-title') ? 0.9 : 1);
    // The stage has padding; the slide must fit inside its content box.
    const cs = getComputedStyle(stage);
    const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const fits = (px) => {
      card.style.fontSize = px + 'px';
      return card.scrollWidth <= availW + 1 && card.scrollHeight <= availH + 1;
    };
    if (fits(chosen)) return;
    let lo = MIN_FONT_PX, hi = chosen;
    if (!fits(lo)) { card.style.fontSize = lo + 'px'; return; }
    for (let i = 0; i < 12 && hi - lo > 0.5; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    card.style.fontSize = lo + 'px';
  }

  function syncControls() {
    if (!root) return;
    root.querySelectorAll('[data-pres-lines]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.presLines, 10) === linesPerSlide));
    });
    root.querySelector('[data-pres="smaller"]').disabled = sizeIndex <= 0;
    root.querySelector('[data-pres="larger"]').disabled = sizeIndex >= SIZE_STEPS.length - 1;
  }

  // ---------- navigation ----------
  function go(to) {
    if (!slides.length) return;
    const next = Math.max(0, Math.min(slides.length - 1, to));
    blanked = false;
    if (next === index) { renderSlide(); return; }
    index = next;
    renderSlide();
  }

  function setLines(n) {
    if (!LINE_CHOICES.includes(n) || n === linesPerSlide) return;
    // Keep the audience on the same lyric: find the first line of the current
    // slide and land on whichever new slide contains it.
    const current = slides[index];
    const anchor = current && current.kind === 'lyrics' ? current.lines[0] : null;
    const anchorLabel = current ? current.label : null;
    linesPerSlide = n;
    savePref(LS_LINES, n);
    slides = buildSlides(cfg.song, linesPerSlide, cfg.titleInfo);
    let target = 0;
    if (anchor != null) {
      const found = slides.findIndex(s => s.kind === 'lyrics' && s.label === anchorLabel && s.lines.includes(anchor));
      target = found >= 0 ? found : 0;
    }
    index = target;
    blanked = false;
    syncControls();
    renderSlide();
  }

  function setSize(next) {
    const clamped = Math.min(SIZE_STEPS.length - 1, Math.max(0, next));
    if (clamped === sizeIndex) return;
    sizeIndex = clamped;
    savePref(LS_SIZE, sizeIndex);
    syncControls();
    fitText();
  }

  function toggleFullscreen() {
    if (!root) return;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    } catch (_) {}
  }

  // ---------- controls visibility ----------
  function showControls() {
    if (!root) return;
    root.classList.add('controls-visible');
    root.classList.remove('cursor-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!root) return;
      root.classList.remove('controls-visible');
      root.classList.add('cursor-idle');
    }, CONTROLS_IDLE_MS);
  }

  function hideControls() {
    if (!root) return;
    clearTimeout(idleTimer);
    root.classList.remove('controls-visible');
  }

  // ---------- events ----------
  function onKeydown(e) {
    if (!root || e.ctrlKey || e.metaKey || e.altKey) return;
    const inBar = e.target && e.target.closest && e.target.closest('.pres-bar');
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
        blanked = !blanked; renderSlide(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case '+': case '=': setSize(sizeIndex + 1); break;
      case '-': case '_': setSize(sizeIndex - 1); break;
      case 'Escape': requestClose(); break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== 'Escape') showControls();
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
    showControls();
  }

  function onStagePointerDown(e) {
    if (e.target.closest('.pres-bar')) return;
    swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }
  function onStagePointerUp(e) {
    if (!swipe || e.target.closest('.pres-bar')) { swipe = null; return; }
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? index + 1 : index - 1);
      return;
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return;
    // A click/tap: left third goes back, right third goes forward, and the
    // middle only shows the controls (a second tap hides them on touch; with a
    // mouse they show on any movement anyway). It never changes the slide, so a
    // stray tap in the middle can't move the presentation).
    const x = e.clientX / window.innerWidth;
    if (x < 1 / 3) go(index - 1);
    else if (x > 2 / 3) go(index + 1);
    else if (e.pointerType !== 'mouse' && root.classList.contains('controls-visible')) hideControls();
    else showControls();
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && root) acquireWakeLock();
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
  // cfg: { song, titleInfo:{number,title,artist}, t, onRequestClose }
  function open(options) {
    if (root || !options || !options.song) return;
    cfg = options;
    loadPrefs();
    index = 0;
    blanked = false;
    slides = buildSlides(cfg.song, linesPerSlide, cfg.titleInfo);
    restoreFocus = document.activeElement;

    root = buildOverlay();
    document.body.appendChild(root);
    if (typeof initIcons === 'function') initIcons(root);
    syncControls();
    renderSlide();

    root.querySelector('.pres-bar').addEventListener('click', onBarClick);
    root.addEventListener('pointerdown', onStagePointerDown);
    root.addEventListener('pointerup', onStagePointerUp);
    root.addEventListener('pointercancel', () => { swipe = null; });
    root.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') showControls(); });
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', fitText);
    document.addEventListener('visibilitychange', onVisibility);

    document.documentElement.classList.add('pres-open');
    showControls();
    root.focus({ preventScroll: true });
    acquireWakeLock();
  }

  function requestClose() {
    if (!root) return;
    if (cfg && typeof cfg.onRequestClose === 'function') cfg.onRequestClose();
    else close();
  }

  function close() {
    if (!root) return;
    clearTimeout(idleTimer);
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', fitText);
    document.removeEventListener('visibilitychange', onVisibility);
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
    releaseWakeLock();
    root.remove();
    root = null;
    cfg = null;
    slides = [];
    document.documentElement.classList.remove('pres-open');
    const back = restoreFocus;
    restoreFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') {
      try { back.focus({ preventScroll: true }); } catch (_) {}
    }
  }

  window.SongPresentation = {
    open,
    close,
    isOpen: () => !!root,
    // Exposed for tests and the future PNG exporter.
    buildSlides,
  };
})();
