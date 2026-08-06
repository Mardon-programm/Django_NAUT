const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { spawn, exec } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const https = require('node:https');
const crypto = require('node:crypto');

const { scanProject } = require('./django-scanner');
const { runBugHunter } = require('./bughunter');
const { startTelemetryServer, getState } = require('./telemetry-server');
const migrationGuard = require('./migration-guard');
const { scanSignals, getSignalLenses, scanTasks } = require('./agent-scanners');
const securityScanner = require('./security-scanner');
const testRunner = require('./test-runner');
const shellRPC = require('./shell-rpc');
const deps = require('./deps-updater');
const cacheInspector = require('./cache-inspector');
const dbInspector = require('./db-inspector');
const urlInspector = require('./url-inspector');
const modelInspector = require('./model-inspector');
const settingsInspector = require('./settings-inspector');
const templateInspector = require('./template-inspector');
const formsInspector = require('./forms-inspector');
const staticInspector = require('./static-inspector');
const migrationGraph = require('./migration-graph');

const FULL_LIMITS = { jsonLimits: { list: 10000, dict: 1000, depth: 8 } };

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

const activeProcesses = new Map();
const activeWatchers = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  });
  win.loadFile('index.html');
  win.setMenu(null);
}


app.whenReady().then(async () => {
  await startTerminalServer();

  // DjangoNAUT agent location (python-agent) for shell RPC
  let agentDir;
  if (app.isPackaged) {
    agentDir = path.join(process.resourcesPath, 'python-agent');
  } else {
    agentDir = path.join(__dirname, 'python-agent');
  }
  shellRPC.setAgentDir(agentDir);

  // Live Log Viewer: spawns the Django dev server and streams its output
  try {
    await startLogServer(agentDir);
  } catch (err) {
    console.error('[logs] failed to start:', err.message);
  }

  // Telemetry listener: Python agent posts SQL/error events here
  try {
    await startTelemetryServer((payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('telemetry:event', payload);
      }
    });
  } catch (err) {
    console.error('[telemetry] failed to start:', err.message);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  for (const [, watcher] of activeWatchers) {
    try { watcher.close(); } catch {}
  }
  activeWatchers.clear();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Dialog ─────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ── File system ────────────────────────────────────────────────────────────

ipcMain.handle('fs:readdir', async (_event, dirPath) => {
  try {
    const files = await fs.promises.readdir(dirPath);
    const items = [];
    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      try {
        const stats = await fs.promises.stat(fullPath);
        items.push({ name: file, isDirectory: stats.isDirectory(), path: fullPath });
      } catch {}
    }
    return items;
  } catch {
    return [];
  }
});

ipcMain.handle('fs:readfile', async (_event, filePath) => {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (err) {
    throw new Error(err.code === 'ENOENT' ? 'File not found: ' + filePath : err.code === 'EACCES' ? 'Permission denied: ' + filePath : err.message);
  }
});

ipcMain.handle('fs:readfilebinary', async (_event, filePath) => {
  try {
    const buf = await fs.promises.readFile(filePath);
    return { data: buf.toString('base64'), mime: 'image/' + filePath.split('.').pop().toLowerCase().replace(/^(jpg|jpeg)$/, 'jpeg').replace(/^svg$/, 'svg+xml').replace(/^ico$/, 'x-icon') };
  } catch (err) {
    throw new Error(err.code === 'ENOENT' ? 'File not found: ' + filePath : err.code === 'EACCES' ? 'Permission denied: ' + filePath : err.message);
  }
});

ipcMain.handle('fs:writefile', async (_event, { filePath, content }) => {
  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (err) {
    throw new Error(err.code === 'EACCES' ? 'Permission denied: ' + filePath : err.message);
  }
});

ipcMain.handle('fs:rename', async (_event, { oldPath, newPath }) => {
  try {
    await fs.promises.rename(oldPath, newPath);
    return { success: true };
  } catch (err) {
    throw new Error(err.code === 'ENOENT' ? 'File not found: ' + oldPath : err.code === 'EACCES' ? 'Permission denied' : err.message);
  }
});

ipcMain.handle('fs:delete', async (_event, targetPath) => {
  try {
    const stat = await fs.promises.stat(targetPath);
    if (stat.isDirectory()) {
      await fs.promises.rm(targetPath, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(targetPath);
    }
    return { success: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { success: true };
    throw new Error(err.code === 'EACCES' ? 'Permission denied: ' + targetPath : err.message);
  }
});

ipcMain.handle('fs:mkdir', async (_event, dirPath) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (err) {
    throw new Error(err.code === 'EACCES' ? 'Permission denied: ' + dirPath : err.message);
  }
});

ipcMain.handle('fs:mkfile', async (_event, filePath) => {
  try {
    await fs.promises.writeFile(filePath, '', 'utf8');
    return { success: true };
  } catch (err) {
    throw new Error(err.code === 'EACCES' ? 'Permission denied: ' + filePath : err.message);
  }
});

ipcMain.handle('fs:search', async (_event, { dirPath, query, matchCase, isRegex }) => {
  const results = [];
  const MAX = 200;

  let searchRegex;
  try {
    searchRegex = isRegex
      ? new RegExp(query, matchCase ? 'g' : 'gi')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
  } catch {
    return [];
  }

  async function walk(dir, depth) {
    if (depth > 10 || results.length >= MAX) return;
    try {
      const items = await fs.promises.readdir(dir);
      for (const item of items) {
        if (results.length >= MAX) return;
        if (['node_modules', '.git', '__pycache__', '.venv', 'venv', 'env', '.idea', 'dist', 'build'].includes(item)) continue;
        const full = path.join(dir, item);
        try {
          const stat = await fs.promises.stat(full);
          if (stat.isDirectory()) {
            await walk(full, depth + 1);
          } else {
            const ext = item.split('.').pop().toLowerCase();
            if (['py', 'html', 'htm', 'css', 'js', 'json', 'md', 'txt', 'xml', 'yml', 'yaml', 'toml', 'cfg', 'ini', 'sh'].includes(ext)) {
              try {
                const content = await fs.promises.readFile(full, 'utf8');
                const lines = content.split('\n');
                const fileMatches = [];
                for (let i = 0; i < lines.length; i++) {
                  searchRegex.lastIndex = 0;
                  if (searchRegex.test(lines[i])) {
                    fileMatches.push({ line: i + 1, text: lines[i].trim() });
                  }
                }
                if (fileMatches.length > 0) {
                  results.push({ file: full, matches: fileMatches.slice(0, 10) });
                }
              } catch {}
            }
          }
        } catch {}
      }
    } catch {}
  }

  await walk(dirPath, 0);
  return results;
});

// ── Process ────────────────────────────────────────────────────────────────

const SHELL_COMMANDS = {
  cmd: { command: 'cmd.exe', args: ['/c'] },
  powershell: { command: 'powershell.exe', args: ['-NoProfile', '-Command'] },
  wsl: { command: 'wsl.exe', args: [] },
  bash: { command: 'bash.exe', args: ['-c'] },
};

ipcMain.handle('process:spawn', async (event, { command, args, cwd, shellType }) => {
  return new Promise((resolve, reject) => {
    let proc;
    if (command) {
      proc = spawn(command, args || [], { cwd, shell: true });
    } else {
      const shell = SHELL_COMMANDS[shellType] || SHELL_COMMANDS.cmd;
      proc = spawn(shell.command, [...shell.args, ...(args || [])], { cwd, shell: false });
    }
    activeProcesses.set(proc.pid, proc);

    proc.stdout.on('data', (data) => {
      event.sender.send('process:output', { type: 'stdout', data: data.toString(), pid: proc.pid });
    });

    proc.stderr.on('data', (data) => {
      event.sender.send('process:output', { type: 'stderr', data: data.toString(), pid: proc.pid });
    });

    proc.on('close', (code) => {
      activeProcesses.delete(proc.pid);
      event.sender.send('process:exit', { code, pid: proc.pid });
      resolve({ code, pid: proc.pid });
    });

    proc.on('error', (err) => {
      activeProcesses.delete(proc.pid);
      reject(err);
    });
  });
});

ipcMain.on('process:kill', (_event, pid) => {
  const proc = activeProcesses.get(pid);
  if (proc) {
    proc.kill();
    activeProcesses.delete(pid);
  }
});

// ── Persistent Terminal (node-pty via separate Node.js process) ────────────

let terminalPort = 0;

function startTerminalServer() {
  return new Promise((resolve, reject) => {
    let serverPath;
    if (app.isPackaged) {
      serverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'terminal-server.js');
    } else {
      serverPath = path.join(__dirname, 'terminal-server.js');
    }
    const child = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });

    let portData = '';
    child.stdout.on('data', (chunk) => {
      portData += chunk.toString();
      if (!terminalPort) {
        const parsed = parseInt(portData, 10);
        if (parsed > 0) {
          terminalPort = parsed;
          console.log('[terminal] node-pty server started on port', terminalPort);
          resolve(terminalPort);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write('[terminal-server] ' + chunk.toString());
    });

    child.on('error', (err) => {
      console.error('[terminal] failed to start server:', err.message);
      reject(err);
    });

    child.on('exit', (code) => {
      console.log('[terminal] server exited with code', code);
    });
  });
}

ipcMain.handle('terminal:getPort', () => terminalPort);

// ── Live Log Server (Django runserver output stream) ───────────────────────

let logPort = 0;

function startLogServer(agentDir) {
  return new Promise((resolve, reject) => {
    let serverPath;
    if (app.isPackaged) {
      serverPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'log-server.js');
    } else {
      serverPath = path.join(__dirname, 'log-server.js');
    }
    const child = spawn(process.execPath, [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DJANGONAUT_AGENT_DIR: agentDir,
      },
    });

    let portData = '';
    child.stdout.on('data', (chunk) => {
      portData += chunk.toString();
      if (!logPort) {
        const parsed = parseInt(portData, 10);
        if (parsed > 0) {
          logPort = parsed;
          console.log('[logs] live log server started on port', logPort);
          resolve(logPort);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write('[log-server] ' + chunk.toString());
    });

    child.on('error', (err) => {
      console.error('[logs] failed to start server:', err.message);
      reject(err);
    });

    child.on('exit', (code) => {
      console.log('[logs] live log server exited with code', code);
    });
  });
}

ipcMain.handle('logs:getPort', () => logPort);

// ── Mail Capture Inspector ─────────────────────────────────────────────────

function mailDirFor(root) {
  const key = path.resolve(root || os.homedir()).replace(/\//g, '\\');
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'django_naut_mail', hash);
}

ipcMain.handle('mail:list', async (_event, root) => {
  const dir = mailDirFor(root);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({
        id: data.id,
        subject: data.subject,
        from: data.from,
        to: data.to || [],
        date: data.date,
        textLen: (data.text || '').length,
        html: !!data.html,
        attachments: data.attachments || [],
      });
    } catch {}
  }
  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return out;
});

