// DjangoNAUT Security Scanner: static analysis of common Django
// vulnerabilities across the project (settings + Python + templates).
//
// Findings: { severity: 'critical'|'warning'|'info', rule, message, file, line }

const fs = require('node:fs');
const path = require('node:path');

const IGNORE = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'env', 'dist', 'build']);

function walkFiles(root, ext) {
  const files = [];
  if (!root || !fs.existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(ext)) files.push(full);
    }
  }
  return files;
}

function readFile(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

function scanSettings(file, content, lines, findings) {
  // Hardcoded SECRET_KEY
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*SECRET_KEY\s*=\s*['"]([^'"\s].{8,})/);
    if (m && !/os\.(environ|getenv)\.?/.test(lines[i])) {
      findings.push({
        severity: 'critical', rule: 'hardcoded-secret-key',
        message: 'Hardcoded SECRET_KEY in settings. Move it to an environment variable.',
        file, line: i + 1,
      });
    }
    // DEBUG = True
    if (/^\s*DEBUG\s*=\s*(True|1)/.test(lines[i]) && !/True\s*(#|\s*==)/.test(lines[i])) {
      findings.push({
        severity: 'warning', rule: 'debug-true',
        message: 'DEBUG=True is enabled. It leaks stack traces and settings in production.',
        file, line: i + 1,
      });
    }
    // DB password hardcoded
    if (/^\s*['"]PASSWORD['"]\s*:\s*['"][^'"\s]+/.test(lines[i])) {
      findings.push({
        severity: 'warning', rule: 'db-password-hardcoded',
        message: 'Database password is hardcoded. Load it from the environment.',
        file, line: i + 1,
      });
    }
  }

  // ALLOWED_HOSTS with wildcard (may span lines)
  const hosts = content.match(/ALLOWED_HOSTS\s*=\s*(\[[^\]]*\]|\{[^}]*\})/s);
  if (hosts && /['"]\*['"]/.test(hosts[1])) {
    const line = hosts[0].split('\n')[0];
    const lineNo = lines.findIndex((l) => l.includes('ALLOWED_HOSTS')) + 1;
    findings.push({
      severity: 'warning', rule: 'allowed-hosts-wildcard',
      message: "ALLOWED_HOSTS contains '*' — accepts requests for any host (Host header attacks).",
      file, line: lineNo || 1,
    });
  }

  // CSRF middleware missing
  if (!content.includes('CsrfViewMiddleware')) {
    const lineNo = (lines.findIndex((l) => l.includes('MIDDLEWARE')) + 1) || 1;
    findings.push({
      severity: 'warning', rule: 'csrf-middleware-missing',
      message: 'CsrfViewMiddleware is not in MIDDLEWARE. Forms are not CSRF-protected.',
      file, line: lineNo,
    });
  }

  // Security headers / cookie flags (recommendations)
  if (!/SECURE_SSL_REDIRECT\s*=/.test(content)) {
    findings.push({
      severity: 'info', rule: 'secure-ssl-redirect',
      message: 'SECURE_SSL_REDIRECT not set. Enable it to force HTTPS.',
      file, line: 1,
    });
  }
  if (!/SESSION_COOKIE_SECURE\s*=/.test(content)) {
    findings.push({
      severity: 'info', rule: 'session-cookie-secure',
      message: 'SESSION_COOKIE_SECURE not set — session cookie can travel over HTTP.',
      file, line: 1,
    });
  }
  if (!/CSRF_COOKIE_SECURE\s*=/.test(content)) {
    findings.push({
      severity: 'info', rule: 'csrf-cookie-secure',
      message: 'CSRF_COOKIE_SECURE not set — CSRF token can leak over HTTP.',
      file, line: 1,
    });
  }
  if (!/X_FRAME_OPTIONS\s*=/.test(content) && !/Content-Security-Policy/.test(content)) {
    findings.push({
      severity: 'info', rule: 'x-frame-options',
      message: 'X_FRAME_OPTIONS (clickjacking) not configured.',
      file, line: 1,
    });
  }
}

function scanPythonFile(file, content, lines, findings) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idx = i + 1;

    // Raw SQL
    if (/(\.raw\s*\(\s*(?:f)?['"]|cursor\.(?:execute|executemany)\s*\(\s*(?:f)?['"]|\.extra\s*\(\s*(?:where|select)\s*=)/.test(line)) {
      findings.push({
        severity: 'warning', rule: 'raw-sql',
        message: 'Raw SQL used. Avoid string interpolation — use parameters to prevent SQL injection.',
        file, line: idx,
      });
    } else if (/connection\.cursor\(/.test(line)) {
      findings.push({
        severity: 'info', rule: 'raw-sql-cursor',
        message: 'Manual DB cursor — review for SQL injection and keep it parameterized.',
        file, line: idx,
      });
    }

    // Code execution
    if (/\beval\s*\(/.test(line) || /\bexec\s*\(/.test(line)) {
      findings.push({
        severity: 'critical', rule: 'eval-exec',
        message: 'Dynamic code execution (eval/exec) — arbitrary code execution risk.',
        file, line: idx,
      });
    }
    if (/pickle\.loads\s*\(/.test(line)) {
      findings.push({
        severity: 'warning', rule: 'pickle',
        message: 'pickle.loads on untrusted data allows RCE. Never unpickle user input.',
        file, line: idx,
      });
    }
    if (/yaml\.load\s*\(/.test(line) && !/Loader=/.test(line)) {
      findings.push({
        severity: 'warning', rule: 'yaml-load',
        message: 'yaml.load without a safe Loader can execute arbitrary code.',
        file, line: idx,
      });
    }
    if (/shell\s*=\s*True/.test(line)) {
      findings.push({
        severity: 'warning', rule: 'shell-true',
        message: 'shell=True in subprocess — command injection risk. Prefer an args list.',
        file, line: idx,
      });
    }
    if (/os\.system\s*\(/.test(line)) {
      findings.push({
        severity: 'warning', rule: 'os-system',
        message: 'os.system() invokes a shell — command injection risk.',
        file, line: idx,
      });
    }

    // XSS-related
    if (/mark_safe\s*\(/.test(line)) {
      findings.push({
        severity: 'info', rule: 'mark-safe',
        message: 'mark_safe() bypasses HTML escaping — ensure the value is trusted.',
        file, line: idx,
      });
    }
    if (/@csrf_exempt/.test(line)) {
      findings.push({
        severity: 'warning', rule: 'csrf-exempt',
        message: '@csrf_exempt disables CSRF protection for this view.',
        file, line: idx,
      });
    }

    // Auth best practices
    if (/password\s*=\s*models\.CharField/.test(line)) {
      findings.push({
        severity: 'warning', rule: 'plain-password-field',
        message: 'Storing passwords as CharField — use Django auth / PasswordField hashing.',
        file, line: idx,
      });
    }
  }
}

function scanTemplate(file, content, lines, findings) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\|[^|]*\bsafe\b/.test(line) && !/\|\s*json_script/.test(line)) {
      findings.push({
        severity: 'info', rule: 'safe-filter',
        message: "|safe filter disables auto-escaping — only use on trusted content (XSS).",
        file, line: i + 1,
      });
    }
    if (/\{%\s*autoescape\s+off/.test(line)) {
      findings.push({
        severity: 'warning', rule: 'autoescape-off',
        message: 'autoescape off disables HTML escaping in this template block.',
        file, line: i + 1,
      });
    }
  }
}

function scanSecurity(root) {
  const findings = [];
  for (const file of walkFiles(root, '.py')) {
    const content = readFile(file);
    if (!content) continue;
    const lines = content.split('\n');
    if (path.basename(file) === 'settings.py') scanSettings(file, content, lines, findings);
    scanPythonFile(file, content, lines, findings);
  }
  for (const file of walkFiles(root, '.html')) {
    const content = readFile(file);
    if (!content) continue;
    scanTemplate(file, content, content.split('\n'), findings);
  }

  findings.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
    String(a.file).localeCompare(String(b.file)) ||
    (a.line - b.line)
  );

  const count = (sev) => findings.filter((f) => f.severity === sev).length;
  return {
    findings,
    summary: {
      critical: count('critical'),
      warning: count('warning'),
      info: count('info'),
      total: findings.length,
    },
  };
}

module.exports = { scanSecurity };
