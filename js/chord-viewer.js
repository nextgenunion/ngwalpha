// ============================================================================
// Song chord viewer — lightweight adapter between tappable chord tags in the
// song view and Chord Finder's shared instrument renderers.
//
// This module owns the popup interaction only. It receives app-specific
// dependencies (modal + translation + chord renderers) from app.js so it does
// not reach into app state or duplicate guitar/piano rendering logic.
// ============================================================================
(function () {
  'use strict';

  let bound = false;
  // Remember the musician's choice while the app stays open, so a pianist does
  // not have to re-select Piano for every chord. A fresh launch still defaults
  // to Guitar, preserving the viewer's long-standing behavior.
  let preferredInstrument = 'guitar';
  let activeSnapshot = null;
  let openBoundViewer = null;
  const DOUBLE_TAP_MS = 320;

  function bind({
    rootId = 'lyrics-container',
    openModal,
    renderChord,
    renderVoicings,
    unavailableText,
    previousVoicingText,
    nextVoicingText,
    guitarText,
    pianoText,
    instrumentText,
    openFinder,
    onStateChange,
    onClose,
    isActive = () => true,
    finderText,
  }) {
    if (bound) return;
    const root = document.getElementById(rootId);
    const getVoicings = typeof renderVoicings === 'function'
      ? renderVoicings
      : (typeof renderChord === 'function' ? (symbol) => {
          const one = renderChord(symbol);
          return one ? [one] : [];
        } : null);
    if (!root || typeof openModal !== 'function' || !getVoicings) return;
    bound = true;

    const hasInstrumentSwitch = typeof guitarText === 'function' && typeof pianoText === 'function';
    let nativeDoubleOrigin = null;

    function openViewer(chordName, saved = {}, origin = null) {
      const symbol = String(chordName || '').trim();
      if (!symbol || !isActive()) return;

      const body = document.createElement('div');
      body.className = 'song-chord-viewer';
      body.tabIndex = -1;

      let instrument = hasInstrumentSwitch ? (saved.instrument || preferredInstrument) : 'guitar';
      let voicings = [];
      let index = 0;
      const publish = () => {
        activeSnapshot = { symbol, instrument, index };
        if (typeof onStateChange === 'function') onStateChange({ ...activeSnapshot });
      };
      const navigate = () => {
        if (typeof openFinder === 'function' && isActive()) openFinder({ symbol, instrument, index });
      };

      let guitarBtn = null;
      let pianoBtn = null;
      if (hasInstrumentSwitch) {
        const switcher = document.createElement('div');
        switcher.className = 'song-chord-viewer-instrument seg-toggle';
        switcher.setAttribute('role', 'group');
        switcher.setAttribute('aria-label', typeof instrumentText === 'function' ? instrumentText() : 'Instrument');

        guitarBtn = document.createElement('button');
        guitarBtn.type = 'button';
        guitarBtn.className = 'song-chord-viewer-instrument-btn seg-toggle-btn';
        guitarBtn.textContent = guitarText();
        guitarBtn.dataset.instrument = 'guitar';

        pianoBtn = document.createElement('button');
        pianoBtn.type = 'button';
        pianoBtn.className = 'song-chord-viewer-instrument-btn seg-toggle-btn';
        pianoBtn.textContent = pianoText();
        pianoBtn.dataset.instrument = 'piano';

        const thumb = document.createElement('div');
        thumb.className = 'seg-toggle-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        switcher.append(guitarBtn, pianoBtn, thumb);
        body.appendChild(switcher);
      }

      const diagram = document.createElement('div');
      diagram.className = 'song-chord-viewer-diagram';
      if (typeof openFinder === 'function') {
        diagram.tabIndex = 0;
        diagram.setAttribute('role', 'button');
        const label = typeof finderText === 'function' ? finderText() : 'Double-tap to open Chord Finder';
        diagram.setAttribute('aria-label', label);
        diagram.title = label;
        let lastTap = 0;
        diagram.addEventListener('click', event => {
          const now = Date.now();
          if (event.detail > 1 || (lastTap && now - lastTap <= DOUBLE_TAP_MS)) {
            lastTap = 0;
            event.preventDefault();
            navigate();
          } else lastTap = now;
        });
        diagram.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            navigate();
          }
        });
      }
      const stage = document.createElement('div');
      stage.className = 'song-chord-viewer-stage';
      diagram.appendChild(stage);
      body.appendChild(diagram);

      const nav = document.createElement('div');
      nav.className = 'song-chord-viewer-nav';

      const prev = document.createElement('button');
      prev.type = 'button';
      prev.className = 'song-chord-viewer-arrow';
      prev.textContent = '‹';
      prev.setAttribute('aria-label', typeof previousVoicingText === 'function' ? previousVoicingText() : 'Previous voicing');

      const count = document.createElement('span');
      count.className = 'song-chord-viewer-count';
      count.setAttribute('aria-live', 'polite');

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'song-chord-viewer-arrow';
      next.textContent = '›';
      next.setAttribute('aria-label', typeof nextVoicingText === 'function' ? nextVoicingText() : 'Next voicing');

      nav.append(prev, count, next);
      body.appendChild(nav);

      let paintTicket = 0;
      let swapTimer = null;
      let settleTimer = null;
      const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

      const commitPaint = () => {
        stage.innerHTML = '';
        if (!voicings.length) {
          const empty = document.createElement('p');
          empty.className = 'song-chord-viewer-empty';
          empty.textContent = typeof unavailableText === 'function' ? unavailableText() : '';
          stage.appendChild(empty);
          nav.hidden = true;
          count.textContent = '';
          return;
        }
        stage.innerHTML = voicings[index].svg;
        const multiple = voicings.length > 1;
        nav.hidden = !multiple;
        count.textContent = multiple ? `${index + 1} / ${voicings.length}` : '';
      };

      const paint = ({ animate = false } = {}) => {
        const ticket = ++paintTicket;
        if (swapTimer) clearTimeout(swapTimer);
        if (settleTimer) clearTimeout(settleTimer);

        if (!animate || reduceMotion() || !diagram.isConnected) {
          stage.classList.remove('is-leaving', 'is-entering');
          diagram.style.height = '';
          commitPaint();
          return;
        }

        const startHeight = diagram.getBoundingClientRect().height;
        if (startHeight > 0) diagram.style.height = `${startHeight}px`;
        stage.classList.remove('is-entering');
        stage.classList.add('is-leaving');

        swapTimer = setTimeout(() => {
          if (ticket !== paintTicket) return;
          stage.classList.remove('is-leaving');
          commitPaint();

          // The stage can measure its new natural height even while the outer
          // diagram is temporarily pinned to the previous height. Transitioning
          // that outer height is what stops Guitar ↔ Piano from snapping the
          // whole modal to a new size in a single frame.
          const targetHeight = Math.max(stage.getBoundingClientRect().height, stage.scrollHeight || 0);
          if (targetHeight > 0) diagram.style.height = `${targetHeight}px`;
          stage.classList.add('is-entering');

          settleTimer = setTimeout(() => {
            if (ticket !== paintTicket) return;
            stage.classList.remove('is-entering');
            diagram.style.height = '';
          }, 280);
        }, 105);
      };

      const move = delta => {
        if (voicings.length < 2) return;
        index = (index + delta + voicings.length) % voicings.length;
        publish();
        paint({ animate: true });
      };

      const setInstrument = (nextInstrument, { animate = false, voicingIndex = 0 } = {}) => {
        const normalized = nextInstrument === 'piano' ? 'piano' : 'guitar';
        if (normalized === instrument && voicings.length) return;
        instrument = normalized;
        if (hasInstrumentSwitch) preferredInstrument = instrument;
        body.className = `song-chord-viewer is-${instrument}`;
        if (guitarBtn) guitarBtn.setAttribute('aria-pressed', String(instrument === 'guitar'));
        if (pianoBtn) pianoBtn.setAttribute('aria-pressed', String(instrument === 'piano'));
        if (hasInstrumentSwitch && typeof window.positionSegToggleThumb === 'function') {
          window.positionSegToggleThumb(body.querySelector('.song-chord-viewer-instrument'));
        }
        voicings = (getVoicings(symbol, instrument) || []).filter(v => v && v.svg);
        index = Number.isInteger(voicingIndex)
          ? Math.max(0, Math.min(voicings.length - 1, voicingIndex)) : 0;
        if (index < 0) index = 0;
        publish();
        paint({ animate });
      };

      prev.addEventListener('click', () => move(-1));
      next.addEventListener('click', () => move(1));
      if (guitarBtn) guitarBtn.addEventListener('click', () => setInstrument('guitar', { animate: true }));
      if (pianoBtn) pianoBtn.addEventListener('click', () => setInstrument('piano', { animate: true }));
      body.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      });

      setInstrument(instrument, { animate: false, voicingIndex: saved.index });
      openModal(symbol, body, { variant: 'chord-viewer', onClose: () => {
        paintTicket++;
        if (swapTimer) clearTimeout(swapTimer);
        if (settleTimer) clearTimeout(settleTimer);
        activeSnapshot = null;
        nativeDoubleOrigin = null;
        if (typeof onClose === 'function') onClose();
      } });
      nativeDoubleOrigin = origin;
      publish();
      if (hasInstrumentSwitch && typeof window.positionSegToggleThumb === 'function') {
        requestAnimationFrame(() => window.positionSegToggleThumb(
          body.querySelector('.song-chord-viewer-instrument'),
          { instant: true }
        ));
      }
    }

    openBoundViewer = saved => openViewer(saved.symbol, saved);
    let pendingChord = null;
    let pendingSingle = null;
    let lastTapAt = 0;
    const cancelPending = () => {
      if (pendingSingle) clearTimeout(pendingSingle);
      pendingSingle = null;
      pendingChord = null;
    };
    const findChord = target => {
      const chord = target && target.closest && target.closest('.chord-tag[data-chord]');
      return chord && root.contains(chord) && isActive() ? chord : null;
    };
    const chordSnapshot = chord => ({
      symbol: String(chord.dataset.chord || chord.textContent).trim(),
      instrument: preferredInstrument,
      index: 0,
    });

    // A new action cancels a deferred single tap before it can cover a menu,
    // a different lyric, or a scrolling page. Capture runs before controls
    // that deliberately stop bubbling (such as the song's kebab menu).
    const cancelForOtherTarget = event => {
      if (pendingChord && findChord(event.target) !== pendingChord) cancelPending();
    };
    document.addEventListener('pointerdown', cancelForOtherTarget, true);
    document.addEventListener('click', event => {
      const origin = nativeDoubleOrigin;
      nativeDoubleOrigin = null;
      // Browsers can deliver the second native double-click after the popup
      // already appeared. Honor that gesture at its original point instead
      // of treating the second click as a backdrop dismissal.
      if (origin && event.detail > 1 && isActive() && activeSnapshot
          && activeSnapshot.symbol === origin.symbol && root.contains(origin.chord)
          && Math.abs(event.clientX - origin.x) <= 8 && Math.abs(event.clientY - origin.y) <= 8
          && typeof openFinder === 'function') {
        event.preventDefault();
        event.stopImmediatePropagation();
        openFinder({ ...activeSnapshot });
        return;
      }
      cancelForOtherTarget(event);
    }, true);
    document.addEventListener('keydown', event => {
      nativeDoubleOrigin = null;
      cancelPending();
    }, true);
    const cancelForScrollGesture = () => {
      nativeDoubleOrigin = null;
      cancelPending();
    };
    // Focus and layout can emit scroll events after a legitimate tap. Cancel
    // on the user's scrolling input, not on those incidental layout events.
    document.addEventListener('wheel', cancelForScrollGesture, { capture: true, passive: true });
    document.addEventListener('touchmove', cancelForScrollGesture, { capture: true, passive: true });

    root.addEventListener('click', event => {
      const chord = findChord(event.target);
      if (!chord) return;
      // Keyboard-generated clicks stay immediate. Pointer clicks wait briefly
      // so the first popup cannot swallow the second tap on a song chord.
      if (typeof openFinder !== 'function' || event.detail === 0) {
        cancelPending();
        openViewer(chord.dataset.chord || chord.textContent);
        return;
      }
      const now = Date.now();
      if (pendingChord === chord && (event.detail > 1 || now - lastTapAt <= DOUBLE_TAP_MS)) {
        cancelPending();
        event.preventDefault();
        openFinder(chordSnapshot(chord));
        return;
      }
      cancelPending();
      pendingChord = chord;
      lastTapAt = now;
      const origin = { chord, symbol: chordSnapshot(chord).symbol, x: event.clientX, y: event.clientY };
      pendingSingle = setTimeout(() => {
        cancelPending();
        if (root.contains(chord) && isActive()) openViewer(chord.dataset.chord || chord.textContent, {}, origin);
      }, DOUBLE_TAP_MS);
    });
    root.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const chord = findChord(event.target);
      if (!chord) return;
      event.preventDefault();
      cancelPending();
      if (event.shiftKey && typeof openFinder === 'function') openFinder(chordSnapshot(chord));
      else openViewer(chord.dataset.chord || chord.textContent);
    });
  }

  window.SongChordViewer = Object.freeze({ bind, open: saved => { if (openBoundViewer && saved) openBoundViewer(saved); }, snapshot: () => activeSnapshot && { ...activeSnapshot } });
})();