ipcMain.handle('mail:read', async (_event, { root, id }) => {
  const dir = mailDirFor(root);
  const p = path.join(dir, path.basename(id) + '.json');
  if (!p.startsWith(dir + path.sep) || !fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
});

ipcMain.handle('mail:clear', async (_event, root) => {
  const dir = mailDirFor(root);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return true;
});

// ── System ─────────────────────────────────────────────────────────────────

ipcMain.handle('get:homedir', () => os.homedir());
ipcMain.handle('get:platform', () => process.platform);

// ── Git ────────────────────────────────────────────────────────────────────

function gitExec(cwd, args) {
  return new Promise((resolve) => {
    exec('git ' + args, { cwd, timeout: 5000 }, (err, stdout, stderr) => {
      if (err) resolve({ error: err.message, stdout: '', stderr: stderr || '' });
      else resolve({ error: null, stdout: stdout.trim(), stderr: '' });
    });
  });
}

ipcMain.handle('git:status', async (_event, cwd) => {
  const branch = await gitExec(cwd, 'rev-parse --abbrev-ref HEAD 2>nul');
  if (branch.error) return { branch: null, dirty: 0, files: [] };
  const status = await gitExec(cwd, 'status --porcelain 2>nul');
  const files = status.stdout ? status.stdout.split('\n').filter(Boolean) : [];
  return { branch: branch.stdout, dirty: files.length, files };
});

ipcMain.handle('git:branches', async (_event, cwd) => {
  const result = await gitExec(cwd, 'branch --format=%(refname:short)');
  if (result.error) return { branches: [], current: null };
  const branches = result.stdout.split('\n').filter(Boolean);
  const current = branches.length > 0 ? branches[0] : null;
  return { branches, current };
});

ipcMain.handle('git:switch', async (_event, { cwd, branch }) => {
  if (!/^[a-zA-Z0-9_./\-]+$/.test(branch)) {
    return { success: false, error: 'Invalid branch name' };
  }
  const result = await gitExec(cwd, 'checkout "' + branch + '"');
  return { success: !result.error, error: result.error || result.stderr };
});

ipcMain.handle('git:log', async (_event, cwd) => {
  const result = await gitExec(cwd, 'log --oneline -20');
  if (result.error) return [];
  return result.stdout.split('\n').filter(Boolean).map((line) => {
    const [hash, ...rest] = line.split(' ');
    return { hash, message: rest.join(' ') };
  });
});

// ── File Watcher ───────────────────────────────────────────────────────────

ipcMain.handle('watch:start', async (event, { dirPath, id }) => {
  if (activeWatchers.has(id)) {
    try { activeWatchers.get(id).close(); } catch {}
  }

  try {
    const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (filename && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('watch:change', { id, type: eventType, filename });
      }
    });
    activeWatchers.set(id, watcher);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('watch:stop', async (_event, id) => {
  if (activeWatchers.has(id)) {
    try { activeWatchers.get(id).close(); } catch {}
    activeWatchers.delete(id);
  }
  return { success: true };
});

// ── Django Management Commands ─────────────────────────────────────────────

ipcMain.handle('django:cmd', async (event, { command, cwd }) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [], { cwd, shell: true, detached: true });
    activeProcesses.set(proc.pid, proc);

    proc.stdout.on('data', (data) => {
      event.sender.send('process:output', { type: 'stdout', data: data.toString(), pid: proc.pid });
    });
    proc.stderr.on('data', (data) => {
      event.sender.send('process:output', { type: 'stderr', data: data.toString(), pid: proc.pid });
    });
    proc.on('close', (code) => {
      activeProcesses.delete(proc.pid);
      event.sender.send('process:exit', { code, pid: proc.pid });
      resolve({ code, pid: proc.pid });
    });
    proc.on('error', (err) => {
      activeProcesses.delete(proc.pid);
      reject(err);
    });
  });
});

