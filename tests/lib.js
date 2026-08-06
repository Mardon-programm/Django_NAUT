// Tiny zero-dependency test helpers for DjangoNAUT regression tests.
// Usage: test files require('./lib') and call test(name, fn); the runner
// (run-all.js) executes them and reports PASS/FAIL.

const fs = require('fs');
const path = require('path');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function eq(actual, expected) {
  const x = JSON.stringify(actual);
  const y = JSON.stringify(expected);
  if (x !== y) throw new Error('expected ' + y + ' but got ' + x);
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Extract a top-level `function name(...) { ... }` from a source file,
// skipping comments, string literals and regex literals.
function extractFunction(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const i = src.indexOf('function ' + name + '(');
  if (i === -1) throw new Error('function not found: ' + name);
  let depth = 0;
  let j = src.indexOf('{', i);
  let inStr = null;
  while (j < src.length) {
    const c = src[j];
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j === -1) j = src.length; continue; }
    if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j + 2); if (j === -1) j = src.length; else j += 2; continue; }
    if (c === '/' && !inStr && j > i && !/[A-Za-z0-9_)'"\]]/.test(src[j - 1])) {
      j += 2;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '/' || src[j] === '\n') break;
        j++;
      }
      continue;
    }
    if (inStr) {
      if (c === inStr && src[j - 1] !== '\\') inStr = null;
      j++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
    j++;
  }
  return src.slice(i, j);
}

// Evaluate extracted functions from a file into a sandbox object.
function loadFunctions(file, names) {
  const body = names.map((n) => extractFunction(file, n)).join('\n');
  return new Function(body + '\nreturn {' + names.join(', ') + '};')();
}

function run() {
  let pass = 0;
  let fail = 0;
  for (const t of tests) {
    try {
      t.fn();
      pass++;
      console.log('PASS', t.name);
    } catch (e) {
      fail++;
      console.log('FAIL', t.name, '-', e.message);
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  return fail;
}

function repoRoot() {
  return path.join(__dirname, '..');
}

module.exports = { test, eq, ok, run, extractFunction, loadFunctions, repoRoot };
