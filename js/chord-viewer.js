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

    function openViewer(chordName) {
      const symbol = String(chordName || '').trim();
      if (!symbol) return;

      const body = document.createElement('div');
      body.className = 'song-chord-viewer';
      body.tabIndex = -1;

      let instrument = hasInstrumentSwitch ? preferredInstrument : 'guitar';
      let voicings = [];
      let index = 0;

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
        paint({ animate: true });
      };

      const setInstrument = (nextInstrument, { animate = false } = {}) => {
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
        index = 0;
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

      setInstrument(instrument, { animate: false });
      openModal(symbol, body, { variant: 'chord-viewer' });
      if (hasInstrumentSwitch && typeof window.positionSegToggleThumb === 'function') {
        requestAnimationFrame(() => window.positionSegToggleThumb(
          body.querySelector('.song-chord-viewer-instrument'),
          { instant: true }
        ));
      }
    }

    function activate(target) {
      const chord = target && target.closest && target.closest('.chord-tag[data-chord]');
      if (!chord || !root.contains(chord)) return false;
      openViewer(chord.dataset.chord || chord.textContent);
      return true;
    }

    root.addEventListener('click', (event) => { activate(event.target); });
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (activate(event.target)) event.preventDefault();
    });
  }

  window.SongChordViewer = Object.freeze({ bind });
})();