// ── Django Scanner ─────────────────────────────────────────────────────────

ipcMain.handle('django:scan', (_event, folder) => {
  return scanProject(folder);
});

ipcMain.handle('django:bughunt', (_event, folder) => {
  const scan = scanProject(folder);
  if (scan.error) return { scan, issues: [] };
  const issues = runBugHunter(scan);
  return { scan, issues };
});

// ── GROQ AI ────────────────────────────────────────────────────────────────

const DEFAULT_GROQ_KEY = process.env.GROQ_API_KEY || '';

function getGroqKey(overrideKey) {
  if (overrideKey && overrideKey.trim()) return overrideKey.trim();
  if (DEFAULT_GROQ_KEY) return DEFAULT_GROQ_KEY;
  throw new Error('No GROQ API key. Set GROQ_API_KEY environment variable or provide key in settings.');
}

function buildSystemPrompt(mode, scanData) {
  const base = 'You are an expert Django developer and software architect. Respond in the same language as the user.';

  if (mode === 'architect') {
    return base + '\n\nYou are an AI Architect. Given a feature request, produce a detailed, step-by-step implementation plan for a Django project. Include: models, views, serializers, URL routes, migrations, and test strategy. Format in markdown with code blocks.\n\nProject context:\n' + buildProjectContext(scanData);
  }

  if (mode === 'memory') {
    return base + '\n\nYou are a Django Memory assistant. Answer questions about where code is, how components connect, and what dependencies exist. Reference file paths when possible.\n\nProject context:\n' + buildProjectContext(scanData);
  }

  if (mode === 'bughunter') {
    return base + '\n\nYou are a Bug Hunter. Analyze Django projects for security vulnerabilities, performance issues, and code quality. Be specific, cite files, and provide concrete fixes.\n\nProject context:\n' + buildProjectContext(scanData);
  }

  return base + '\n\nAnalyze the provided Django code and give specific, actionable advice. Reference file names and line numbers.';
}

