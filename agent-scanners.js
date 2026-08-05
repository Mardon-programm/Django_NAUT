// DjangoNAUT Signals Tracer + Celery task scanner.
// Parses @receiver / post_save.connect and @shared_task / @app.task decorators.

const fs = require('node:fs');
const path = require('node:path');

const IGNORE = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'env', 'dist', 'build', 'migrations']);

function walkPyFiles(root) {
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
      else if (entry.name.endsWith('.py')) files.push(full);
    }
  }
  return files;
}

function readFile(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

const SIGNAL_NAMES = new Set([
  'pre_init', 'post_init', 'pre_save', 'post_save', 'pre_delete', 'post_delete',
  'm2m_changed', 'pre_migrate', 'post_migrate', 'class_prepared', 'request_started',
  'request_finished', 'got_request_exception', 'setting_changed', 'pre_setup',
  'post_setup', 'login_failed', 'user_logged_in', 'user_logged_out', 'user_login_failed',
]);

function parseSender(senderExpr) {
  if (!senderExpr) return null;
  const m = senderExpr.match(/sender\s*=\s*([\w.]+)/) || senderExpr.match(/^\s*([\w.]+)\s*[,)]/);
  if (!m) return null;
  return m[1].replace(/^[\s,]+/, '');
}

// Signals: @receiver(post_save, sender=Order) and post_save.connect(handler, sender=Order)
function scanSignals(root) {
  const signals = [];
  for (const file of walkPyFiles(root)) {
    const content = readFile(file);
    if (!content) continue;
    const lines = content.split('\n');
    let inReceiver = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const receiverMatch = line.match(/@receiver\s*\(\s*([\w.]+)/);
      if (receiverMatch) {
        inReceiver = true;
        let sig = receiverMatch[1];
        const noSender = !line.includes('sender');
        // gather sender from decorator (may span lines)
        let j = i;
        let expr = line;
        while (!expr.includes(')') && j < lines.length - 1) {
          j++;
          expr += lines[j];
        }
        const sender = parseSender(expr);
        // find handler def below
        let handler = null;
        let handlerLine = null;
        for (let k = j + 1; k < Math.min(j + 6, lines.length); k++) {
          const dm = lines[k].match(/^\s*(?:async\s+)?def\s+(\w+)/);
          if (dm) { handler = dm[1]; handlerLine = k + 1; break; }
        }
        signals.push({
          type: 'receiver',
          signal: sig, sender,
          handler: handler || null, file, line: handlerLine || i + 1,
        });
        inReceiver = false;
        continue;
      }

      const connectMatch = line.match(/(?:^|\.)(post_save|pre_save|post_delete|pre_delete|post_init|pre_init|m2m_changed)\.connect\s*\(\s*([\w.]+)/);
      if (connectMatch) {
        const handler = connectMatch[2];
        const sender = parseSender(line.split('(').slice(1).join('('));
        signals.push({ type: 'connect', signal: connectMatch[1], sender, handler, file, line: i + 1 });
      }
    }
  }
  return signals;
}

// Build lenses: for each model name, how many signals fire on save/delete.
function getSignalLenses(signals, models) {
  const lenses = [];
  for (const model of models) {
    const base = model.name;
    const hits = signals.filter(
      (s) => s.sender && (s.sender === base || s.sender.endsWith('.' + base))
    );
    if (hits.length === 0) continue;
    const postSave = hits.filter((s) => String(s.signal || '').includes('post_save') || (s.type === 'connect' && s.signal === 'post_save')).length;
    const postDelete = hits.filter((s) => String(s.signal || '').includes('post_delete')).length;
    lenses.push({
      model: base,
      total: hits.length,
      save: postSave,
      delete: postDelete,
      signals: hits.map((h) => ({ handler: h.handler, signal: h.signal || 'post_save', file: h.file, line: h.line })),
    });
  }
  return lenses;
}

// Celery tasks: @shared_task / @app.task / @celery_app.task decorators
function scanTasks(root) {
  const tasks = [];
  for (const file of walkPyFiles(root)) {
    const content = readFile(file);
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const dm = lines[i].match(/^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
      if (!dm) continue;
      const decos = [];
      for (let k = i - 1; k >= 0 && /^\s*@/.test(lines[k]); k--) decos.unshift(lines[k].trim());
      const isTask = decos.some(
        (d) => d === '@shared_task' || d.startsWith('@shared_task') || /^@[\w.]+\.task\b/.test(d)
      );
      if (!isTask) continue;
      const args = (dm[2] || '')
        .split(',')
        .map((a) => a.trim().split(':')[0].split('=')[0].trim())
        .filter(Boolean);
      tasks.push({ name: dm[1], file, line: i + 1, args });
    }
  }
  return tasks.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { scanSignals, getSignalLenses, scanTasks, walkPyFiles };
