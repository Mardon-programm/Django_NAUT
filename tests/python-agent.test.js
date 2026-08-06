// Compiles the python-agent sources. Skips (does not fail) when no Python
// interpreter is available on PATH.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, ok, repoRoot } = require('./lib');

function findPython() {
  for (const name of ['python', 'python3']) {
    const r = spawnSync(name, ['--version'], { stdio: 'ignore' });
    if (r.status === 0) return name;
  }
  return null;
}

const py = findPython();

test('python-agent compiles', () => {
  if (!py) {
    console.log('  (skipped: no python on PATH)');
    return;
  }
  const agent = path.join(repoRoot(), 'python-agent');
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name === 'build') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.py')) files.push(full);
    }
  })(agent);
  ok(files.length >= 6, 'expected agent .py files');
  const script = 'import sys; [compile(open(f, encoding="utf-8").read(), f, "exec") for f in sys.argv[1:]]';
  const r = spawnSync(py, ['-c', script, ...files], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'compile failed');
});
