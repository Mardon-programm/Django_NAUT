// DjangoNAUT Migration Graph + Drift: builds the migration dependency graph
// and parses `makemigrations --check --dry-run` output for model drift.

const { scanMigrations } = require('./migration-guard');

function buildGraph(root) {
  const migrations = scanMigrations(root);
  const appMap = {};
  const apps = [];
  for (const m of migrations) {
    if (!appMap[m.app]) { appMap[m.app] = []; apps.push(m.app); }
    appMap[m.app].push(m);
  }
  apps.sort();

  const edges = [];
  const seen = new Set();
  for (const m of migrations) {
    for (const dep of m.deps) {
      if (dep.name === '__first__' || dep.name === '__latest__') continue;
      const match = String(dep.name).match(/^(\d{4})_/);
      if (!match) continue;
      const key = dep.app + '/' + match[1] + '>' + m.app + '/' + m.number;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: { app: dep.app, number: match[1] }, to: { app: m.app, number: m.number } });
    }
  }

  return { apps: apps.map((a) => ({ name: a, migrations: appMap[a] })), edges };
}

function parseDrift(res) {
  const text = ((res.stdout || '') + (res.stderr || '')).replace(/\r/g, '');
  const noChanges = /No changes detected/.test(text);
  const changes = [];
  const re = /^\s*[-+]\s+(.+)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) changes.push(m[1].trim());
  return {
    drift: res.code !== 0 && !noChanges,
    noChanges,
    changes,
    output: text.trim(),
  };
}

module.exports = { buildGraph, parseDrift };