function buildProjectContext(scan) {
  if (!scan) return 'No project scanned yet.';
  const parts = [];
  if (scan.settings) {
    parts.push('Settings: DEBUG=' + scan.settings.debug + ', DB=' + (scan.settings.databaseEngine || 'sqlite3'));
  }
  if (scan.models && scan.models.length) {
    parts.push('Models: ' + scan.models.map((m) => m.name + ' (' + m.fields.length + ' fields)').join(', '));
  }
  if (scan.views && scan.views.length) parts.push('Views: ' + scan.views.length);
  if (scan.urls && scan.urls.length) parts.push('URL patterns: ' + scan.urls.length);
  return parts.length ? parts.join('\n') : 'No project structure available.';
}

function groqRequest(apiKey, model, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: model || 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    });

    const options = {
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode === 401) return reject(new Error('Invalid API key'));
          if (res.statusCode === 413) return reject(new Error('Payload too large. Try opening fewer files or reducing project scope.'));
          if (res.statusCode === 429) return reject(new Error('Rate limited. Try again in a moment.'));
          if (res.statusCode >= 400) return reject(new Error('API error (HTTP ' + res.statusCode + ')'));

          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error.message));
          else resolve(json.choices?.[0]?.message?.content || 'No response');
        } catch {
          reject(new Error('Failed to parse API response'));
        }
      });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('API request timed out (30s)'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

ipcMain.handle('ai:analyze', async (_event, { apiKey, model, prompt, files, mode, scanData }) => {
  const messages = [{ role: 'system', content: buildSystemPrompt(mode || 'general', scanData) }];
  if (files && files.length > 0) {
    let codeContext = '';
    for (const f of files) codeContext += `\n--- ${f.path || f.name} ---\n${f.content}\n`;
    messages.push({ role: 'user', content: prompt + '\n\nCode:\n' + codeContext });
  } else {
    messages.push({ role: 'user', content: prompt });
  }
  return groqRequest(getGroqKey(apiKey), model, messages);
});

ipcMain.handle('ai:architect', async (_event, { apiKey, model, feature, scanData }) => {
  return groqRequest(getGroqKey(apiKey), model, [
    { role: 'system', content: buildSystemPrompt('architect', scanData) },
    { role: 'user', content: 'Implement this feature: ' + feature },
  ]);
});

ipcMain.handle('ai:memory', async (_event, { apiKey, model, question, scanData }) => {
  return groqRequest(getGroqKey(apiKey), model, [
    { role: 'system', content: buildSystemPrompt('memory', scanData) },
    { role: 'user', content: question },
  ]);
});

ipcMain.handle('ai:bughunt', async (_event, { apiKey, model, issues, files, scanData }) => {
  const messages = [{ role: 'system', content: buildSystemPrompt('bughunter', scanData) }];
  let content = 'Analyze these static analysis issues and provide deeper insight:\n\n';
  for (const issue of issues) {
    content += `- [${issue.severity.toUpperCase()}] ${issue.title}: ${issue.message}\n`;
    if (issue.file) content += `  File: ${issue.file}${issue.line ? ':' + issue.line : ''}\n`;
  }
  if (files && files.length > 0) {
    content += '\nRelevant code:\n';
    for (const f of files) content += `\n--- ${f.path || f.name} ---\n${f.content}\n`;
  }
  messages.push({ role: 'user', content });
  return groqRequest(getGroqKey(apiKey), model, messages);
});

ipcMain.handle('ai:gentests', async (event, { apiKey, model, projectPath }) => {
  const fs = require('fs');
  const path = require('path');
  const SKIP = ['node_modules', '.git', '__pycache__', 'venv', '.venv', 'migrations', '.idea', '.vscode'];
  const KEY_FILES = new Set(['models.py', 'views.py', 'urls.py', 'serializers.py', 'forms.py', 'admin.py']);
  const files = {};
  const MAX_PER_FILE = 2000;
  const MAX_TOTAL = 10000;

  function walk(dir, depth) {
    if (depth > 8) return;
    try {
      for (const item of fs.readdirSync(dir)) {
        if (SKIP.includes(item) || item.startsWith('.')) continue;
        const full = path.join(dir, item);
        try {
          const st = fs.statSync(full);
          if (st.isDirectory()) walk(full, depth + 1);
          else if (st.isFile() && item.endsWith('.py') && KEY_FILES.has(item)) {
            const rel = path.relative(projectPath, full);
            files[rel] = fs.readFileSync(full, 'utf-8').slice(0, MAX_PER_FILE);
          }
        } catch {}
      }
    } catch {}
  }

  walk(projectPath, 0);
  if (Object.keys(files).length === 0) return { error: 'No Django files found' };

  let sections = '';
  let totalLen = 0;
  let truncated = false;
  for (const [fp, content] of Object.entries(files)) {
    if (totalLen + content.length > MAX_TOTAL) { truncated = true; break; }
    sections += `### ${fp}\n\`\`\`python\n${content}\n\`\`\`\n`;
    totalLen += content.length;
  }

  const truncNote = truncated ? '\n\nNote: Some files were omitted due to size limits. Generate tests based on the code shown above.' : '';
  const prompt = `You are an expert Django developer. Generate comprehensive pytest unit tests for this project:\n\n${sections}${truncNote}\n\nRules:\n- Use pytest and pytest-django\n- Test models, views, urls, serializers, forms\n- Test both success and error cases\n- Use reverse() for URL resolution\n- Output ONLY Python code\n- Group tests by module\n- Include proper imports`;

  return groqRequest(getGroqKey(apiKey), model, [
    { role: 'system', content: 'You are an expert Django developer generating pytest tests. Output only Python code.' },
    { role: 'user', content: prompt },
  ]);
});

// ── Docker ───────────────────────────────────────────────────────────────

ipcMain.handle('docker:containers', async () => {
  return new Promise((resolve) => {
    exec('docker ps -a --format "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"', { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve({ containers: [], error: err.message });
      const containers = stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [id, name, image, status, ports] = line.split('\t');
        return { id, name, image, status, ports };
      });
      resolve({ containers, error: null });
    });
  });
});

