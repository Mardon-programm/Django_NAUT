// Electron smoke test: boots the real app, waits for startup, and verifies
// the main process stays alive without fatal errors. Kills it afterwards.
// Run via: npm run test:smoke
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { repoRoot } = require('./lib');

const electron = path.join(repoRoot(), 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const tmp = path.join(os.tmpdir(), 'naut_smoke_' + process.pid);
fs.mkdirSync(tmp, { recursive: true });

const proc = spawn(electron, [repoRoot()], {
  cwd: repoRoot(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ELECTRON_DISABLE_GPU: '1', NODE_ENV: 'test' },
});

let out = '';
let err = '';
proc.stdout.on('data', (d) => { out += d.toString(); });
proc.stderr.on('data', (d) => { err += d.toString(); });

const FATAL = /(Uncaught Exception|Unable to load|did fail|SyntaxError|Cannot find module|TypeError|ReferenceError)/;

function finish(code, msg) {
  try { proc.kill(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log((code === 0 ? 'PASS' : 'FAIL') + ' electron smoke: ' + msg);
  if (err) console.log('--- stderr ---\n' + err.split('\n').slice(0, 25).join('\n'));
  process.exit(code);
}

const deadline = Date.now() + 20000;
const poll = setInterval(() => {
  if (proc.exitCode !== null) {
    clearInterval(poll);
    finish(1, 'main process exited early with code ' + proc.exitCode);
    return;
  }
  if (FATAL.test(err)) {
    clearInterval(poll);
    finish(1, 'fatal error in main process');
    return;
  }
  if (Date.now() > deadline) {
    clearInterval(poll);
    finish(0, 'app stayed alive for 20s without fatal errors');
  }
}, 500);

proc.on('error', (e) => {
  clearInterval(poll);
  finish(1, 'failed to spawn electron: ' + e.message);
});
