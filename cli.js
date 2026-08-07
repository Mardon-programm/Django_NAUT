// DjangoNAUT CLI — audit Django projects from the terminal / CI.
//
// Usage:
//   djangonaut audit [folder] [--json] [--fail-on=<level>] [--min-severity=<level>]
//                    [--no-deps] [--output=<path>] [--markdown=<path>]
//   djangonaut --version | --help
//
// Exit codes (CI-friendly):
//   0  audit passed (no findings at/above --fail-on threshold)
//   1  audit found findings at/above the threshold
//   2  fatal error (no Django project, unreadable, bad args)
//
// Pure Node — no Electron required.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { scanProject } = require('./django-scanner.js');
const { runBugHunter } = require('./bughunter.js');
const { scanSecurity } = require('./security-scanner.js');
const { scanDeps } = require('./deps-updater.js');
const { computeReport, buildMarkdown } = require('./report-generator.js');

const VERSION = require('./package.json').version;

const SEVERITY = { critical: 0, error: 1, warning: 2, performance: 3, info: 4 };
const SEV_LABEL = { critical: 'CRIT', error: 'ERROR', warning: 'WARN', performance: 'PERF', info: 'INFO' };

function fail(message, exitCode) {
  return { ok: false, exitCode: exitCode || 2, error: message };
}

function usage() {
  return [
    'DjangoNAUT CLI ' + VERSION,
    '',
    'Usage:',
    '  djangonaut audit [folder] [options]',
    '  djangonaut --version',
    '  djangonaut --help',
    '',
    'Options:',
    '  --json                Print the full audit as JSON.',
    '  --fail-on=<level>     Exit 1 if a finding is at or above this level.',
    '                        Levels: critical, error (default), warning, performance, info, none.',
    '  --min-severity=<lv>   Only output findings at or above this level (default: info).',
    '  --no-deps             Skip the network dependency scan (requirements.txt).',
    '  --output=<path>       Write the audit JSON to a file.',
    '  --markdown=<path>     Write a markdown report to a file.',
    '',
    'Exit codes:',
    '  0  passed',
    '  1  findings at/above --fail-on threshold',
    '  2  fatal error',
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { folder: '.', json: false, failOn: 'error', minSeverity: 'info', deps: true, output: null, markdown: null, help: false, version: false };
  const valueOpts = ['fail-on', 'min-severity', 'output', 'markdown'];
  const optMap = { 'fail-on': 'failOn', 'min-severity': 'minSeverity', 'output': 'output', 'markdown': 'markdown' };
  const setOpt = (key, val) => { args[optMap[key]] = val; };
  const argvL = argv.length;
  for (let i = 0; i < argvL; i++) {
    const raw = argv[i];
    if (raw === '--json') { args.json = true; continue; }
    if (raw === '--no-deps') { args.deps = false; continue; }
    if (raw === '--help' || raw === '-h') { args.help = true; continue; }
    if (raw === '--version' || raw === '-v') { args.version = true; continue; }
    const eq = raw.indexOf('=');
    if (raw.startsWith('--') && eq !== -1) {
      const key = raw.slice(2, eq);
      if (!valueOpts.includes(key)) return { error: 'Unknown option: ' + raw };
      setOpt(key, raw.slice(eq + 1));
      continue;
    }
    const dash = raw.match(/^--([a-z-]+)$/);
    if (raw.startsWith('--') && dash) {
      const key = dash[1];
      if (!valueOpts.includes(key)) return { error: 'Unknown option: ' + raw };
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) return { error: 'Missing value for ' + raw };
      setOpt(key, next);
      i++;
      continue;
    }
    if (raw.startsWith('-') && raw !== '-') return { error: 'Unknown option: ' + raw };
    args.folder = raw;
  }
  if (!(args.failOn in SEVERITY) && args.failOn !== 'none') {
    return { error: 'Invalid --fail-on level: ' + args.failOn + ' (use critical|error|warning|performance|info|none)' };
  }
  if (!(args.minSeverity in SEVERITY)) {
    return { error: 'Invalid --min-severity level: ' + args.minSeverity };
  }
  return args;
}

function makeDepFindings(deps) {
  const findings = [];
  for (const p of (deps && deps.packages) || []) {
    if (p.vulns && p.vulns.length) {
      findings.push({
        severity: 'critical',
        category: 'Dependencies',
        title: 'Vulnerable package: ' + p.name,
        message: p.name + ' ' + (p.current || 'any') + ' has known vulnerabilities: ' + p.vulns.map((v) => v.id).join(', '),
        file: (deps && deps.file) || null,
        fix: 'Upgrade ' + p.name + ' to ' + (p.latest || 'the latest release') + '.',
      });
    } else if (p.outdated) {
      findings.push({
        severity: 'warning',
        category: 'Dependencies',
        title: 'Outdated package: ' + p.name,
        message: p.name + ' ' + (p.current || 'any') + ' → ' + p.latest,
        file: (deps && deps.file) || null,
        fix: 'Upgrade ' + p.name + ' to ' + p.latest + '.',
      });
    }
  }
  return findings;
}

function color(code, s) {
  if (process.stdout.isTTY && !process.env.NO_COLOR) return '\x1b[' + code + 'm' + s + '\x1b[0m';
  return s;
}