ipcMain.handle('docker:images', async () => {
  return new Promise((resolve) => {
    exec('docker images --format "{{.Repository}}\\t{{.Tag}}\\t{{.ID}}\\t{{.Size}}"', { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve({ images: [], error: err.message });
      const images = stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [repo, tag, id, size] = line.split('\t');
        return { repo, tag, id, size };
      });
      resolve({ images, error: null });
    });
  });
});

ipcMain.handle('docker:start', async (_event, containerId) => {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['start', String(containerId)], { timeout: 15000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ success: code === 0, output: stdout || stderr, error: code !== 0 ? stderr || 'docker start failed' : null }));
    proc.on('error', (err) => resolve({ success: false, output: '', error: err.message }));
  });
});

ipcMain.handle('docker:stop', async (_event, containerId) => {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['stop', String(containerId)], { timeout: 15000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ success: code === 0, output: stdout || stderr, error: code !== 0 ? stderr || 'docker stop failed' : null }));
    proc.on('error', (err) => resolve({ success: false, output: '', error: err.message }));
  });
});

ipcMain.handle('docker:remove', async (_event, containerId) => {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['rm', String(containerId)], { timeout: 15000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ success: code === 0, output: stdout || stderr, error: code !== 0 ? stderr || 'docker rm failed' : null }));
    proc.on('error', (err) => resolve({ success: false, output: '', error: err.message }));
  });
});

ipcMain.handle('docker:logs', async (_event, containerId) => {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['logs', '--tail', '100', String(containerId)], { timeout: 10000 });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ logs: stdout || stderr || '', error: code !== 0 ? stderr || null : null }));
    proc.on('error', (err) => resolve({ logs: '', error: err.message }));
  });
});

ipcMain.handle('docker:build', async (event, { context, tagName }) => {
  return new Promise((resolve) => {
    const args = ['build'];
    if (tagName && tagName.trim()) args.push('-t', tagName.trim());
    args.push(context);
    const proc = spawn('docker', args, { cwd: context });
    let output = '';
    proc.stdout.on('data', (d) => { const s = d.toString(); output += s; event.sender.send('process:output', { type: 'stdout', data: s, pid: proc.pid }); });
    proc.stderr.on('data', (d) => { const s = d.toString(); output += s; event.sender.send('process:output', { type: 'stderr', data: s, pid: proc.pid }); });
    proc.on('close', (code) => resolve({ success: code === 0, code, output }));
    proc.on('error', (err) => resolve({ success: false, error: err.message }));
  });
});

