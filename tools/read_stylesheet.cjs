'use strict';
// Test-only reader for the app's local, ordered CSS imports.
// Browsers load imports natively; this helper does not run in the app.
const fs = require('node:fs');
const path = require('node:path');
function readStylesheet(entry = path.join(__dirname, '..', 'css', 'style.css')) {
  const directory = path.dirname(path.resolve(entry));
  const files = [];
  function read(file, ancestors = []) {
    file = path.resolve(file);
    if (ancestors.includes(file)) throw new Error(`Circular CSS import: ${file}`);
    if (!file.startsWith(directory + path.sep)) throw new Error(`CSS import outside css/: ${file}`);
    files.push(file);
    const source = fs.readFileSync(file, 'utf8');
    const css = source.replace(/@import\s+url\(['"](\.\/[^'"]+\.css)['"]\);/g,
      (_, name) => read(path.resolve(path.dirname(file), name), [...ancestors, file]));
    if (/@import\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))) throw new Error(`Unsupported CSS import: ${file}`);
    return css;
  }
  return { css: read(entry), files };
}
module.exports = { readStylesheet };