function printText(audit, args) {
  const a = audit;
  const out = [];
  out.push('DjangoNAUT audit ' + VERSION);
  out.push('Project: ' + a.folder);
  out.push('Root:    ' + a.root);
  out.push('');
  const report = a.report || {};
  const level = report.scoreLevel === 'good' ? 'Healthy' : report.scoreLevel === 'warn' ? 'Needs attention' : 'Critical';
  out.push('Health:  ' + report.healthScore + '/100 (' + level + ') · upgrade est ' + report.upgradeCostHours + ' h · dep risk ' + String(report.dependencyRisk || '?').toUpperCase());
  const s = a.summary;
  out.push('Findings (' + s.total + '): ' + s.critical + ' critical, ' + s.errors + ' errors, ' + s.warnings + ' warnings, ' + s.performance + ' perf, ' + s.info + ' info' + (s.fixable ? ' · ' + s.fixable + ' auto-fixable' : ''));
  out.push('');

  const minRank = SEVERITY[args.minSeverity];
  for (const f of a.allFindings) {
    if (SEVERITY[f.severity] > minRank) continue;
    const loc = f.file ? (a.root ? String(f.file).replace(a.root, '').replace(/^[\\/]/, '') : f.file) + (f.line ? ':' + f.line : '') : '';
    const label = SEV_LABEL[f.severity] || String(f.severity).toUpperCase();
    const line = '[' + label + '] ' + (f.title || f.message) + (loc ? '  ' + loc : '');
    out.push(SEVERITY[f.severity] <= 1 ? color('31', line) : SEVERITY[f.severity] === 2 ? color('33', line) : line);
  }
  out.push('');

  const threshold = SEVERITY[a.failOn];
  if (a.exitCode === 1) {
    out.push(color('31', 'FAIL ' + a.thresholdFindings + ' finding(s) at/above threshold (' + a.failOn + ')'));
  } else {
    out.push(color('32', 'PASS — no findings at/above threshold (' + a.failOn + ')'));
  }
  if (a.depsSkipped) out.push('Note: dependency scan skipped (--no-deps)');
  return out.join('\n') + '\n';
}

async function runAudit(args) {
  const folder = path.resolve(args.folder);
  if (!fs.existsSync(folder)) return fail('Folder does not exist: ' + folder);
  if (!fs.statSync(folder).isDirectory()) return fail('Not a directory: ' + folder);

  const t0 = Date.now();
  const scan = scanProject(folder);
  if (scan.error) return fail(scan.error);

  const issues = runBugHunter(scan);
  const security = scanSecurity(scan.root);
  let deps = { file: null, packages: [] };
  let depsSkipped = false;
  if (args.deps) {
    try {
      deps = await scanDeps(scan.root);
    } catch (err) {
      deps = { file: null, packages: [], error: String((err && err.message) || err) };
    }
  } else {
    depsSkipped = true;
  }

  const depFindings = makeDepFindings(deps);
  const allFindings = [...issues, ...((security && security.findings) || []), ...depFindings];

  const report = computeReport({ scan, issues, security, deps, testStats: null });
  const markdown = buildMarkdown(report, { root: scan.root, issues, security, deps, notes: '' });

  const failRank = SEVERITY[args.failOn];
  const thresholdFindings = args.failOn === 'none'
    ? []
    : allFindings.filter((f) => (SEVERITY[f.severity] ?? 99) <= failRank);

  const summary = {
    total: allFindings.length,
    critical: allFindings.filter((f) => f.severity === 'critical').length,
    errors: allFindings.filter((f) => f.severity === 'error').length,
    warnings: allFindings.filter((f) => f.severity === 'warning').length,
    performance: allFindings.filter((f) => f.severity === 'performance').length,
    info: allFindings.filter((f) => f.severity === 'info').length,
    fixable: issues.filter((i) => i.fixable).length,
    vulnerablePackages: report.vulnPkgs,
    outdatedPackages: report.outdated,
    testPassPct: null,
    scanMs: Date.now() - t0,
  };

  const audit = {
    tool: 'djangonaut',
    command: 'audit',
    version: VERSION,
    folder,
    root: scan.root,
    ok: thresholdFindings.length === 0,
    exitCode: thresholdFindings.length === 0 ? 0 : 1,
    failOn: args.failOn,
    thresholdFindings: thresholdFindings.length,
    depsSkipped,
    summary,
    issues,
    security,
    deps,
    report,
    allFindings,
    markdown,
  };

  if (args.output) {
    try {
      fs.writeFileSync(args.output, JSON.stringify({ ...audit, allFindings: undefined, markdown: undefined }, null, 2), 'utf8');
    } catch (err) {
      return fail('Could not write --output file: ' + (err && err.message));
    }
  }
  if (args.markdown) {
    try {
      fs.writeFileSync(args.markdown, markdown, 'utf8');
    } catch (err) {
      return fail('Could not write --markdown file: ' + (err && err.message));
    }
  }
  return audit;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    process.stderr.write('error: ' + args.error + '\n\n' + usage());
    process.exitCode = 2;
    return;
  }
  if (args.help || argv.length === 0) {
    process.stdout.write(usage());
    return;
  }
  if (args.version) {
    process.stdout.write(VERSION + '\n');
    return;
  }

  const audit = await runAudit(args);
  if (audit.error) {
    const body = { tool: 'djangonaut', command: 'audit', version: VERSION, folder: path.resolve(args.folder), ok: false, exitCode: audit.exitCode, error: audit.error };
    process.stderr.write(args.json ? JSON.stringify(body, null, 2) + '\n' : 'error: ' + audit.error + '\n');
    process.exitCode = audit.exitCode;
    return;
  }

  if (args.json) {
    const out = { ...audit, allFindings: undefined, markdown: undefined };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    process.stdout.write(printText(audit, args));
  }
  process.exitCode = audit.exitCode;
}

module.exports = { runAudit, main, parseArgs, makeDepFindings };

if (require.main === module) {
  main(process.argv.slice(2));
}