ipcMain.handle('docker:run', async (event, { image, name, ports }) => {
  return new Promise((resolve) => {
    const args = ['run', '-d'];
    if (name) args.push('--name', name);
    if (ports) {
      for (const p of ports.split(',')) {
        const trimmed = p.trim();
        if (trimmed) args.push('-p', trimmed);
      }
    }
    args.push(image);
    const proc = spawn('docker', args, { shell: true });
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); event.sender.send('process:output', { type: 'stderr', data: d.toString(), pid: proc.pid }); });
    proc.on('close', (code) => resolve({ success: code === 0, output }));
    proc.on('error', (err) => resolve({ success: false, error: err.message }));
  });
});

// ── HTTP Client (API Tester) ─────────────────────────────────────────────

ipcMain.handle('http:request', async (_event, { method, url, headers, body }) => {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const mod = isHttps ? require('node:https') : require('node:http');

      const reqHeaders = {};
      if (headers) {
        for (const h of headers) {
          if (h.key && h.value) reqHeaders[h.key] = h.value;
        }
      }

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: (method || 'GET').toUpperCase(),
        headers: reqHeaders,
        timeout: 30000,
      };

      const startTime = Date.now();
      const req = mod.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const elapsed = Date.now() - startTime;
          const resHeaders = {};
          for (const [k, v] of Object.entries(res.headers)) {
            resHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
          }
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: resHeaders,
            body: data,
            time: elapsed,
            size: Buffer.byteLength(data),
            error: null,
          });
        });
      });

      req.setTimeout(30000, () => {
        req.destroy();
        resolve({ status: 0, statusText: 'Timeout', headers: {}, body: '', time: 30000, size: 0, error: 'Request timed out (30s)' });
      });

      req.on('error', (err) => {
        resolve({ status: 0, statusText: 'Error', headers: {}, body: '', time: 0, size: 0, error: err.message });
      });

      if (body && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
        if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
          reqHeaders['Content-Type'] = 'application/json';
        }
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    } catch (err) {
      resolve({ status: 0, statusText: 'Error', headers: {}, body: '', time: 0, size: 0, error: err.message });
    }
  });
});

// ── Deploy Check ─────────────────────────────────────────────────────────

const SKIP_DIRS = ['node_modules', '.git', '__pycache__', 'venv', '.venv'];

function findSettingsFiles(dir, depth) {
  const results = [];
  if (depth > 4) return results;
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      try {
        if (item === 'settings.py') results.push(fullPath);
        if (fs.statSync(fullPath).isDirectory() && !SKIP_DIRS.includes(item)) {
          results.push(...findSettingsFiles(fullPath, depth + 1));
        }
      } catch {}
    }
  } catch {}
  return results;
}

function readFirstSettings(cwd) {
  const files = findSettingsFiles(cwd, 0);
  if (files.length === 0) return null;
  return fs.readFileSync(files[0], 'utf8');
}

