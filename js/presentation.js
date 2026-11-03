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
// tapping the middle).
// Keys 1-9 jump to the Nth part of the song (0 = title slide). Parts, not slide
// numbers: the number of slides changes with Lines / Fill / text size, the parts
// of a song do not, and a song rarely has more than nine.
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
  const CONTROLS_IDLE_MS = 2200;
  const EDGE_PX = 3;        // mouse this close to the top edge asks for the controls...
  const EDGE_DWELL_MS = 150; // ...and has to stay there briefly, so a fly-by doesn't flash them
  const SWIPE_PX = 50;
  const DOUBLE_CLICK_MS = 350; // two middle clicks this close together = double-click

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

  // ---------- preferences ----------
  function loadPrefs() {
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
    if (titleInfo && titleInfo.title) result.push({ kind: 'title', number: titleInfo.number, title: titleInfo.title, artist: titleInfo.artist });
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
      card.appendChild(el('div', 'pres-title-text', slide.title));
      if (slide.artist) card.appendChild(el('div', 'pres-title-artist', slide.artist));
    } else {
      if (slide.label) card.appendChild(el('div', 'pres-label', slide.label));
      slide.lines.forEach(line => card.appendChild(buildLine(line)));
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

    o.appendChild(el('div', 'pres-bg'));
    const stage = el('div', 'pres-stage');
    stage.setAttribute('aria-live', 'polite');
    o.appendChild(stage);

    const chip = (attr, value, text, extra) =>
      `<button type="button" class="pres-btn pres-chip" ${attr}="${value}" aria-pressed="false"${extra || ''}>${escapeHtmlLocal(text)}</button>`;
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
        <button type="button" class="pres-btn pres-chip" data-pres="smaller" aria-label="${escapeAttr(t('presentationSmaller'))}">A−</button>
        <button type="button" class="pres-btn pres-chip" data-pres="larger" aria-label="${escapeAttr(t('presentationLarger'))}">A+</button>
      </div>
      <div class="pres-group" data-pres-transition-group role="group" aria-label="${escapeAttr(t('presentationTransitionLabel'))}">
        <span class="pres-group-label">${escapeHtmlLocal(t('presentationTransitionLabel'))}</span>
        ${chip('data-pres-transition', 'cut', t('presentationCut'))}
        ${chip('data-pres-transition', 'fade', t('presentationFade'))}
      </div>`;
    o.appendChild(bar);

    const hint = el('div', 'pres-hint');
    hint.textContent = t('presentationHint');
    o.appendChild(hint);
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
    if (linesPerSlide !== FILL) return buildSlides(cfg.song, linesPerSlide, cfg.titleInfo);
    const fitter = createFitter();
    try { return buildSlides(cfg.song, FILL, cfg.titleInfo, fitter.fits); }
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
    if (root) root.querySelector('.pres-stage').classList.toggle('is-blank', blanked);
  }

  function syncControls() {
    if (!root) return;
    root.dataset.transition = effectiveTransition();
    root.querySelectorAll('[data-pres-lines]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(parseInt(btn.dataset.presLines, 10) === linesPerSlide));
    });
    root.querySelectorAll('[data-pres-transition]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.presTransition === effectiveTransition()));
    });
    root.querySelector('[data-pres-transition-group]').hidden = reducedMotion();
    root.querySelector('[data-pres="smaller"]').disabled = sizeIndex <= 0;
    root.querySelector('[data-pres="larger"]').disabled = sizeIndex >= SIZE_STEPS.length - 1;
  }

  // ---------- navigation and settings ----------
  function go(to) {
    if (!slides.length) return;
    const next = Math.max(0, Math.min(slides.length - 1, to));
    setBlank(false);
    if (next === index) return;
    index = next;
    renderSlide({ animate: true });
  }

  // Jump to the first slide of the Nth part of the song (1 = first part). A
  // part is a verse/chorus block, as in buildSections(); a number the song
  // doesn't have does nothing.
  function goToPart(n) {
    const target = slides.findIndex(s => s.kind === 'lyrics' && s.section === n - 1);
    if (target >= 0) go(target);
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

  function setTransition(next) {
    if (!TRANSITIONS.includes(next) || next === transition) return;
    transition = next;
    savePref(LS_TRANSITION, next);
    syncControls();
  }

  function toggleFullscreen() {
    if (!root) return;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    } catch (_) {}
  }

  // ---------- controls visibility ----------
  // Hidden at launch and never shown by mouse movement alone. They appear for
  // the top edge, S, or (touch only) a tap in the middle, and hide again by
  // themselves — but not while the pointer is on the panel.
  function controlsVisible() {
    return !!root && root.classList.contains('controls-visible');
  }

  function scheduleHide() {
    clearTimeout(idleTimer);
    if (panelHover) return;
    idleTimer = setTimeout(hideControls, CONTROLS_IDLE_MS);
  }

  function showControls() {
    if (!root) return;
    root.classList.add('controls-visible');
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
      case 'Home': case '0': go(0); break;
      case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
        goToPart(parseInt(e.key, 10)); break;
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
    else if (btn.dataset.presTransition != null) setTransition(btn.dataset.presTransition);
    else if (btn.dataset.pres === 'close') requestClose();
    else if (btn.dataset.pres === 'smaller') setSize(sizeIndex - 1);
    else if (btn.dataset.pres === 'larger') setSize(sizeIndex + 1);
    // After a mouse/touch click give focus back to the slide, so the panel's
    // focus doesn't keep it open and Space/arrows keep changing slides.
    if (e.detail > 0 && root) root.focus({ preventScroll: true });
    if (controlsVisible()) scheduleHide();
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
    // A click/tap: left third goes back, right third goes forward. The middle
    // never changes the slide; on touch it shows the controls (and hides them
    // again on the next tap). With a mouse a single click there does nothing,
    // so a stray click never flashes controls at the audience; a double-click
    // there toggles them (only the middle: on the sides each click of a
    // double-click would already have changed the slide).
    const x = e.clientX / window.innerWidth;
    if (x < 1 / 3) go(index - 1);
    else if (x > 2 / 3) go(index + 1);
    else if (e.pointerType !== 'mouse') {
      if (controlsVisible()) hideControls(); else showControls();
    } else {
      const now = performance.now();
      const last = lastMiddleClick;
      if (last && now - last.t <= DOUBLE_CLICK_MS && Math.abs(e.clientX - last.x) <= 10 && Math.abs(e.clientY - last.y) <= 10) {
        lastMiddleClick = null;
        if (controlsVisible()) hideControls(); else showControls();
      } else lastMiddleClick = { t: now, x: e.clientX, y: e.clientY };
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
  // cfg: { song, titleInfo:{number,title,artist}, t, onRequestClose }
  function open(options) {
    if (root || !options || !options.song) return;
    cfg = options;
    loadPrefs();
    index = 0;
    blanked = false;
    panelHover = false;
    restoreFocus = document.activeElement;

    root = buildOverlay();
    document.body.appendChild(root);
    if (typeof initIcons === 'function') initIcons(root);
    // Fill measures real layout, so the slides are built once the overlay is in
    // the page.
    slides = computeSlides();
    syncControls();
    renderSlide();

    const bar = root.querySelector('.pres-bar');
    bar.addEventListener('click', onBarClick);
    bar.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { panelHover = true; clearTimeout(idleTimer); } });
    bar.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { panelHover = false; if (controlsVisible()) scheduleHide(); } });
    root.addEventListener('pointerdown', onStagePointerDown);
    root.addEventListener('pointerup', onStagePointerUp);
    root.addEventListener('pointercancel', () => { swipe = null; });
    root.addEventListener('pointermove', onPointerMove);
    document.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', scheduleRefresh);
    document.addEventListener('visibilitychange', onVisibility);
    if (document.fonts) {
      // Lyric fonts can arrive after the first layout; Fill depends on them.
      document.fonts.addEventListener('loadingdone', scheduleRefresh);
      if (document.fonts.ready) document.fonts.ready.then(scheduleRefresh);
    }
    if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);

    document.documentElement.classList.add('pres-open');
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
    clearTimeout(edgeTimer);
    idleTimer = edgeTimer = null;
    if (refreshFrame) { cancelAnimationFrame(refreshFrame); refreshFrame = 0; }
    document.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', scheduleRefresh);
    document.removeEventListener('visibilitychange', onVisibility);
    if (document.fonts) document.fonts.removeEventListener('loadingdone', scheduleRefresh);
    if (motionQuery && motionQuery.removeEventListener) motionQuery.removeEventListener('change', onMotionChange);
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
