// DjangoNAUT Shell RPC: manages a persistent `python -m django_naut` process
// per project for the Notebook (JSON-RPC over stdio).
//
// Preferred python executable resolution:
//   1. <project>/.venv/Scripts/python.exe  (Windows venv)
//   2. <project>/.venv/bin/python          (unix venv)
//   3. <project>/venv/... (same pattern)
//   4. `python` on PATH, then `python3`

const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');

let agentDir = null;
function setAgentDir(dir) { agentDir = dir; }

function findPython(root) {
  const candidates = [
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, 'venv', 'Scripts', 'python.exe'),
    path.join(root, 'venv', 'bin', 'python'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function findSettingsModule(root) {
  if (!root || !fs.existsSync(root)) return null;
  const found = [];
  const stack = [{ dir: root, rel: '' }];
  while (stack.length) {
    const { dir, rel } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (['.venv', 'venv', 'env', 'node_modules', '.git', '__pycache__', 'dist', 'build'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push({ dir: full, rel: path.join(rel, entry.name) });
      } else if (entry.name === 'settings.py' && fs.existsSync(path.join(dir, '__init__.py'))) {
        found.push(rel.split(/[\\/]/).filter(Boolean).join('.'));
      }
    }
  }
  found.sort((a, b) => a.split('.').length - b.split('.').length);
  return found[0] || null;
}

function buildEnv(root, settingsModule) {
  const env = { ...process.env };
  if (settingsModule) env.DJANGO_SETTINGS_MODULE = settingsModule;
  const pythonPath = [root];
  if (agentDir) pythonPath.push(agentDir);
  const key = process.platform === 'win32' ? 'PYTHONPATH' : 'PYTHONPATH';
  env[key] = pythonPath.filter(Boolean).join(path.delimiter) + (process.env[key] ? path.delimiter + process.env[key] : '');
  env.PYTHONIOENCODING = 'utf-8';
  return env;
}

class ShellRPC {
  constructor(root) {
    this.root = root;
    this.proc = null;
    this.rl = null;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = false;
  }

  start() {
    if (this.proc) return true;
    const python = findPython(this.root);
    const settingsModule = findSettingsModule(this.root);
    const args = ['-m', 'django_naut'];
    const env = buildEnv(this.root, settingsModule);
    try {
      this.proc = spawn(python, args, { cwd: this.root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return false;
    }
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => {
      line = line.trim();
      if (!line) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const cb = this.pending.get(msg.id);
      if (cb) {
        this.pending.delete(msg.id);
        cb(msg);
      }
    });
    this.proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.includes('Traceback') || s.includes('ModuleNotFoundError') || s.includes('No module named')) {
        // surface only fatal startup errors via a synthetic reply
      }
    });
    this.proc.on('exit', () => { this.proc = null; this.rl = null; });
    return true;
  }

  ping() {
    return this._request('ping', {});
  }

  exec(code) {
    return this._request('exec', { code });
  }

  _request(type, payload) {
    return new Promise((resolve) => {
      if (!this.start()) {
        resolve({ ok: false, error: 'Failed to start DjangoNAUT shell process' });
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'Shell timeout (30s)' });
      }, 30000);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.proc.stdin.write(JSON.stringify({ id, type, ...payload }) + '\n');
    });
  }

  close() {
    if (this.proc) {
      try { this.proc.stdin.end(); } catch {}
      try { this.proc.kill(); } catch {}
      this.proc = null;
      this.rl = null;
    }
  }
}

const managers = new Map();

function getShell(root) {
  if (!root) return null;
  if (!managers.has(root)) managers.set(root, new ShellRPC(root));
  return managers.get(root);
}

function closeShell(root) {
  if (managers.has(root)) {
    managers.get(root).close();
    managers.delete(root);
  }
}

module.exports = { setAgentDir, getShell, closeShell, findPython, findSettingsModule };
