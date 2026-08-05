// Live Log Viewer server: spawns the Django dev server as a child process,
// splits stdout/stderr into classified lines and streams them over WebSocket.
//
// Started by main.js. Prints the WS port to stdout on startup.
// Env: DJANGONAUT_AGENT_DIR (python-agent dir), DJANGONAUT_PYTHON (python exe).

const { spawn } = require('node:child_process');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const AGENT_DIR = process.env.DJANGONAUT_AGENT_DIR || path.join(__dirname, 'python-agent');
const PYTHON = process.env.DJANGONAUT_PYTHON || 'python';

const server = http.createServer();
const wss = new WebSocketServer({ server });

const clients = new Set();
let child = null;
let childPid = 0;
let lineBuf = '';
let traceState = { inTrace: false };
let stopping = false;

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function broadcast(type, data) {
  const raw = JSON.stringify({ type, data });
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

function killChild() {
  if (!child) return;
  stopping = true;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(childPid), '/T', '/F'], { windowsHide: true });
    } else {
      try { process.kill(-childPid, 'SIGTERM'); } catch { try { process.kill(childPid, 'SIGTERM'); } catch {} }
    }
  } catch {}
  child = null;
}

function classifyLevel(text) {
  const state = traceState;
  if (/Traceback \(most recent call last\):/.test(text) || /^Traceback:/.test(text)) {
    state.inTrace = true;
    return 'error';
  }
  if (state.inTrace) {
    if (!text.trim()) { state.inTrace = false; return 'info'; }
    return 'error';
  }
  if (/(^|\s)(ERROR|CRITICAL|FATAL|Trac)\b|Error:/.test(text)) return 'error';
  if (/(WARNING|WARN|DeprecationWarning|RuntimeWarning)/.test(text)) return 'warn';
  if (/Watching for file changes|StatReloader|Performing system checks|Running checks|Starting development server|Quit the server|System check identified|Autoreload|reloader/.test(text)) return 'debug';
  if (/^(DEBUG|.*\bDEBUG\b)/.test(text)) return 'debug';
  if (/^\[[^\]]+\]\s+"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+/.test(text)) return 'request';
  return 'info';
}

function emitLine(text, level) {
  broadcast('line', {
    time: Date.now(),
    level,
    text,
  });
}

function processChunk(chunk) {
  lineBuf += chunk;
  const parts = lineBuf.split(/\r?\n/);
  lineBuf = parts.pop() || '';
  for (const part of parts) {
    const clean = part.replace(ANSI_RE, '');
    if (!clean.trim()) continue;
    const level = classifyLevel(clean);
    emitLine(clean, level);
  }
}

function startChild(opts) {
  killChild();
  const cwd = opts.cwd || os.homedir();
  const args = ['-u', '-m', 'django_naut', 'runserver'];
  if (opts.nautPort) args.push('--naut-port', String(opts.nautPort));
  const addr = opts.addr || '127.0.0.1:8000';
  args.push(addr);

  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    DJANGONAUT_AGENT_DIR: AGENT_DIR,
  };
  if (AGENT_DIR) {
    env.PYTHONPATH = AGENT_DIR + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '');
  }

  emitLine('$ python ' + args.join(' '), 'info');

  try {
    child = spawn(PYTHON, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    emitLine('Failed to start server: ' + err.message, 'error');
    child = null;
    return;
  }

  childPid = child.pid || 0;
  const thisChild = child;

  thisChild.stdout.on('data', (chunk) => processChunk(chunk.toString()));
  thisChild.stderr.on('data', (chunk) => processChunk(chunk.toString()));
  thisChild.on('error', (err) => {
    if (child !== thisChild) return;
    emitLine('Server process error: ' + err.message, 'error');
    child = null;
    childPid = 0;
    broadcast('status', { running: false, pid: 0 });
  });
  thisChild.on('exit', (code, signal) => {
    if (child !== thisChild) return;
    if (stopping) {
      emitLine('Server stopped', 'info');
    } else {
      emitLine('Server exited' + (signal ? ' (' + signal + ')' : '') + ' with code ' + code, code === 0 ? 'info' : 'warn');
    }
    stopping = false;
    child = null;
    childPid = 0;
    broadcast('status', { running: false, pid: 0 });
    broadcast('exit', { code });
  });

  broadcast('status', { running: true, pid: childPid, cwd });
}

wss.on('connection', (ws) => {
  clients.add(ws);
  broadcast('status', { running: !!child, pid: childPid });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const { type, data } = msg;

    if (type === 'start') {
      startChild(data || {});
    } else if (type === 'stop') {
      killChild();
      broadcast('status', { running: false, pid: 0 });
    } else if (type === 'status') {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'status', data: { running: !!child, pid: childPid } }));
    }
  });

  ws.on('close', () => clients.delete(ws));
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  process.stdout.write(String(port));
  console.error('[log-server] ws server on port', port);
});
