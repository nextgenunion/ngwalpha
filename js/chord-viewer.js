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
        switcher.className = 'song-chord-viewer-instrument';
        switcher.setAttribute('role', 'group');
        switcher.setAttribute('aria-label', typeof instrumentText === 'function' ? instrumentText() : 'Instrument');

        guitarBtn = document.createElement('button');
        guitarBtn.type = 'button';
        guitarBtn.className = 'song-chord-viewer-instrument-btn';
        guitarBtn.textContent = guitarText();
        guitarBtn.dataset.instrument = 'guitar';

        pianoBtn = document.createElement('button');
        pianoBtn.type = 'button';
        pianoBtn.className = 'song-chord-viewer-instrument-btn';
        pianoBtn.textContent = pianoText();
        pianoBtn.dataset.instrument = 'piano';

        switcher.append(guitarBtn, pianoBtn);
        body.appendChild(switcher);
      }

      const diagram = document.createElement('div');
      diagram.className = 'song-chord-viewer-diagram';
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

      const paint = () => {
        diagram.innerHTML = '';
        if (!voicings.length) {
          const empty = document.createElement('p');
          empty.className = 'song-chord-viewer-empty';
          empty.textContent = typeof unavailableText === 'function' ? unavailableText() : '';
          diagram.appendChild(empty);
          nav.hidden = true;
          return;
        }
        diagram.innerHTML = voicings[index].svg;
        const multiple = voicings.length > 1;
        nav.hidden = !multiple;
        count.textContent = multiple ? `${index + 1} / ${voicings.length}` : '';
      };

      const move = delta => {
        if (voicings.length < 2) return;
        index = (index + delta + voicings.length) % voicings.length;
        paint();
      };

      const setInstrument = nextInstrument => {
        instrument = nextInstrument === 'piano' ? 'piano' : 'guitar';
        if (hasInstrumentSwitch) preferredInstrument = instrument;
        body.className = `song-chord-viewer is-${instrument}`;
        if (guitarBtn) guitarBtn.setAttribute('aria-pressed', String(instrument === 'guitar'));
        if (pianoBtn) pianoBtn.setAttribute('aria-pressed', String(instrument === 'piano'));
        voicings = (getVoicings(symbol, instrument) || []).filter(v => v && v.svg);
        index = 0;
        paint();
      };

      prev.addEventListener('click', () => move(-1));
      next.addEventListener('click', () => move(1));
      if (guitarBtn) guitarBtn.addEventListener('click', () => setInstrument('guitar'));
      if (pianoBtn) pianoBtn.addEventListener('click', () => setInstrument('piano'));
      body.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      });

      setInstrument(instrument);
      openModal(symbol, body, { variant: 'chord-viewer' });
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
