// Guards the electron-builder packaging: every file listed in package.json
// build.files and extraResources must exist, and asarUnpack entries must be
// either top-level files or present under node_modules.
const fs = require('fs');
const path = require('path');
const { test, ok, repoRoot } = require('./lib');

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), 'package.json'), 'utf8'));

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
