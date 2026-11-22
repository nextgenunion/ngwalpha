// Database picker: the checkmark toggle must never change row geometry.
// JS behavior tests cover the selection algorithm; this guards the CSS/markup
// contract that previously caused a visible modal height jump on phones.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/08-trash-modals.css'), 'utf8');
const version = fs.readFileSync(path.join(root, 'version.js'), 'utf8');
assert.match(ui, /multi\.className = 'db-picker-multi icon-btn icon-btn-float';/,
  'toggle must reuse the raised, circular song-view action button');
assert.match(css, /\.db-picker-item\s*\{\s*position:\s*relative;\s*padding-right:\s*50px;\s*\}/,
  'single/multi rows must reserve identical room for checkbox');
assert.match(css, /\.db-picker-item \.checklist-check\s*\{[^}]*display:\s*flex;[^}]*position:\s*absolute;[^}]*opacity:\s*0;/s,
  'inactive check must be visually hidden, not removed from layout');
assert.match(css, /\.checklist\.is-multi \.db-picker-item \.checklist-check\s*\{[^}]*opacity:\s*1;/s,
  'multi mode must reveal checks without changing layout');
assert.doesNotMatch(css, /\.db-picker-item \.checklist-check\s*\{[^}]*display:\s*none;/s,
  'display:none checkbox was the original source of the height jump');
assert.match(version, /SONGBOOK_VERSION_NUMBER = '\d+\.\d+\.\d+'/);
console.log('Database picker visual-stability contract PASS');
