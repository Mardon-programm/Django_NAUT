// DjangoNAUT telemetry receiver.
// Runs inside the Electron main process. The Python agent (django_naut
// middleware) POSTs JSON events here; they are forwarded to the renderer.

const http = require('node:http');

const state = { port: 0, events: [], lastEvent: null };

function startTelemetryServer(onEvent) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      let payload = null;
      try { payload = JSON.parse(body); } catch { return; }
      if (payload && payload.kind) {
        state.lastEvent = payload;
        state.events.push(payload);
        if (state.events.length > 500) state.events.shift();
        try { onEvent(payload); } catch { /* ignore renderer errors */ }
      }
    });
  });
  server.on('error', (err) => console.error('[telemetry] server error:', err.message));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      state.port = server.address().port;
      resolve(server);
    });
  });
}

function getState() {
  return {
    port: state.port,
    lastEvent: state.lastEvent,
    events: state.events.slice(-50),
  };
}

module.exports = { startTelemetryServer, getState };
