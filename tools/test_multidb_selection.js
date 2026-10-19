'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const registryCode = fs.readFileSync(path.join(__dirname, '../js/song-sources.js'), 'utf8');
const registry = code => { const ctx = {window:{}}; vm.runInNewContext(code, ctx); return ctx.window.SongSourceRegistry; };
const current = registry(registryCode);
const keys = Object.keys(current.databases);
let tested = 0;
for (let mask=1; mask < 1 << keys.length; mask++) {
 const selected = keys.filter((_,i)=>mask & 1 << i);
 const numbered = selected.filter(k=>current.databases[k].hasNumbers).length;
 assert.equal(current.selectionHasNumbers(selected), numbered === 1, selected.join('+'));
 assert.deepEqual(Array.from(current.normalizeSelection([...selected,...selected,'missing'])), selected);
 tested++;
}
for (const malformed of [null,undefined,[],['missing'],{},'missing']) {
 assert.deepEqual(Array.from(current.normalizeSelection(malformed)), [current.defaultSource]);
}
const future = registry(registryCode.replace('const databases = Object.freeze({', `const databases = Object.freeze({
 futureNumbered: Object.freeze({folder:'future-numbered',hasNumbers:true,group:'future',store:'future-numbered'}),
 futureUnnumbered: Object.freeze({folder:'future-unnumbered',hasNumbers:false,group:'future',store:'future-unnumbered'}),`));
assert.equal(future.selectionHasNumbers(['futureNumbered','english','mongolian2']),true);
assert.equal(future.selectionHasNumbers(['futureNumbered','official']),false);
assert.equal(future.selectionHasNumbers(['futureNumbered','official','sda','futureUnnumbered']),false);
assert.equal(future.selectionHasNumbers(['futureUnnumbered','english']),false);
assert.equal(future.selectionHasNumbers(['official','futureUnnumbered']),true);
console.log(`${tested} shipped database combinations, malformed selections, and future registry sources PASS`);
