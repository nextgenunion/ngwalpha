// Simulates initViewportSync() from js/app.js with a stub visualViewport:
// keyboard open -> html.keyboard-open + card pinned at its current top (or
// moved up only as far as needed); keyboard closed -> state cleared;
// pinch-zoom -> never treated as a keyboard.
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/../js/app.js', 'utf8');
const start = src.indexOf('function initViewportSync()');
const end = src.indexOf('// Focuses `input` only after', start);
if (start < 0 || end < 0) throw new Error('initViewportSync not found');

function run(vvInit, cardRect) {
  const props = {}; const classes = new Set(); const listeners = {}; const queue = [];
  const vv = { height: vvInit.height, offsetTop: 0, scale: vvInit.scale || 1,
    addEventListener: (t, f) => { listeners[t] = f; } };
  const card = { getBoundingClientRect: () => cardRect };
  const overlay = { hidden: false, getBoundingClientRect: () => ({ top: 0 }), querySelector: () => card };
  const ctx = {
    window: { visualViewport: vv, innerHeight: 800 },
    document: { documentElement: { style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } },
      classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } },
      getElementById: () => overlay },
    // Queue like a real browser: the callback runs AFTER requestAnimationFrame
    // has returned its id, so initViewportSync's `frame` guard resets properly.
    requestAnimationFrame: (f) => { queue.push(f); return queue.length; },
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + '\ninitViewportSync();', ctx);
  return { vv, props, classes, fire: () => { listeners.resize(); while (queue.length) queue.shift()(); } };
}

let failed = 0;
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) failed++; };

// Closed keyboard: no class, --vvh mirrors the viewport.
let t = run({ height: 800 }, { top: 250, height: 300 });
check(!t.classes.has('keyboard-open') && t.props['--vvh'] === '800px', 'no keyboard: class off, --vvh mirrors viewport');

// Keyboard opens, card fits above it: pinned where it already was (no jump).
t = run({ height: 800 }, { top: 250, height: 300 });
t.vv.height = 480; t.fire();
check(t.classes.has('keyboard-open'), 'keyboard open sets html.keyboard-open');
check(t.props['--kb-card-top'] === '168px', 'tall card is moved up only as far as needed (480-300-12=168)');

// Short card well above the keyboard: stays exactly where it was.
t = run({ height: 800 }, { top: 100, height: 200 });
t.vv.height = 480; t.fire();
check(t.props['--kb-card-top'] === '100px', 'card that already fits does not move');

// Keyboard closes: state cleared.
t.vv.height = 800; t.fire();
check(!t.classes.has('keyboard-open') && !('--kb-card-top' in t.props), 'keyboard close clears class and pinned top');

// Pinch zoom shrinks vv.height but is not a keyboard.
t = run({ height: 800 }, { top: 250, height: 300 });
t.vv.height = 400; t.vv.scale = 2; t.fire();
check(!t.classes.has('keyboard-open'), 'pinch-zoom is not treated as a keyboard');

// Small browser-toolbar changes are not a keyboard.
t = run({ height: 800 }, { top: 250, height: 300 });
t.vv.height = 740; t.fire();
check(!t.classes.has('keyboard-open'), 'small toolbar-size change is not a keyboard');

if (failed) process.exit(1);