ipcMain.handle('deploy:check', async (_event, { cwd, deployType }) => {
  const checks = [];

  // Check for Docker
  const dockerCheck = await new Promise((resolve) => {
    exec('docker --version', { timeout: 5000 }, (err) => resolve(!err));
  });
  checks.push({ name: 'Docker installed', passed: dockerCheck, detail: dockerCheck ? 'Docker is available' : 'Docker not found in PATH' });

  // Check for docker-compose
  const composeCheck = await new Promise((resolve) => {
    exec('docker-compose --version', { timeout: 5000 }, (err) => {
      if (!err) return resolve(true);
      exec('docker compose version', { timeout: 5000 }, (err2) => resolve(!err2));
    });
  });
  checks.push({ name: 'Docker Compose', passed: composeCheck, detail: composeCheck ? 'Available' : 'Not found' });

  // Check for Dockerfile
  const dockerfileExists = await new Promise((resolve) => {
    fs.access(path.join(cwd, 'Dockerfile'), fs.constants.F_OK, (err) => resolve(!err));
  });
  checks.push({ name: 'Dockerfile exists', passed: dockerfileExists, detail: dockerfileExists ? 'Found in project root' : 'No Dockerfile in project root' });

  // Check for docker-compose.yml
  const composeExists = await new Promise((resolve) => {
    const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    let found = false;
    let checked = 0;
    for (const c of candidates) {
      fs.access(path.join(cwd, c), fs.constants.F_OK, (err) => {
        if (!err) found = true;
        checked++;
        if (checked === candidates.length) resolve(found);
      });
    }
    if (candidates.length === 0) resolve(false);
  });
  checks.push({ name: 'docker-compose.yml', passed: composeExists, detail: composeExists ? 'Found' : 'No compose file found' });

  // Check for requirements.txt
  const reqTxtExists = await new Promise((resolve) => {
    fs.access(path.join(cwd, 'requirements.txt'), fs.constants.F_OK, (err) => resolve(!err));
  });
  checks.push({ name: 'requirements.txt', passed: reqTxtExists, detail: reqTxtExists ? 'Found' : 'Not found' });

  // Check for .env file
  const envExists = await new Promise((resolve) => {
    fs.access(path.join(cwd, '.env'), fs.constants.F_OK, (err) => resolve(!err));
  });
  checks.push({ name: '.env file', passed: envExists, detail: envExists ? 'Found' : 'Not found (optional)' });

  // Check DEBUG setting
  const debugCheck = await new Promise((resolve) => {
    try {
      const content = readFirstSettings(cwd);
      if (!content) return resolve({ passed: null, detail: 'No settings.py found' });
      const debugMatch = content.match(/DEBUG\s*=\s*(True|False)/i);
      if (!debugMatch) return resolve({ passed: null, detail: 'DEBUG not found in settings' });
      const isDebug = debugMatch[1] === 'True';
      resolve({ passed: !isDebug, detail: 'DEBUG = ' + debugMatch[1] + (isDebug ? ' (should be False for production)' : ' (OK)') });
    } catch {
      resolve({ passed: null, detail: 'Could not check settings' });
    }
  });
  checks.push({ name: 'DEBUG = False', passed: debugCheck.passed, detail: debugCheck.detail });

  // Check ALLOWED_HOSTS
  const hostsCheck = await new Promise((resolve) => {
    try {
      const content = readFirstSettings(cwd);
      if (!content) return resolve({ passed: null, detail: 'No settings.py found' });
      const hostsMatch = content.match(/ALLOWED_HOSTS\s*=\s*\[(.*?)\]/s);
      if (!hostsMatch) return resolve({ passed: null, detail: 'ALLOWED_HOSTS not found' });
      const hosts = hostsMatch[1].trim();
      const isEmpty = hosts === '' || hosts === "''" || hosts === '""';
      resolve({ passed: !isEmpty, detail: isEmpty ? 'ALLOWED_HOSTS is empty' : 'ALLOWED_HOSTS configured' });
    } catch {
      resolve({ passed: null, detail: 'Could not check settings' });
    }
  });
  checks.push({ name: 'ALLOWED_HOSTS', passed: hostsCheck.passed, detail: hostsCheck.detail });

  // Check for gunicorn / uwsgi in requirements
  const wsgiCheck = await new Promise((resolve) => {
    try {
      const content = fs.readFileSync(path.join(cwd, 'requirements.txt'), 'utf8');
      const hasGunicorn = content.toLowerCase().includes('gunicorn');
      const hasUwsgi = content.toLowerCase().includes('uwsgi');
      const hasWhitenoise = content.toLowerCase().includes('whitenoise');
      resolve({
        passed: hasGunicorn || hasUwsgi,
        detail: hasGunicorn ? 'gunicorn found' : hasUwsgi ? 'uwsgi found' : 'No WSGI server in requirements.txt',
        extras: { gunicorn: hasGunicorn, uwsgi: hasUwsgi, whitenoise: hasWhitenoise },
      });
    } catch {
      resolve({ passed: null, detail: 'Could not read requirements.txt' });
    }
  });
  checks.push({ name: 'WSGI server', passed: wsgiCheck.passed, detail: wsgiCheck.detail });

  // Check for static files config
  const staticCheck = await new Promise((resolve) => {
    try {
      const content = readFirstSettings(cwd);
      if (!content) return resolve({ passed: null, detail: 'No settings.py found' });
      const hasStaticRoot = content.includes('STATIC_ROOT');
      const hasStaticFiles = content.includes('STATICFILES_DIRS');
      resolve({ passed: hasStaticRoot, detail: hasStaticRoot ? 'STATIC_ROOT configured' : 'STATIC_ROOT not set' });
    } catch {
      resolve({ passed: null, detail: 'Could not check settings' });
    }
  });
  checks.push({ name: 'Static files', passed: staticCheck.passed, detail: staticCheck.detail });

  return checks;
});

// ── DjangoNAUT Agent Features ──────────────────────────────────────────────

ipcMain.handle('telemetry:getState', () => getState());

ipcMain.handle('agent:path', () => {
  if (app.isPackaged) return path.join(process.resourcesPath, 'python-agent');
  return path.join(__dirname, 'python-agent');
});

