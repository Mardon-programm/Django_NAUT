// DjangoNAUT Enterprise Audit Report: health score, upgrade cost, dependency
// risk, and printable markdown/HTML report builders. Pure functions only.

function countBySeverity(issues, severity) {
  return (issues || []).filter((i) => i.severity === severity).length;
}

function computeReport({ scan, issues, security, deps, testStats }) {
  const errs = countBySeverity(issues, 'error');
  const warns = countBySeverity(issues, 'warning');
  const perfs = countBySeverity(issues, 'performance');
  const infos = countBySeverity(issues, 'info');

  const secFindings = (security && security.findings) || [];
  const secCrit = secFindings.filter((f) => f.severity === 'critical').length;
  const secWarn = secFindings.filter((f) => f.severity === 'warning').length;
  const secInfo = secFindings.filter((f) => f.severity === 'info').length;

  const bugSecCrit = (issues || []).filter((i) => i.category === 'Security' && i.severity === 'error').length;
  const bugSecWarn = (issues || []).filter((i) => i.category === 'Security' && i.severity === 'warning').length;
  const critTotal = secCrit + bugSecCrit;
  const warnTotal = secWarn + bugSecWarn;

  const pkgs = (deps && deps.packages) || [];
  const vulnPkgs = pkgs.filter((p) => p.vulns && p.vulns.length).length;
  const outdated = pkgs.filter((p) => p.outdated).length;

  const breakdown = [];
  let score = 100;

  const secDeduction = Math.min(40, critTotal * 20 + warnTotal * 6 + secInfo * 2);
  if (secDeduction > 0) {
    score -= secDeduction;
    breakdown.push({ label: 'Security', impact: -secDeduction, detail: `${critTotal} critical, ${warnTotal} warnings` });
  }

  const bugDeduction = Math.min(30, errs * 5 + warns * 2 + perfs * 1 + infos * 0.5);
  if (bugDeduction > 0) {
    score -= bugDeduction;
    breakdown.push({ label: 'Code quality', impact: -bugDeduction, detail: `${errs} errors, ${warns} warnings` });
  }

  const depDeduction = Math.min(20, vulnPkgs * 6 + outdated * 1);
  if (depDeduction > 0) {
    score -= depDeduction;
    breakdown.push({ label: 'Dependencies', impact: -depDeduction, detail: `${vulnPkgs} vulnerable, ${outdated} outdated` });
  }

  let testPassPct = null;
  if (testStats && (testStats.passed + testStats.failed + testStats.errors) > 0) {
    const total = testStats.passed + testStats.failed + testStats.errors;
    testPassPct = Math.round((testStats.passed / total) * 100);
    const testDeduction = testStats.failed > 0 ? Math.min(15, testStats.failed * 4) : 0;
    if (testDeduction > 0) {
      score -= testDeduction;
      breakdown.push({ label: 'Tests', impact: -testDeduction, detail: `${testPassPct}% passing` });
    }
  }

  if (critTotal + errs + warns + perfs + infos + vulnPkgs + outdated === 0) {
    breakdown.push({ label: 'Baseline', impact: 0, detail: 'No findings in static analysis' });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  const costHours = Math.max(0.5, Math.round((errs * 0.3 + warns * 0.15 + outdated * 0.5 + vulnPkgs * 1.5) * 10) / 10);

  let dependencyRisk = 'none';
  if (vulnPkgs > 0) dependencyRisk = 'high';
  else if (outdated > 0) dependencyRisk = 'medium';
  else if (pkgs.length > 0) dependencyRisk = 'low';

  return {
    healthScore: score,
    scoreLevel: score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad',
    breakdown,
    upgradeCostHours: costHours,
    dependencyRisk,
    counts: {
      errors: errs,
      warnings: warns,
      performance: perfs,
      info: infos,
      critical: critTotal,
      securityWarnings: warnTotal,
    },
    testPassPct,
    secCrit,
    secWarn,
    secInfo,
    outdated,
    vulnPkgs,
    packageCount: pkgs.length,
    scanMs: (scan && scan._scanMs) || 0,
  };
}

function formatHours(h) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return mins + ' min';
  if (mins === 0) return '~' + hrs + ' h';
  return '~' + hrs + ' h ' + mins + ' min';
}

