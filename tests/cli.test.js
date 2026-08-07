// Regression tests for the djangonaut CLI: exit codes, JSON output, fail-on.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, ok } = require('./lib');
const { parseArgs, runAudit, makeDepFindings } = require('../cli.js');

function makeProject(clean) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naut-cli-'));
  fs.mkdirSync(path.join(tmp, 'cfg'));
  fs.writeFileSync(path.join(tmp, 'manage.py'), '#!/usr/bin/env python\n');
  if (clean) {
    fs.writeFileSync(path.join(tmp, 'cfg', 'settings.py'), [
      'import os',
      "DEBUG = os.environ.get('DEBUG', 'False') == 'True'",
      "SECRET_KEY = os.environ.get('SECRET_KEY')",
      "ALLOWED_HOSTS = ['example.com']",
      "INSTALLED_APPS = []",
    ].join('\n'));
  } else {
    fs.writeFileSync(path.join(tmp, 'cfg', 'settings.py'), [
      'DEBUG = True',
      "SECRET_KEY = '1234567890abcdefghijklmnopqrstuv'",
      "ALLOWED_HOSTS = ['*']",
      'INSTALLED_APPS = []',
    ].join('\n'));
  }
  return tmp;
}

test('parseArgs defaults and flags', () => {
  const a = parseArgs(['audit', 'src', '--json', '--fail-on=warning', '--no-deps']);
  ok(a.folder === 'src' && a.json && a.failOn === 'warning' && a.deps === false, 'flags not parsed');
  ok(parseArgs(['--fail-on=banana']).error, 'invalid fail-on not rejected');
  const b = parseArgs(['--fail-on', 'warning', '--min-severity', 'error', '--output', 'x.json', '--markdown', 'x.md']);
  ok(b.failOn === 'warning' && b.minSeverity === 'error' && b.output === 'x.json' && b.markdown === 'x.md', 'space-form values not parsed');
  ok(parseArgs(['--output']).error, 'missing value not rejected');
  ok(parseArgs(['--fail-on', '--json']).error, 'value-looking-like-flag not rejected');
  ok(parseArgs(['--bogus']).error, 'unknown option not rejected');
});

test('clean project exits 0, dirty project exits 1 (fail-on error)', async () => {
  const clean = makeProject(true);
  const dirty = makeProject(false);
  try {
    const c = await runAudit(parseArgs([clean, '--no-deps']));
    ok(c.exitCode === 0 && c.ok && c.thresholdFindings === 0, 'clean project should pass');
    ok(c.report && typeof c.report.healthScore === 'number', 'no report in output');

    const d = await runAudit(parseArgs([dirty, '--no-deps']));
    ok(d.exitCode === 1 && !d.ok && d.thresholdFindings >= 1, 'dirty project should fail');
    const t = d.issues.map((i) => i.title);
    ok(t.some((x) => x === 'DEBUG = True'), 'DEBUG issue missing');
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
    fs.rmSync(dirty, { recursive: true, force: true });
  }
});

test('fail-on none never fails; non-Django folder is fatal exit 2', async () => {
  const dirty = makeProject(false);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'naut-empty-'));
  try {
    const a = await runAudit(parseArgs([dirty, '--no-deps', '--fail-on=none']));
    ok(a.exitCode === 0 && a.thresholdFindings === 0, 'fail-on none should exit 0');
    const f = await runAudit(parseArgs([empty, '--no-deps']));
    ok(f.exitCode === 2 && f.error, 'non-Django folder should be fatal exit 2');
  } finally {
    fs.rmSync(dirty, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('dep findings: vulnerable is critical, outdated is warning', () => {
  const f = makeDepFindings({ file: 'requirements.txt', packages: [
    { name: 'a', current: '1.0', latest: '1.1', outdated: true, vulns: [{ id: 'CVE-1' }] },
    { name: 'b', current: '1.0', latest: '1.2', outdated: true, vulns: [] },
    { name: 'c', current: '1.0', latest: '1.0', outdated: false, vulns: [] },
  ]});
  ok(f.some((x) => x.title === 'Vulnerable package: a' && x.severity === 'critical'), 'vuln not critical');
  ok(f.some((x) => x.title === 'Outdated package: b' && x.severity === 'warning'), 'outdated not warning');
  ok(!f.some((x) => x.title.includes('package: c')), 'current package flagged');
});
