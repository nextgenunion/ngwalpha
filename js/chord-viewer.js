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

  function bind({ rootId = 'lyrics-container', openModal, renderChord, unavailableText }) {
    if (bound) return;
    const root = document.getElementById(rootId);
    if (!root || typeof openModal !== 'function' || typeof renderChord !== 'function') return;
    bound = true;

    function openViewer(chordName) {
      const symbol = String(chordName || '').trim();
      if (!symbol) return;

      const body = document.createElement('div');
      body.className = 'song-chord-viewer';
      const rendered = renderChord(symbol);

      if (rendered && rendered.svg) {
        const diagram = document.createElement('div');
        diagram.className = 'song-chord-viewer-diagram';
        diagram.innerHTML = rendered.svg;
        body.appendChild(diagram);
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
