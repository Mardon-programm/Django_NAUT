// DjangoNAUT Test Runner: discovers Django/Python tests and runs them with
// pytest (primary) or `manage.py test` (fallback), parsing results.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const shellRPC = require('./shell-rpc');

const IGNORE = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'env', 'dist', 'build']);

function walkPyFiles(root) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.py')) files.push(full);
    }
  }
  return files;
}

function readFile(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function isTestFile(base) {
  return /^test_.+\.py$/.test(base) || /^.+_test\.py$/.test(base) || base === 'test.py';
}

// Discover tests: file::Class::test nodes.
function scanTests(root) {
  const tests = [];
  for (const file of walkPyFiles(root)) {
    if (!isTestFile(path.basename(file))) continue;
    const content = readFile(file);
    if (!content) continue;
    const lines = content.split('\n');
    let className = null;
    const rel = path.relative(root, file).split(path.sep).join('/');
    for (let i = 0; i < lines.length; i++) {
      const cm = lines[i].match(/^\s*class\s+(\w+)\s*\(/);
      if (cm) { className = cm[1].startsWith('Test') ? cm[1] : null; continue; }
      const tm = lines[i].match(/^\s*(?:async\s+)?def\s+(test_\w+)\s*\(/);
      if (tm) {
        const nodeId = rel + '::' + (className ? className + '::' : '') + tm[1];
        tests.push({ file, rel, line: i + 1, name: tm[1], className, nodeId });
      }
    }
  }
  return tests.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

function dottedName(root, file) {
  let dir = path.dirname(file);
  const segments = [];
  while (dir && dir.startsWith(root) && dir !== root && fs.existsSync(path.join(dir, '__init__.py'))) {
    segments.unshift(path.basename(dir));
    dir = path.dirname(dir);
  }
  return segments.join('.') + '.' + path.basename(file).replace(/\.py$/, '');
}

function dottedTarget(root, relTarget) {
  const [filePart, ...tail] = relTarget.split('::');
  let base = dottedName(root, path.join(root, filePart));
  if (tail.length) base += '.' + tail.join('.');
  return base;
}

function spawnCapture(cmd, args, opts) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, windowsHide: true });
    } catch (err) {
      resolve({ code: -1, output: 'Failed to spawn: ' + err.message });
      return;
    }
    let output = '';
    const add = (d) => {
      output += d.toString();
      if (output.length > 250000) output = output.slice(-250000);
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    child.on('error', (err) => resolve({ code: -1, output: 'Failed to run: ' + err.message }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

function parsePytest(output, code) {
  const p = { passed: 0, failed: 0, errors: 0, skipped: 0, failedIds: [], code };
  const lines = output.split('\n');
  for (const line of lines) {
    const m = line.match(/^([^\s]+\.py::[^\s]+) (PASSED|FAILED|ERROR|SKIPPED)\s*$/);
    if (m) {
      const id = m[1];
      if (m[2] === 'PASSED') p.passed++;
      else if (m[2] === 'FAILED') { p.failed++; p.failedIds.push(id); }
      else if (m[2] === 'ERROR') { p.errors++; p.failedIds.push(id); }
      else p.skipped++;
      continue;
    }
    if (/^\d+ (passed|failed|error)/.test(line.trim()) || / in [\d.]+s$/.test(line.trim())) {
      const num = (re) => { const mm = line.match(re); return mm ? parseInt(mm[1], 10) : 0; };
      p.passed = num(/(\d+) passed/);
      p.failed = num(/(\d+) failed/);
      p.errors = num(/(\d+) error/);
      p.skipped = num(/(\d+) skipped/);
    }
  }
  if (!p.passed && !p.failed && !p.errors && !p.skipped && code !== 0 && code !== 5) {
    p.errors = 1;
    p.rawError = output.slice(-1500);
  }
  return p;
}

function parseDjango(output, code) {
  const p = { passed: 0, failed: 0, errors: 0, skipped: 0, failedIds: [], code };
  const lines = output.split('\n');
  let ran = null;
  for (const line of lines) {
    const r = line.match(/^Ran (\d+) tests?/);
    if (r) { ran = parseInt(r[1], 10); continue; }
    if (/^OK/.test(line) && ran) p.passed = ran;
    const fail = line.match(/^FAIL:\s+(.+)$/);
    if (fail) { p.failed++; p.failedIds.push(fail[1].trim()); }
    const err = line.match(/^ERROR:\s+(.+)$/);
    if (err) { p.errors++; p.failedIds.push(err[1].trim()); }
    const fs = line.match(/FAILED\s*\(failures=(\d+)/);
    if (fs) p.failed = parseInt(fs[1], 10);
    const es = line.match(/errors=(\d+)/);
    if (es) p.errors = parseInt(es[1], 10);
  }
  if (ran && !p.failed && !p.errors && !/FAILED/.test(output)) p.passed = ran;
  return p;
}

// target: '' (all), '<rel>/test_x.py', or '<rel>/test_x.py::Class::test'
async function runTests(root, target, opts = {}) {
  const python = shellRPC.findPython(root);
  const settingsModule = shellRPC.findSettingsModule(root);
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  if (settingsModule) env.DJANGO_SETTINGS_MODULE = settingsModule;

  const relTarget = target && !target.startsWith('::') && path.isAbsolute(target)
    ? path.relative(root, target).split(path.sep).join('/')
    : target;

  const args = ['-m', 'pytest'];
  if (relTarget) args.push(relTarget);
  args.push('-q', '--no-header', '-p', 'no:cacheprovider', '-rA');

  let res = await spawnCapture(python, args, { cwd: root, env });
  let framework = 'pytest';
  let parsed = parsePytest(res.output, res.code);

  const pytestMissing = /No module named pytest/.test(res.output);
  if (pytestMissing) {
    const dotted = relTarget ? dottedTarget(root, relTarget) : '';
    const dargs = ['manage.py', 'test'];
    if (dotted) dargs.push(dotted);
    res = await spawnCapture(python, dargs, { cwd: root, env });
    framework = 'django';
    parsed = parseDjango(res.output, res.code);
  }

  return {
    ...parsed,
    output: res.output.slice(-120000),
    code: res.code,
    framework,
    noTests: /no tests ran/i.test(res.output) && res.code === 5,
  };
}

module.exports = { scanTests, runTests };