function buildMarkdown(report, extra = {}) {
  const c = report.counts;
  const secRow = (label, value) => `- **${label}**: ${value}\n`;
  const lines = [];
  lines.push(`# DjangoNAUT Audit Report`);
  lines.push(``);
  lines.push(`- **Project**: ${extra.root || '—'}`);
  lines.push(`- **Generated**: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  lines.push(``);
  lines.push(`## Health Score`);
  lines.push(``);
  lines.push(`**${report.healthScore}/100** — ${report.scoreLevel === 'good' ? 'Healthy' : report.scoreLevel === 'warn' ? 'Needs attention' : 'Critical'}`);
  lines.push(``);
  for (const b of report.breakdown) {
    lines.push(`- ${b.label}: ${b.impact} pts (${b.detail})`);
  }
  lines.push(``);
  lines.push(`## Key Metrics`);
  lines.push(``);
  lines.push(secRow('Upgrade cost estimate', formatHours(report.upgradeCostHours)));
  lines.push(secRow('Dependency risk', report.dependencyRisk.toUpperCase()));
  lines.push(secRow('Dependencies', `${report.packageCount} packages · ${report.outdated} outdated · ${report.vulnPkgs} vulnerable`));
  if (report.testPassPct !== null) lines.push(secRow('Test pass rate', report.testPassPct + '%'));
  lines.push(secRow('Scan time', (report.scanMs / 1000).toFixed(1) + 's'));
  lines.push(``);
  lines.push(`## Findings`);
  lines.push(``);
  lines.push(`| Severity | Count |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Critical | ${c.critical} |`);
  lines.push(`| Error | ${c.errors} |`);
  lines.push(`| Warning | ${c.warnings} |`);
  lines.push(`| Performance | ${c.performance} |`);
  lines.push(`| Info | ${c.info} |`);
  lines.push(``);

  if (extra.issues && extra.issues.length) {
    lines.push(`## Issues`);
    lines.push(``);
    const sevLabel = { error: 'ERROR', warning: 'WARN', performance: 'PERF', info: 'INFO', critical: 'CRIT' };
    for (const i of extra.issues) {
      const loc = i.file ? (extra.root ? i.file.replace(extra.root, '') : i.file) + (i.line ? ':' + i.line : '') : '';
      lines.push(`- [${sevLabel[i.severity] || i.severity}] **${i.title}** — ${i.message}`);
      if (loc) lines.push(`  - Location: \`${loc}\``);
      if (i.fix) lines.push(`  - Fix: ${i.fix}`);
    }
    lines.push(``);
  }

  if (extra.security && extra.security.findings && extra.security.findings.length) {
    lines.push(`## Security Findings`);
    lines.push(``);
    for (const f of extra.security.findings) {
      lines.push(`- [${(f.severity || 'info').toUpperCase()}] **${f.rule}** — ${f.message}`);
    }
    lines.push(``);
  }

  if (extra.deps && extra.deps.packages && extra.deps.packages.length) {
    lines.push(`## Dependencies`);
    lines.push(``);
    for (const p of extra.deps.packages) {
      const flags = [];
      if (p.outdated) flags.push('outdated');
      if (p.vulns && p.vulns.length) flags.push(p.vulns.map((v) => v.id).join(', '));
      lines.push(`- ${p.name} ${p.current || 'any'} → ${p.latest || '?'}${flags.length ? ' (⚠ ' + flags.join(', ') + ')' : ''}`);
    }
    lines.push(``);
  }

  lines.push(`## Recommendations`);
  lines.push(``);
  const recs = [];
  if (c.critical > 0) recs.push('Resolve all critical security findings before deploying.');
  if (c.errors > 0) recs.push(`Fix the ${c.errors} error-level issues in the analysis.`);
  if (report.vulnPkgs > 0) recs.push(`Upgrade the ${report.vulnPkgs} packages with known vulnerabilities.`);
  if (report.outdated > 0) recs.push(`Plan an upgrade pass for ${report.outdated} outdated packages (est. ${formatHours(report.upgradeCostHours)}).`);
  if (report.testPassPct !== null && report.testPassPct < 100) recs.push(`Investigate the failing tests to restore a ${report.testPassPct}% → 100% pass rate.`);
  if (report.testPassPct === null) recs.push('Add a test suite — no tests were detected.');
  if (!recs.length) recs.push('No blocking issues found. Keep up the good work.');
  for (const r of recs) lines.push(`- ${r}`);
  lines.push(``);

  if (extra.notes && extra.notes.trim()) {
    lines.push(`## Notes`);
    lines.push(``);
    lines.push(extra.notes.trim());
    lines.push(``);
  }

  return lines.join('\n');
}

function buildReportHtml(report, extra = {}) {
  const md = buildMarkdown(report, extra);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DjangoNAUT Audit Report</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; margin: 32px; color: #d4d4d4; background: #1e1e1e; }
  h1 { font-size: 22px; color: #fff; border-bottom: 2px solid #007acc; padding-bottom: 8px; }
  h2 { font-size: 16px; color: #4ec9b0; margin-top: 22px; border-bottom: 1px solid #333; padding-bottom: 4px; }
  h3 { font-size: 14px; color: #dcdcaa; }
  table { border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid #444; padding: 4px 10px; font-size: 12px; }
  th { background: #333; }
  code { background: #2d2d2d; padding: 1px 4px; border-radius: 3px; }
  li { margin: 2px 0; }
  .score { font-size: 40px; font-weight: 700; color: #4ec9b0; }
  .muted { color: #9aa4af; font-size: 11px; }
</style>
</head>
<body>
<div class="score">${report.healthScore}/100</div>
<div class="muted">Health Score · ${report.dependencyRisk.toUpperCase()} dependency risk · upgrade est. ${formatHours(report.upgradeCostHours)}</div>
<pre>${esc(md)}</pre>
</body>
</html>`;
}

module.exports = { computeReport, buildMarkdown, buildReportHtml };
