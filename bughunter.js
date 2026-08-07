const fs = require('node:fs');
const path = require('node:path');
const { readFileSafe } = require('./django-scanner');

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Severity: error, warning, info, performance, security

// ── Check: DEBUG=True in settings ─────────────────────────────────────────

function checkDebugMode(scan) {
  if (!scan.settings) return [];
  if (scan.settings.debug === true) {
    return [{
      severity: 'warning',
      category: 'Security',
      title: 'DEBUG = True',
      message: 'DEBUG mode is enabled. It exposes detailed error pages. Verify this is intended for local/dev use only — it must be off in production.',
      file: path.join(scan.root, 'settings.py'),
      fix: 'Drive it from env, e.g. DEBUG = os.environ.get("DEBUG", "False") == "True", and keep it False in production.',
    }];
  }
  return [];
}

// ── Check: Weak SECRET_KEY ────────────────────────────────────────────────

function checkSecretKey(scan) {
  if (!scan.settings) return [];
  const issues = [];
  const settingsFile = scan.settings.settingsFile || path.join(scan.root, 'settings.py');
  const content = readFileSafe(settingsFile) || '';
  const envBased = /SECRET_KEY\s*=.*(?:os\.environ|environ\.get|getenv|python-decouple|config\s*\()/.test(content);
  const key = scan.settings.secretKey;

  if (!key && !envBased) {
    issues.push({
      severity: 'warning',
      category: 'Security',
      title: 'SECRET_KEY not found',
      message: 'Could not detect SECRET_KEY in settings.py.',
      file: path.join(scan.root, 'settings.py'),
      fix: 'Ensure SECRET_KEY is defined in settings.py.',
    });
  } else if (key && key.length < 20) {
    issues.push({
      severity: 'error',
      category: 'Security',
      title: 'SECRET_KEY is too short',
      message: `SECRET_KEY is only ${key.length} characters. Use at least 50 characters.`,
      file: path.join(scan.root, 'settings.py'),
      fix: 'Generate a strong SECRET_KEY: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"',
    });
  } else if (key && /^(abc|123|password|secret|django)/i.test(key)) {
    issues.push({
      severity: 'error',
      category: 'Security',
      title: 'SECRET_KEY appears to be weak',
      message: 'SECRET_KEY starts with a common prefix. Use a random key.',
      file: path.join(scan.root, 'settings.py'),
      fix: 'Generate a strong SECRET_KEY.',
    });
  }

  if (key && !envBased) {
    issues.push({
      severity: 'warning',
      category: 'Security',
      title: 'SECRET_KEY hardcoded in settings.py',
      message: 'SECRET_KEY is hardcoded. Consider using environment variables.',
      file: path.join(scan.root, 'settings.py'),
      fix: 'Use os.environ.get("SECRET_KEY") or python-decouple.',
    });
  }

  return issues;
}

// ── Check: N+1 queries ────────────────────────────────────────────────────

function checkNPlusOne(scan) {
  const issues = [];

  for (const view of scan.views) {
    const content = readFileSafe(view.filePath);
    if (!content) continue;

    const lines = content.split('\n');
    const loops = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = raw.length - raw.trimStart().length;
      while (loops.length && indent <= loops[loops.length - 1].indent) loops.pop();

      if (/^\s*(for|while)\b.*:\s*$/.test(raw)) {
        loops.push({ indent, line: i + 1 });
      }

      if (!loops.length) continue;

      const fkAccess = trimmed.match(/\.(\w+)(?![\(\w])/);
      if (fkAccess) {
        const name = fkAccess[1];
        if (scan.models.some((m) => m.fields.some((f) => f.isForeignKey && f.name === name))) {
          issues.push({
            severity: 'performance',
            category: 'N+1 Query',
            title: `Potential N+1 on "${name}" access`,
            message: `Accessing .${name} inside a loop at line ${i + 1}. This triggers a separate query per iteration.`,
            file: view.filePath,
            line: i + 1,
            fix: `Use select_related('${name}') or prefetch_related('${name}').`,
          });
        }
      }

      if (/\.objects\.(all|filter|exclude|get|first)\(/.test(trimmed)) {
        issues.push({
          severity: 'performance',
          category: 'N+1 Query',
          title: 'Query inside a loop',
          message: `Database query at line ${i + 1} is inside a loop. This causes N+1 queries.`,
          file: view.filePath,
          line: i + 1,
          fix: 'Move the query outside the loop or use prefetch_related.',
        });
      }
    }
  }

  return issues;
}

// ── Check: Missing indexes on ForeignKey ──────────────────────────────────
// Note: Django automatically creates a database index for ForeignKey and
// OneToOneField columns. Flagging every FK for db_index=True was a false
// positive — the column is already indexed. Removed for correctness.

// ── Check: Missing on_delete ──────────────────────────────────────────────

function checkMissingOnDelete(scan) {
  const issues = [];

  for (const model of scan.models) {
    for (const field of model.fields) {
      if (field.type === 'ForeignKey') {
        const content = readFileSafe(model.filePath);
        if (content) {
          const fieldLine = content.split('\n').find(l => l.trim().startsWith(field.name + ' '));
          if (fieldLine && !fieldLine.includes('on_delete')) {
            issues.push({
              severity: 'error',
              category: 'Models',
              title: `Missing on_delete for "${field.name}"`,
              message: `${model.name}.${field.name} is a ForeignKey without on_delete. Django requires this argument.`,
              file: model.filePath,
              line: model.line,
              fix: `Add on_delete=models.CASCADE (or PROTECT, SET_NULL, etc.) to ${field.name}.`,
            });
          }
        }
      }
    }
  }

  return issues;
}

// ── Check: Hardcoded secrets ──────────────────────────────────────────────

function checkHardcodedSecrets(scan) {
  const issues = [];
  const secretPatterns = [
    { regex: /(?:api_key|apikey|secret|token|password)\s*=\s*['"][A-Za-z0-9+/=_-]{10,}['"]/gi, label: 'Hardcoded secret' },
    { regex: /(?:AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID)\s*=\s*['"][A-Za-z0-9+/=_-]{10,}['"]/gi, label: 'AWS credential' },
  ];

  for (const file of scan.files) {
    if (file.includes('settings.py')) continue;
    if (file.includes('test')) continue;

    const content = readFileSafe(file);
    if (!content) continue;

    for (const pattern of secretPatterns) {
      const matches = content.matchAll(pattern.regex);
      for (const match of matches) {
        issues.push({
          severity: 'error',
          category: 'Security',
          title: pattern.label,
          message: `Found what looks like a hardcoded secret in ${path.relative(scan.root, file)}.`,
          file,
          fix: 'Move secrets to environment variables.',
        });
      }
    }
  }

  return issues;
}

// ── Check: Missing tests ──────────────────────────────────────────────────

function checkMissingTests(scan) {
  const issues = [];

  for (const app of scan.apps) {
    if (!app.path) continue;
    const testFiles = scan.files.filter(f =>
      f.startsWith(app.path) && (f.includes('test') || f.includes('spec'))
    );

    if (testFiles.length === 0) {
      issues.push({
        severity: 'warning',
        category: 'Testing',
        title: `No tests for "${app.name}"`,
        message: `App "${app.name}" has no test files.`,
        file: app.path,
        fix: `Create tests.py or tests/ directory in ${app.name}.`,
      });
    }
  }

  return issues;
}

// ── Check: ALLOWED_HOSTS ──────────────────────────────────────────────────

function checkAllowedHosts(scan) {
  if (!scan.settings) return [];

  const settingsFile = scan.settings.settingsFile || path.join(scan.root, 'settings.py');
  const content = readFileSafe(settingsFile);
  if (!content) return [];

  if (/ALLOWED_HOSTS\s*=\s*\[\s*\]/.test(content)) {
    return [{
      severity: 'warning',
      category: 'Security',
      title: 'ALLOWED_HOSTS is empty',
      message: 'ALLOWED_HOSTS is an empty list. The app will only respond to localhost.',
      file: path.join(scan.root, 'settings.py'),
      fix: 'Add your domain(s) to ALLOWED_HOSTS.',
    }];
  }

  if (/ALLOWED_HOSTS\s*=\s*\['\*'\]/.test(content)) {
    return [{
      severity: 'error',
      category: 'Security',
      title: 'ALLOWED_HOSTS = ["*"]',
      message: 'ALLOWED_HOSTS allows all hosts. This is a security risk.',
      file: path.join(scan.root, 'settings.py'),
      fix: 'Restrict ALLOWED_HOSTS to your domain(s).',
    }];
  }

  return [];
}

// ── Check: Unused imports ─────────────────────────────────────────────────

function checkUnusedImports(scan) {
  const issues = [];
  const COMMON = new Set(['os', 'sys']);

  for (const file of scan.files) {
    if (path.basename(file) === '__init__.py') continue;
    const content = readFileSafe(file);
    if (!content) continue;

    const lines = content.split('\n');
    const body = lines.filter((l) => !/^\s*(import|from)\s/.test(l)).join('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!/^(import|from)\s/.test(line)) continue;

      const symbols = [];
      const asMatch = line.match(/^import\s+(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        symbols.push(asMatch[2]);
      } else if (/^import\s/.test(line)) {
        const names = line.replace(/^import\s+/, '').split(',');
        for (const n of names) {
          const name = n.trim().split(/\s+as\s+/)[0].split('.')[0];
          if (name) symbols.push(name);
        }
      } else {
        const m = line.match(/^from\s+[\w.]+\s+import\s+(.+)$/);
        if (!m) continue;
        const items = m[1].split(',');
        for (const it of items) {
          const sym = it.trim().split(/\s+as\s+/)[0].split('.')[0];
          if (sym && sym !== '*' && sym !== '(') symbols.push(sym);
        }
      }

      for (const sym of symbols) {
        if (COMMON.has(sym)) continue;
        if (!new RegExp('\\b' + escRe(sym) + '\\b').test(body)) {
          issues.push({
            severity: 'info',
            category: 'Code Quality',
            title: `Unused import: "${sym}"`,
            message: `"${sym}" is imported but never used in ${path.relative(scan.root, file)} (line ${i + 1}).`,
            file,
            line: i + 1,
            fix: `Remove: ${line}`,
          });
        }
      }
    }
  }

  return issues;
}

// ── Check: Large files ────────────────────────────────────────────────────

function checkLargeFiles(scan) {
  const issues = [];

  for (const file of scan.files) {
    const content = readFileSafe(file);
    if (!content) continue;

    const lineCount = content.split('\n').length;
    if (lineCount > 500) {
      issues.push({
        severity: 'info',
        category: 'Code Quality',
        title: `Large file: ${lineCount} lines`,
        message: `${path.relative(scan.root, file)} has ${lineCount} lines. Consider splitting.`,
        file,
        fix: 'Break into smaller modules.',
      });
    }
  }

  return issues;
}

// ── Auto-fixable classification ───────────────────────────────────────────

function isAutoFixable(issue) {
  if (!issue || !issue.fix || !issue.file) return false;
  if (/^Missing on_delete/.test(issue.title)) return true;
  if (/^Unused import/.test(issue.title)) return true;
  return false;
}

// Apply a mechanical, reversible fix for supported issue categories.
// Returns { applied: boolean, reason?: string }.
function applyFix(issue) {
  if (!issue || !issue.file || !isAutoFixable(issue)) {
    return { applied: false, reason: 'not auto-fixable' };
  }

  let content;
  try {
    content = fs.readFileSync(issue.file, 'utf8');
  } catch (err) {
    return { applied: false, reason: 'unreadable file: ' + err.message };
  }

  // ── Missing on_delete ────────────────────────────────────────────────
  if (/^Missing on_delete/.test(issue.title)) {
    const m = issue.title.match(/for "([^"]+)"/);
    const field = m ? m[1] : null;
    if (!field) return { applied: false, reason: 'field name not in title' };
    const re = new RegExp('^\\s*' + escRe(field) + '\\s*=\\s*models\\.(ForeignKey|OneToOneField|ManyToManyField)\\s*\\(', 'm');
    const match = content.match(re);
    if (!match) return { applied: false, reason: 'field definition not found' };
    const lineStart = content.indexOf(match[0]);
    const lineEnd = content.indexOf('\n', lineStart);
    const fullLine = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
    if (fullLine.includes('on_delete')) return { applied: false, reason: 'already has on_delete' };
    const trimmed = fullLine.trim();
    if (!/\)\s*$/.test(trimmed) || /,\s*$/.test(trimmed)) return { applied: false, reason: 'multi-line definition, skipping' };
    const fixed = fullLine.replace(/\)\s*$/, ', on_delete=models.CASCADE)');
    content = content.slice(0, lineStart) + fixed + content.slice(lineEnd === -1 ? content.length : lineEnd);
  }

  // ── Unused import ────────────────────────────────────────────────────
  else if (/^Unused import/.test(issue.title)) {
    const m = issue.fix.match(/Remove:\s*(.+)/);
    const target = m ? m[1].trim() : null;
    if (!target) return { applied: false, reason: 'no import line to remove' };
    const lines = content.split('\n');
    const out = lines.filter((l) => l.trim() !== target);
    if (out.length === lines.length) return { applied: false, reason: 'import line not found' };
    content = out.join('\n');
  }

  try {
    fs.writeFileSync(issue.file, content, 'utf8');
  } catch (err) {
    return { applied: false, reason: 'write failed: ' + err.message };
  }
  return { applied: true };
}

// ── Run all checks ────────────────────────────────────────────────────────

function runBugHunter(scan) {
  const checks = [
    checkDebugMode,
    checkSecretKey,
    checkHardcodedSecrets,
    checkAllowedHosts,
    checkNPlusOne,
    checkMissingOnDelete,
    checkMissingTests,
    checkUnusedImports,
    checkLargeFiles,
  ];

  const issues = [];
  for (const check of checks) {
    issues.push(...check(scan));
  }

  // Sort: errors first, then warnings, then info
  const order = { error: 0, warning: 1, performance: 2, info: 3 };
  issues.sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4));

  for (const issue of issues) issue.fixable = isAutoFixable(issue);

  return issues;
}

module.exports = { runBugHunter, isAutoFixable, applyFix };
