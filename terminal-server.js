const nodePty = require('node-pty');
const os = require('os');
const http = require('http');
const { WebSocketServer } = require('ws');

process.on('uncaughtException', (err) => {
  console.error('[terminal-server] uncaught exception:', err.message);
});

const PERSISTENT_SHELLS = {
  cmd: 'cmd.exe',
  powershell: 'powershell.exe',
  wsl: 'wsl.exe',
  bash: 'bash.exe',
};

const terminalInstances = new Map();
const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.error('[terminal-server] client connected');
  ws._pty = null;
  ws._tid = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, tid, data } = msg;

    if (type === 'spawn') {
      const { shellType, cwd, cols, rows } = data;
      const shell = PERSISTENT_SHELLS[shellType] || PERSISTENT_SHELLS.cmd;
      const shellArgs = shellType === 'powershell' ? ['-NoLogo', '-NoProfile'] :
                        shellType === 'bash' ? ['--norc', '--noprofile'] : [];

      try {
        const ptyProc = nodePty.spawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols: cols || 80,
          rows: rows || 24,
          cwd: cwd || os.homedir(),
          env: { ...process.env, TERM: 'xterm-256color', PYTHONIOENCODING: 'utf-8' },
        });

        ws._pty = ptyProc;
        ws._tid = tid;

        ptyProc.onData((output) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'output', tid, data: output }));
          }
        });

        ptyProc.onExit(({ exitCode }) => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'exit', tid, data: { code: exitCode } }));
          }
          terminalInstances.delete(tid);
        });

        terminalInstances.set(tid, ptyProc);
        ws.send(JSON.stringify({ type: 'spawned', tid, data: { pid: ptyProc.pid } }));
        console.error('[terminal-server] spawned:', shell, 'pid:', ptyProc.pid, 'tid:', tid);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', tid, data: { message: err.message } }));
        console.error('[terminal-server] spawn error:', err.message);
      }

    } else if (type === 'input') {
      const pty = terminalInstances.get(tid);
      if (pty) pty.write(data);

    } else if (type === 'resize') {
      const pty = terminalInstances.get(tid);
      if (pty) {
        try { pty.resize(data.cols, data.rows); } catch {}
      }

    } else if (type === 'kill') {
      const pty = terminalInstances.get(tid);
      if (pty) {
        try { pty.kill(); } catch {}
        terminalInstances.delete(tid);
      }
    }
  });

  ws.on('close', () => {
    if (ws._pty) {
      try { ws._pty.kill(); } catch {}
      terminalInstances.delete(ws._tid);
    }
    console.error('[terminal-server] client disconnected');
  });
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  process.stdout.write(String(port));
  console.error('[terminal-server] ws server on port', port);
});
