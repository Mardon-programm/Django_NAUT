// Live end-to-end: telemetry server -> django_naut agent -> runserver_naut -> HTTP request -> telemetry events.
// Logs to _live-check-result.log so results survive tool/console quirks.
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { startTelemetryServer } = require('./telemetry-server');

const ROOT = __dirname;
const MANAGE = path.join(ROOT, 'web_editor', 'manage.py');
const LOG = path.join(ROOT, '_live-check-result.log');

function log(...a) {
  const line = a.join(' ');
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

async function waitHttp(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      return res;
    } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  return null;
}

(async () => {
  try { fs.unlinkSync(LOG); } catch {}
  let ok = false;
  let srv = null;
  try {
    await startTelemetryServer(() => {});
    const { getState } = require('./telemetry-server');
    const port = getState().port;
    log('LIVE telemetry server on port', port);

    srv = spawn('python', [MANAGE, 'runserver_naut', '--naut-port', String(port), '127.0.0.1:8765'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
    });
    let out = '';
    srv.stdout.on('data', (d) => { out += d.toString(); });
    srv.stderr.on('data', (d) => { out += d.toString(); });

    const res = await waitHttp('http://127.0.0.1:8765/');
    log('LIVE page status:', res ? res.status : 'NO RESPONSE');
    log('LIVE server output tail:\n' + out.split('\n').slice(-20).join('\n'));

    await new Promise((r) => setTimeout(r, 1500));
    const st = getState();
    const kinds = st.events.map((e) => e.kind);
    log('LIVE events received:', st.events.length, kinds.join(',') || '(none)');

    const sql = st.events.filter((e) => e.kind === 'sql');
    if (sql.length > 0) {
      const e = sql[sql.length - 1];
      log('LIVE sql event: path=' + e.path + ' status=' + e.status + ' totalQueries=' + e.totalQueries + ' totalTime=' + e.totalTime + 'ms');
      log('LIVE sample sql:', JSON.stringify((e.queries && e.queries[0] && e.queries[0].sql) || '').slice(0, 160));
    }
    const errs = st.events.filter((e) => e.kind === 'error');
    if (errs.length) log('LIVE error event:', errs[0].exception, '-', (errs[0].message || '').slice(0, 80));

    ok = !!res && sql.length > 0 && sql[sql.length - 1].status === 200;
  } catch (err) {
    log('LIVE error:', err && err.message ? err.message : String(err));
  } finally {
    if (srv && srv.pid) {
      try { execSync('taskkill /PID ' + srv.pid + ' /T /F', { stdio: 'ignore' }); } catch {}
    }
    log('LIVE RESULT:', ok ? 'PASS' : 'FAIL');
    process.exit(ok ? 0 : 1);
  }
})();
