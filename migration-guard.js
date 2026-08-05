// DjangoNAUT Migration Guard: detects migration conflicts across local
// branches, broken dependencies, and can auto-rename conflicting files.

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const IGNORE = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'env', 'dist', 'build']);

function findMigrationDirs(root) {
  const dirs = [];
  if (!root || !fs.existsSync(root)) return dirs;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'migrations') { dirs.push(full); continue; }
        if (!IGNORE.has(entry.name)) stack.push(full);
      }
    }
  }
  return dirs;
}

const MIG_RE = /^(\d{4})_(.+)\.py$/;

function parseMigration(file) {
  const base = path.basename(file);
  const m = base.match(MIG_RE);
  if (!m) return null;
  let deps = [];
  try {
    const content = fs.readFileSync(file, 'utf8');
    const depMatch = content.match(/dependencies\s*=\s*\[(.*?)\]/s);
    if (depMatch) {
      const re = /\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
      let dm;
      while ((dm = re.exec(depMatch[1])) !== null) deps.push({ app: dm[1], name: dm[2] });
    }
  } catch { deps = []; }
  return { file, dir: path.dirname(file), app: path.basename(path.dirname(path.dirname(file))), number: m[1], name: m[2], deps };
}

function scanMigrations(root) {
  const migrations = [];
  for (const dir of findMigrationDirs(root)) {
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.py') || f === '__init__.py') continue;
      const parsed = parseMigration(path.join(dir, f));
      if (parsed) migrations.push(parsed);
    }
  }
  return migrations.sort((a, b) => a.number.localeCompare(b.number) || a.name.localeCompare(b.name));
}

function gitLsBranch(root, branch, pattern) {
  try {
    const out = execSync(`git ls-tree -r --name-only ${branch} -- "${pattern}"`, { cwd: root, timeout: 5000, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch { return []; }
}

function gitLocalBranches(root) {
  try {
    const out = execSync('git branch --format=%(refname:short)', { cwd: root, timeout: 5000, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch { return []; }
}

// Compare migration filenames on every local branch: two branches having a
// migration with the same numeric prefix but different names = conflict.
function checkBranchConflicts(root) {
  const conflicts = [];
  const branches = gitLocalBranches(root);
  if (branches.length < 2) return conflicts;

  const byNumber = new Map();
  const migrations = scanMigrations(root);
  for (const mig of migrations) {
    const key = mig.app + '/' + mig.number;
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push({ name: mig.name, branch: '(current)', file: mig.file });
  }

  for (const branch of branches) {
    const appDirs = migrations.length ? [...new Set(migrations.map((m) => m.app))] : [];
    for (const app of appDirs) {
      const files = gitLsBranch(root, branch, app + '/migrations/*.py');
      for (const rel of files) {
        const base = path.basename(rel);
        if (!MIG_RE.test(base)) continue;
        const number = base.match(MIG_RE)[1];
        const name = base.match(MIG_RE)[2];
        const key = app + '/' + number;
        if (byNumber.has(key)) {
          const existing = byNumber.get(key);
          if (!existing.some((e) => e.name === name)) {
            conflicts.push({ app, number, branch, file: rel, name, existsOn: existing[0].branch });
          }
        } else {
          byNumber.set(key, [{ name, branch }]);
        }
      }
    }
  }
  return conflicts;
}

// Verify every `dependencies` entry resolves to an existing migration.
function checkBrokenDeps(migrations) {
  const problems = [];
  const known = new Set(migrations.map((m) => m.app + '/' + m.number + '_' + m.name));
  for (const mig of migrations) {
    for (const dep of mig.deps) {
      if (dep.name === '__first__' || dep.name === '__latest__') continue;
      if (!known.has(dep.app + '/' + dep.name)) {
        problems.push({ file: mig.file, line: 0, message: `depends on missing migration ${dep.app}.${dep.name}` });
      }
    }
  }
  return problems;
}

// Rename a conflicting migration to the next free number and update every
// file that references the old name.
function autoFix(root, target) {
  const results = [];
  const migrations = scanMigrations(root);
  const mig = migrations.find((m) => m.file === target || (m.app === target.app && m.number === target.number && m.name === target.name));
  if (!mig) return { success: false, error: 'Migration not found' };

  const appMigs = migrations.filter((m) => m.app === mig.app);
  const used = new Set(appMigs.map((m) => m.number));
  let nextNum = Number(mig.number) + 1;
  while (used.has(String(nextNum).padStart(4, '0'))) nextNum++;
  const newNumber = String(nextNum).padStart(4, '0');
  const newName = mig.name + '_' + newNumber;
  const newFile = path.join(mig.dir, newNumber + '_' + newName + '.py');

  try {
    fs.renameSync(mig.file, newFile);
    results.push({ old: mig.file, new: newFile, action: 'renamed' });

    // update dependents referencing old name
    for (const other of migrations) {
      for (const dep of other.deps) {
        if (dep.app === mig.app && dep.name === mig.number + '_' + mig.name) {
          let content;
          try { content = fs.readFileSync(other.file, 'utf8'); } catch { continue; }
          const updated = content.replace(`('${mig.app}', '${mig.number}_${mig.name}')`, `('${mig.app}', '${newNumber}_${newName}')`);
          if (updated !== content) {
            fs.writeFileSync(other.file, updated, 'utf8');
            results.push({ old: other.file, new: other.file, action: 'dependency updated' });
          }
        }
      }
    }
    return { success: true, results };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { scanMigrations, checkBranchConflicts, checkBrokenDeps, autoFix, findMigrationDirs };
