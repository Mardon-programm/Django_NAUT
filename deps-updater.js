// DjangoNAUT Dependency Upgrader: parse requirements.txt, compare with
// latest versions on PyPI, report outdated packages and simple CVEs via OSV.

const fs = require('node:fs');
const path = require('node:path');

const PYPI = 'https://pypi.org/pypi';
const OSV = 'https://api.osv.dev/v1/query';

function findRequirements(root) {
  const candidates = ['requirements.txt', 'requirements/base.txt', 'requirements/prod.txt', 'requirements/production.txt'];
  for (const c of candidates) {
    const full = path.join(root, c);
    if (fs.existsSync(full)) return { file: full, rel: c };
  }
  return null;
}

function parseRequirements(root) {
  const req = findRequirements(root);
  if (!req) return { file: null, packages: [] };
  let content;
  try { content = fs.readFileSync(req.file, 'utf8'); } catch { return { file: null, packages: [] }; }

  const packages = [];
  for (const raw of content.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.split('#')[0].trim();
    if (!line || line.startsWith('-')) continue;

    // strip extras: package[extra]==1.2
    let name = line.split(/[<>=!~\s]/)[0];
    name = name.replace(/\[.*\]/, '');
    if (!name) continue;

    const specMatch = line.match(/[<>=!~]{1,2}\s*([\w.\-]+)/);
    const current = specMatch ? specMatch[1] : null;
    if (name && !packages.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      packages.push({ name, spec: specMatch ? line.replace(/^[^<>=!~]+/, '') : '', current });
    }
  }
  return { file: req.rel, packages };
}

async function checkLatest(pkg) {
  try {
    const res = await fetch(`${PYPI}/${encodeURIComponent(pkg)}/json`, { timeout: 8000 });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.info?.version || null;
  } catch { return null; }
}

async function checkVulnerabilities(pkg, version) {
  try {
    const res = await fetch(OSV, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: { ecosystem: 'PyPI', name: pkg }, version }),
      timeout: 8000,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.vulns || []).slice(0, 5).map((v) => ({
      id: v.id,
      summary: (v.summary || v.details || '').slice(0, 200),
      modified: v.modified,
    }));
  } catch { return []; }
}

// Concurrency-aware semver-ish comparison: returns true if current < latest.
function isOutdated(current, latest) {
  if (!current || !latest) return false;
  const parse = (v) => {
    const m = v.replace(/^[^0-9]*/, '').match(/\d+(\.\d+)*/);
    return m ? m[0].split('.').map(Number) : [0];
  };
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
}

async function scanDeps(root, onProgress) {
  const { file, packages } = parseRequirements(root);
  if (!file) return { file: null, packages: [] };

  const results = [];
  const concurrency = 6;
  let i = 0;
  async function worker() {
    while (i < packages.length) {
      const idx = i++;
      const pkg = packages[idx];
      const latest = await checkLatest(pkg.name);
      let vulns = [];
      if (latest) vulns = await checkVulnerabilities(pkg.name, pkg.current || latest);
      results.push({
        ...pkg,
        latest,
        outdated: isOutdated(pkg.current, latest),
        vulns,
      });
      if (onProgress) onProgress(idx + 1, packages.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, packages.length) }, () => worker()));
  results.sort((a, b) => (b.outdated - a.outdated) || (b.vulns.length - a.vulns.length));
  return { file, packages: results };
}

module.exports = { parseRequirements, scanDeps, checkLatest, checkVulnerabilities, isOutdated, findRequirements };
