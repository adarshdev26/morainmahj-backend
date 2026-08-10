const { ACTIONS } = require('../src/routes/actionRegistry');
const f = require('../src/functions');
const fs = require('fs');
const path = require('path');

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(js|jsx|ts|tsx)$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

const feRoot = path.resolve(__dirname, '../../morain-mahj/src');
const files = walk(feRoot);
let invoke = 0;
let call = 0;
const invokeFiles = [];
for (const file of files) {
  const s = fs.readFileSync(file, 'utf8');
  const inv = (s.match(/invokeCompat\s*\(/g) || []).length;
  const ca = (s.match(/callAction\s*\(/g) || []).length;
  if (inv) {
    invoke += inv;
    invokeFiles.push(`${path.relative(feRoot, file)}:${inv}`);
  }
  if (!file.endsWith(`${path.sep}services${path.sep}actions.js`)) call += ca;
}

const missing = ACTIONS.map((a) => a.name).filter((n) => !f.has(n));
console.log(JSON.stringify({
  registered: ACTIONS.length,
  implemented: f.names().length,
  remaining501: missing.length,
  remaining501Names: missing,
  invokeCompatCalls: invoke,
  invokeCompatFiles: invokeFiles,
  callActionCallsExclDef: call,
}, null, 2));
