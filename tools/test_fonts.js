// Every self-hosted font referenced by css/style.css and its imports must (1) exist on disk,
// (2) be a real WOFF2 file, and (3) be listed in the service worker's
// REQUIRED_OFFLINE so it is part of the atomic offline install.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const stylesheet = require('./read_stylesheet.cjs').readStylesheet();
const css = stylesheet.css;
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const host of ['fonts.' + 'google' + 'apis.com', 'fonts.' + 'g' + 'static.com']) {
  if (html.includes(host)) throw new Error(`external font dependency remains: ${host}`);
}

const refs = [...css.matchAll(/url\('\.\.\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
if (!refs.length) throw new Error('no ../fonts/ references found in css/style.css');
const required = [
  'inter_latin-wght-normal.woff2', 'inter_latin-ext-wght-normal.woff2',
  'noto-sans_latin-wght-normal.woff2', 'noto-sans_latin-ext-wght-normal.woff2',
  'noto-sans_latin-wght-italic.woff2', 'noto-sans_latin-ext-wght-italic.woff2',
  'noto-sans_cyrillic-wght-italic.woff2', 'noto-sans_cyrillic-ext-wght-italic.woff2',
  'ibm-plex-mono_latin-500-normal.woff2', 'ibm-plex-mono_latin-600-normal.woff2',
];
for (const file of required) {
  if (!refs.includes(file)) throw new Error(`required self-hosted face missing: ${file}`);
}
const requiredOffline = sw.match(/const REQUIRED_OFFLINE = \[([\s\S]*?)\];/)[1];

for (const file of stylesheet.files) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (!requiredOffline.includes(`'./${relative}'`)) throw new Error(`${relative} is not in REQUIRED_OFFLINE`);
}

for (const file of new Set(refs)) {
  const full = path.join(root, 'fonts', file);
  if (!fs.existsSync(full)) throw new Error(`missing font file: fonts/${file}`);
  const buf = fs.readFileSync(full);
  if (buf.slice(0, 4).toString('latin1') !== 'wOF2') throw new Error(`not a WOFF2 file: fonts/${file}`);
  if (buf.readUInt32BE(8) !== buf.length) throw new Error(`truncated WOFF2 file: fonts/${file}`);
  if (!requiredOffline.includes(`'./fonts/${file}'`)) throw new Error(`fonts/${file} is not in REQUIRED_OFFLINE`);
}

// Mongolian needs both Cyrillic subsets for Noto Sans and Inter's Ө/Ү.
if (!refs.some((f) => /noto-sans_cyrillic-ext/.test(f))) throw new Error('Noto Sans cyrillic-ext missing (Ө/Ү)');

console.log(`Fonts passed: ${new Set(refs).size} self-hosted files exist, are valid WOFF2, and are cached atomically; ${stylesheet.files.length} CSS files are required offline.`);
