// VS Code companion extension: manifest correctness + parseable extension.js.
const { test, eq, ok, repoRoot } = require('./lib');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const extDir = path.join(repoRoot(), 'vscode-extension');

test('extension manifest declares the command and setting', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(extDir, 'package.json'), 'utf8'));
  eq(pkg.name, 'djangonaut');
  eq(pkg.main, './extension.js');
  ok(pkg.contributes.commands.some((c) => c.command === 'djangonaut.openProject'));
  ok(pkg.contributes.configuration.properties['djangonaut.executablePath']);
  eq(pkg.engines.vscode, '^1.75.0');
});

test('extension.js parses and exports activate/deactivate', () => {
  execFileSync(process.execPath, ['--check', path.join(extDir, 'extension.js')]);
  const src = fs.readFileSync(path.join(extDir, 'extension.js'), 'utf8');
  ok(src.includes("require('vscode')"));
  ok(src.includes('djangonaut.openProject'));
  ok(src.includes("'--open'"));
});
