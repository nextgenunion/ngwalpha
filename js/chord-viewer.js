// ============================================================================
// Song chord viewer — lightweight adapter between tappable chord tags in the
// song view and Chord Finder's shared diagram renderer.
//
// This module owns the popup interaction only. It receives app-specific
// dependencies (modal + translation + renderer) from app.js so it does not
// reach into app state or duplicate chord rendering logic.
// ============================================================================
(function () {
  'use strict';

  let bound = false;

  function bind({
    rootId = 'lyrics-container',
    openModal,
    renderChord,
    renderVoicings,
    unavailableText,
    previousVoicingText,
    nextVoicingText,
  }) {
    if (bound) return;
    const root = document.getElementById(rootId);
    const getVoicings = typeof renderVoicings === 'function'
      ? renderVoicings
      : (typeof renderChord === 'function' ? symbol => {
          const one = renderChord(symbol);
          return one ? [one] : [];
        } : null);
    if (!root || typeof openModal !== 'function' || !getVoicings) return;
    bound = true;

    function openViewer(chordName) {
      const symbol = String(chordName || '').trim();
      if (!symbol) return;

      const body = document.createElement('div');
      body.className = 'song-chord-viewer';
      body.tabIndex = -1;
      const voicings = (getVoicings(symbol) || []).filter(v => v && v.svg);

      if (voicings.length) {
        let index = 0;
        const diagram = document.createElement('div');
        diagram.className = 'song-chord-viewer-diagram';
        body.appendChild(diagram);

        let count = null;
        let prev = null;
        let next = null;

        if (voicings.length > 1) {
          const nav = document.createElement('div');
          nav.className = 'song-chord-viewer-nav';

          prev = document.createElement('button');
          prev.type = 'button';
          prev.className = 'song-chord-viewer-arrow';
          prev.textContent = '‹';
          prev.setAttribute('aria-label', typeof previousVoicingText === 'function' ? previousVoicingText() : 'Previous voicing');

          count = document.createElement('span');
          count.className = 'song-chord-viewer-count';
          count.setAttribute('aria-live', 'polite');

          next = document.createElement('button');
          next.type = 'button';
          next.className = 'song-chord-viewer-arrow';
          next.textContent = '›';
          next.setAttribute('aria-label', typeof nextVoicingText === 'function' ? nextVoicingText() : 'Next voicing');

          nav.append(prev, count, next);
          body.appendChild(nav);
        }

        const paint = () => {
          diagram.innerHTML = voicings[index].svg;
          if (count) count.textContent = `${index + 1} / ${voicings.length}`;
        };
        const move = delta => {
          index = (index + delta + voicings.length) % voicings.length;
          paint();
        };

        if (prev) prev.addEventListener('click', () => move(-1));
        if (next) next.addEventListener('click', () => move(1));
        body.addEventListener('keydown', event => {
          if (voicings.length < 2) return;
          if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
          if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
        });
        paint();
      } else {
        const empty = document.createElement('p');
        empty.className = 'song-chord-viewer-empty';
        empty.textContent = typeof unavailableText === 'function' ? unavailableText() : '';
        body.appendChild(empty);
      }
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