ipcMain.handle('agent:check', async (_e, root) => {
  const agentDir = app.isPackaged
    ? path.join(process.resourcesPath, 'python-agent')
    : path.join(__dirname, 'python-agent');
  const present = fs.existsSync(path.join(agentDir, 'django_naut'));
  let installed = false;
  try {
    const { execSync } = require('node:child_process');
    const py = shellRPC.findPython(root || process.cwd());
    const out = execSync(py + ' -c "import django_naut; print(django_naut.__version__)"', {
      timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    installed = /1\.0\.0/.test(out);
  } catch {}
  return { present, installed, agentDir };
});

ipcMain.handle('migration:scan', (_e, root) => {
  const migrations = migrationGuard.scanMigrations(root);
  const conflicts = migrationGuard.checkBranchConflicts(root);
  const brokenDeps = migrationGuard.checkBrokenDeps(migrations);
  return { migrations, conflicts, brokenDeps };
});

ipcMain.handle('migration:graph', (_e, root) => {
  return migrationGraph.buildGraph(root);
});

ipcMain.handle('migration:drift', async (_e, root) => {
  const res = await shellRPC.runCommand(root, ['manage.py', 'makemigrations', '--check', '--dry-run'], 60000);
  return { ...res, ...migrationGraph.parseDrift(res) };
});

ipcMain.handle('migration:fix', (_e, { root, target }) => {
  return migrationGuard.autoFix(root, target);
});

ipcMain.handle('signals:scan', async (_e, root) => {
  const scan = await scanProject(root);
  const signals = scanSignals(root);
  const models = scan.error ? [] : scan.models;
  const lenses = getSignalLenses(signals, models);
  return { signals, lenses, models };
});

ipcMain.handle('celery:scan', (_e, root) => {
  return { tasks: scanTasks(root) };
});

ipcMain.handle('celery:run', async (_e, { root, task, args }) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  const argStr = (args || []).map((a) => JSON.stringify(a)).join(', ');
  return shell.exec(`result = ${task}.delay(${argStr})\nresult`);
});

ipcMain.handle('shell:exec', async (_e, { root, code }) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(code);
});

ipcMain.handle('shell:ping', async (_e, root) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.ping();
});

ipcMain.handle('shell:close', (_e, root) => {
  shellRPC.closeShell(root);
  return { success: true };
});

ipcMain.handle('deps:scan', async (_e, root) => {
  return deps.scanDeps(root);
});

ipcMain.handle('security:scan', (_e, root) => {
  return securityScanner.scanSecurity(root);
});

ipcMain.handle('cache:inspect', async (_e, root) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(cacheInspector.inspectCode());
});

ipcMain.handle('cache:delete', async (_e, { root, alias, key }) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(cacheInspector.deleteCode(alias, key));
});

ipcMain.handle('cache:clear', async (_e, { root, alias }) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(cacheInspector.clearCode(alias));
});

ipcMain.handle('db:databases', async (_e, root) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(dbInspector.databasesCode());
});

ipcMain.handle('db:tables', async (_e, { root, alias }) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(dbInspector.tablesCode(alias));
});

ipcMain.handle('db:describe', async (_e, { root, alias, table }) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(dbInspector.describeCode(alias, table));
});

ipcMain.handle('db:preview', async (_e, { root, alias, table }) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(dbInspector.previewCode(alias, table, 50));
});

ipcMain.handle('db:query', async (_e, { root, alias, sql, params, limit }) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  if (!dbInspector.isReadOnly(sql)) return { ok: false, error: 'Only read-only queries are allowed (SELECT/EXPLAIN/WITH/SHOW/PRAGMA).' };
  return shell.exec(dbInspector.queryCode(alias, sql, params, limit));
});

ipcMain.handle('urls:scan', async (_e, root) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(urlInspector.scanCode(), FULL_LIMITS);
});

ipcMain.handle('orm:scan', async (_e, root) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(modelInspector.scanCode(), FULL_LIMITS);
});

ipcMain.handle('cfg:scan', async (_e, root) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(settingsInspector.settingsCode(), FULL_LIMITS);
});

ipcMain.handle('tpl:scan', async (_e, root) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(templateInspector.scanCode(), FULL_LIMITS);
});

ipcMain.handle('forms:scan', async (_e, root) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(formsInspector.scanCode(), FULL_LIMITS);
});

ipcMain.handle('static:scan', async (_e, root) => {
  const shell = shellRPC.getShell(root);
  if (!shell) return { ok: false, error: 'No project root' };
  return shell.exec(staticInspector.scanCode(), FULL_LIMITS);
});

ipcMain.handle('test:scan', (_e, root) => {
  return { tests: testRunner.scanTests(root) };
});

ipcMain.handle('test:run', async (_e, { root, target }) => {
  return testRunner.runTests(root, target);
});

ipcMain.handle('ai:mockdata', async (_e, { apiKey, model, scanData, amount }) => {
  if (!scanData || scanData.error || !scanData.models.length) {
    return { error: 'Open a Django project with models first' };
  }
  const modelDesc = scanData.models
    .map((m) => `${m.name}(${m.fields.map((f) => `${f.name}: ${f.type}${f.relatedModel ? '->' + f.relatedModel : ''}`).join(', ')})`)
    .join('\n');
  const prompt =
`You are a Django data factory. Generate a Python script (Django ORM, plain code, no shell_plus syntax) that populates the local database with ${amount || 20} realistic, logically consistent rows.

Models:
${modelDesc}

Rules:
- Use only the models listed; resolve FKs with existing or freshly created related objects.
- Dates, prices, statuses and related data must be internally consistent.
- Use bulk_create where sensible; guard against duplicates.
- Output ONLY Python code, no markdown fences, no comments, no explanation.`;

  return groqRequest(getGroqKey(apiKey), model, [
    { role: 'system', content: 'You are an expert Django developer generating database seed scripts. Output only Python code.' },
    { role: 'user', content: prompt },
  ]);
});
