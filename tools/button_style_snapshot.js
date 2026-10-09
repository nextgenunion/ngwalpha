// Before/after check for CSS refactors. Paste this whole file into the
// browser console on the running app (any page), then:
//
//   const before = snapshotButtons();   // on the OLD build
//   copy(JSON.stringify(before));       // save it somewhere (a .json file)
//   ...load the NEW build, paste this file again...
//   const after = snapshotButtons();
//   diffSnapshots(before, after);       // [] means nothing visible changed
//
// It builds a throwaway element for each button class, reads its computed
// style in light + dark and in every accent, and records the properties that
// define how a button looks. transition-duration is recorded too, so the
// intentional motion-token changes (.16s -> .15s etc.) show up as known lines.
function snapshotButtons() {
  const classes = ['icon-btn', 'icon-btn-float', 'chip-btn', 'chip-btn chip-btn-text', 'btn-primary',
    'btn-primary btn-danger', 'btn-secondary', 'btn-pill-done', 'sort-btn', 'seg-toggle-btn', 'nav-btn'];
  const props = ['width', 'height', 'minHeight', 'padding', 'borderRadius', 'borderTopWidth', 'borderTopColor',
    'backgroundColor', 'color', 'fontSize', 'fontWeight', 'fontFamily', 'boxShadow', 'transitionDuration', 'opacity'];
  const root = document.documentElement;
  const saved = { theme: root.getAttribute('data-theme'), accent: root.getAttribute('data-accent') };
  const accents = ['periwinkle', 'sage', 'lavender', 'aqua', 'cinnamon', 'red', 'peach'];
  const out = {};
  for (const theme of ['light', 'dark']) {
    for (const accent of accents) {
      root.setAttribute('data-theme', theme); root.setAttribute('data-accent', accent);
      root.style.transition = 'none';
      for (const cls of classes) {
        for (const disabled of [false, true]) {
          const b = document.createElement('button');
          b.className = cls; b.disabled = disabled; b.textContent = 'A';
          b.style.cssText = 'position:fixed;left:-999px;top:0;';
          document.body.appendChild(b);
          const cs = getComputedStyle(b);
          out[`${theme}|${accent}|${cls}|${disabled ? 'disabled' : 'enabled'}`] =
            Object.fromEntries(props.map((p) => [p, cs[p]]));
          b.remove();
        }
      }
    }
  }
  root.style.transition = '';
  saved.theme === null ? root.removeAttribute('data-theme') : root.setAttribute('data-theme', saved.theme);
  saved.accent === null ? root.removeAttribute('data-accent') : root.setAttribute('data-accent', saved.accent);
  return out;
}
function diffSnapshots(a, b) {
  const lines = [];
  for (const k of Object.keys(a)) for (const p of Object.keys(a[k])) {
    if (a[k][p] !== (b[k] || {})[p]) lines.push(`${k} :: ${p}: ${a[k][p]} -> ${(b[k] || {})[p]}`);
  }
  return lines;
}
