'use strict';
// Follow extraction markers so existing source-based tests inspect the real
// implementations in their original logical order, including shared state.
const fs = require('node:fs'), path = require('node:path');
function readApplication() {
  const root = path.join(__dirname, '..', 'js');
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  return source.replace(/\/\* @extracted:([a-z-]+\.js):(\w+) \*\//g, (_, file, name) => {
    const module = fs.readFileSync(path.join(root, file), 'utf8');
    const begin = `/* @begin:${name} */\n`, end = `\n/* @end:${name} */`;
    const start = module.indexOf(begin), finish = module.indexOf(end, start + begin.length);
    if (start < 0 || finish < 0) throw new Error(`Missing extracted implementation: ${file}:${name}`);
    return module.slice(start + begin.length, finish);
  });
}
module.exports = { readApplication };
