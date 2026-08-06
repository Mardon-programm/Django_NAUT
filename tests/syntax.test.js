// Verifies every root-level *.js file parses cleanly with node --check.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, ok, repoRoot } = require('./lib');

test('all root JS files pass node --check', () => {
  const files = fs.readdirSync(repoRoot()).filter((f) => f.endsWith('.js'));
  ok(files.length > 5, 'expected multiple JS files, found ' + files.length);
  const node = process.execPath;
  for (const f of files) {
    try {
      execFileSync(node, ['--check', path.join(repoRoot(), f)], { stdio: 'pipe' });
    } catch (e) {
      throw new Error('syntax error in ' + f + ': ' + (e.stderr ? e.stderr.toString() : e.message));
    }
  }
});
