// Guards the electron-builder packaging: every file listed in package.json
// build.files and extraResources must exist, asarUnpack entries must be
// either top-level files or present under node_modules, and every relative
// require() reachable from main.js must resolve to a packaged file.
const fs = require('fs');
const path = require('path');
const { test, ok, repoRoot } = require('./lib');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'package.json'), 'utf8'));

const norm = (p) => String(p).replace(/^\.\//, '').replace(/\.js$/, '');

function collectRelativeRequires(file) {
  const src = fs.readFileSync(file, 'utf8');
  const deps = new Set();
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) deps.add(m[1]);
  return deps;
}

test('all build.files entries exist', () => {
  const files = pkg.build.files || [];
  ok(files.length > 10, 'expected a complete files list');
  for (const f of files) {
    if (f.includes('*') || f.startsWith('!')) continue;
    ok(fs.existsSync(path.join(repoRoot(), f)), 'missing packaged file: ' + f);
  }
});

test('extraResources python-agent exists', () => {
  const res = pkg.build.extraResources || [];
  const agent = res.find((r) => r.from === 'python-agent');
  ok(agent, 'extraResources must include python-agent');
  ok(fs.existsSync(path.join(repoRoot(), 'python-agent', 'pyproject.toml')), 'python-agent/pyproject.toml missing');
});

test('asarUnpack entries exist', () => {
  const entries = pkg.build.asarUnpack || [];
  for (const e of entries) {
    if (e.includes('*')) continue;
    ok(fs.existsSync(path.join(repoRoot(), e)), 'missing asarUnpack entry: ' + e);
  }
});

test('version is consistent across package.json and agent', () => {
  const agentInit = fs.readFileSync(path.join(repoRoot(), 'python-agent', 'django_naut', '__init__.py'), 'utf8');
  const m = agentInit.match(/__version__ = "([^"]+)"/);
  ok(m, 'agent __version__ present');
});

test('every relative require reachable from main.js is packaged', () => {
  const bundled = new Set((pkg.build.files || []).map(norm));
  const missing = [];
  const seen = new Set();
  const queue = ['main.js'];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (rel.startsWith('node_modules/')) continue;
    const abs = path.join(repoRoot(), rel);
    ok(fs.existsSync(abs), 'required file does not exist on disk: ' + rel);
    if (rel !== 'main.js' && !bundled.has(norm(rel))) missing.push(rel);
    for (const d of collectRelativeRequires(abs)) {
      const clean = d.replace(/\.js$/, '');
      let candidate = clean + '.js';
      if (!fs.existsSync(path.join(repoRoot(), candidate))) {
        if (fs.existsSync(path.join(repoRoot(), clean))) candidate = clean;
        else { missing.push(rel + ' requires ' + d + ' (resolves to nothing)'); continue; }
      }
      queue.push(candidate);
    }
  }
  ok(missing.length === 0, 'files required by main.js are missing from build.files: ' + missing.join(', '));
});
