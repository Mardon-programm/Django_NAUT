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
      severity: 'error',
      category: 'Security',
      title: 'DEBUG = True in production',
      message: 'DEBUG mode is enabled. This exposes detailed error pages and should never be used in production.',
      file: path.join(scan.root, 'settings.py'),
      fix: 'Set DEBUG = False in settings.py for production.',
    }];
  }
  return [];
}

// ── Check: Weak SECRET_KEY ────────────────────────────────────────────────

function checkSecretKey(scan) {
  if (!scan.settings) return [];
  const issues = [];
  const key = scan.settings.secretKey;

  if (!key) {
    issues.push({
      severity: 'warning',
      category: 'Security',
      title: 'SECRET_KEY not found',
      message: 'Could not detect SECRET_KEY in settings.py.',
      file: path.join(scan.root, 'settings.py'),
      fix: 'Ensure SECRET_KEY is defined in settings.py.',
    });
  } else if (key.length < 20) {
    issues.push({
      severity: 'error',
      category: 'Security',
      title: 'SECRET_KEY is too short',
      message: `SECRET_KEY is only ${key.length} characters. Use at least 50 characters.`,
      file: path.join(scan.root, 'settings.py'),
      fix: 'Generate a strong SECRET_KEY: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"',
    });
  } else if (/^(abc|123|password|secret|django)/i.test(key)) {
    issues.push({
      severity: 'error',
      category: 'Security',
      title: 'SECRET_KEY appears to be weak',
      message: 'SECRET_KEY starts with a common prefix. Use a random key.',
      file: path.join(scan.root, 'settings.py'),
      fix: 'Generate a strong SECRET_KEY.',
    });
  }

  // Check if hardcoded in settings (not using env)
  issues.push({
    severity: 'warning',
    category: 'Security',
    title: 'SECRET_KEY hardcoded in settings.py',
    message: 'SECRET_KEY is hardcoded. Consider using environment variables.',
    file: path.join(scan.root, 'settings.py'),
    fix: 'Use os.environ.get("SECRET_KEY") or python-decouple.',
  });

  return issues;
}

// ── Check: N+1 queries ────────────────────────────────────────────────────

function checkNPlusOne(scan) {
  const issues = [];

  for (const view of scan.views) {
    const content = readFileSafe(view.filePath);
    if (!content) continue;

    const lines = content.split('\n');
    const inLoop = [];
    let loopDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (/^\s*(for|while)\s+/.test(lines[i])) {
        loopDepth++;
        inLoop.push(i + 1);
      }
      if (loopDepth > 0 && (line === '}' || line === '' && lines[i].trimEnd() === '')) {
        loopDepth = Math.max(0, loopDepth - 1);
        if (loopDepth === 0) inLoop.pop();
      }

      // Check for attribute access on objects that might be ForeignKey
      if (loopDepth > 0) {
        const fkAccess = line.match(/\.(\w+)\s/);
        if (fkAccess && scan.models.some(m => m.fields.some(f => f.isForeignKey && f.name === fkAccess[1]))) {
          issues.push({
            severity: 'performance',
            category: 'N+1 Query',
            title: `Potential N+1 on "${fkAccess[1]}" access`,
            message: `Accessing .${fkAccess[1]} inside a loop at line ${i + 1}. This triggers a separate query per iteration.`,
            file: view.filePath,
            line: i + 1,
            fix: `Use select_related('${fkAccess[1]}') or prefetch_related('${fkAccess[1]}').`,
          });
        }

        // Check for .objects.all() or .filter() inside loops
        if (/\.objects\.(all|filter|exclude)\(/.test(line) && inLoop.length > 0) {
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
  }

  return issues;
}

// ── Check: Missing indexes on ForeignKey ──────────────────────────────────

function checkMissingIndexes(scan) {
  const issues = [];

  for (const model of scan.models) {
    for (const field of model.fields) {
      if (field.type === 'ForeignKey' || field.type === 'OneToOneField') {
        const content = readFileSafe(model.filePath);
        if (content && !content.includes('db_index=True') && !content.includes('related_name=')) {
          issues.push({
            severity: 'performance',
            category: 'Missing Index',
            title: `ForeignKey "${field.name}" may need an index`,
            message: `${model.name}.${field.name} is a ${field.type} without explicit db_index=True. Queries filtering on this field may be slow.`,
            file: model.filePath,
            line: model.line,
            fix: `Add db_index=True to ${field.name} = models.ForeignKey(..., db_index=True)`,
          });
        }
      }
    }
  }

  return issues;
}

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

  const content = readFileSafe(path.join(scan.root, 'settings.py'));
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

  for (const file of scan.files) {
    const content = readFileSafe(file);
    if (!content) continue;

    const lines = content.split('\n');
    const imports = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('import ') || line.startsWith('from ')) {
        const match = line.match(/(?:import|from)\s+(\w+)/);
        if (match) {
          imports.push({ name: match[1], line: i + 1, full: line });
        }
      }
    }

    const rest = content.replace(/^(?:import|from)\s+.+$/gm, '');

    for (const imp of imports) {
      if (imp.name === 'os' || imp.name === 'sys' || imp.name === 'django') continue;
      const regex = new RegExp('\\b' + imp.name + '\\b');
      if (!regex.test(rest)) {
        issues.push({
          severity: 'info',
          category: 'Code Quality',
          title: `Unused import: "${imp.name}"`,
          message: `"${imp.name}" is imported but never used in ${path.relative(scan.root, file)}.`,
          file,
          line: imp.line,
          fix: `Remove: ${imp.full}`,
        });
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
  if (/may need an index/.test(issue.title)) return true;
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

  // ── Missing index ────────────────────────────────────────────────────
  else if (/may need an index/.test(issue.title)) {
    const m = issue.title.match(/"([^"]+)"/);
    const field = m ? m[1] : null;
    if (!field) return { applied: false, reason: 'field name not in title' };
    const re = new RegExp('^\\s*' + escRe(field) + '\\s*=\\s*models\\.(ForeignKey|OneToOneField)\\s*\\(', 'm');
    const match = content.match(re);
    if (!match) return { applied: false, reason: 'field definition not found' };
    const lineStart = content.indexOf(match[0]);
    const lineEnd = content.indexOf('\n', lineStart);
    const fullLine = content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd);
    if (fullLine.includes('db_index')) return { applied: false, reason: 'already indexed' };
    const trimmed = fullLine.trim();
    if (!/\)\s*$/.test(trimmed) || /,\s*$/.test(trimmed)) return { applied: false, reason: 'multi-line definition, skipping' };
    const fixed = fullLine.replace(/\)\s*$/, ', db_index=True)');
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
    checkMissingIndexes,
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
