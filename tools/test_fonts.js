// Every self-hosted font referenced by css/style.css must (1) exist on disk,
// (2) be a real WOFF2 file, and (3) be listed in the service worker's
// REQUIRED_OFFLINE so it is part of the atomic offline install.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

const refs = [...css.matchAll(/url\('\.\.\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
if (!refs.length) throw new Error('no ../fonts/ references found in css/style.css');

for (const file of new Set(refs)) {
  const full = path.join(root, 'fonts', file);
  if (!fs.existsSync(full)) throw new Error(`missing font file: fonts/${file}`);
  const buf = fs.readFileSync(full);
  if (buf.slice(0, 4).toString('latin1') !== 'wOF2') throw new Error(`not a WOFF2 file: fonts/${file}`);
  if (buf.readUInt32BE(8) !== buf.length) throw new Error(`truncated WOFF2 file: fonts/${file}`);
  if (!sw.includes(`'./fonts/${file}'`)) throw new Error(`fonts/${file} is not in REQUIRED_OFFLINE`);
}

// Mongolian needs both Cyrillic subsets for Noto Sans and Inter's Ө/Ү.
if (!refs.some((f) => /noto-sans_cyrillic-ext/.test(f))) throw new Error('Noto Sans cyrillic-ext missing (Ө/Ү)');

console.log(`Fonts passed: ${new Set(refs).size} self-hosted files exist, are valid WOFF2, and are cached atomically.`);
