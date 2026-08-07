// Compiles the python-agent sources. Skips (does not fail) when no Python
// interpreter is available on PATH.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, ok, repoRoot } = require('./lib');

function findPython() {
  for (const name of ['python', 'python3']) {
    const r = spawnSync(name, ['--version'], { stdio: 'ignore' });
    if (r.status === 0) return name;
  }
  return null;
}

const py = findPython();

test('python-agent compiles', () => {
  if (!py) {
    console.log('  (skipped: no python on PATH)');
    return;
  }
  const agent = path.join(repoRoot(), 'python-agent');
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name === 'build') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.py')) files.push(full);
    }
  })(agent);
  ok(files.length >= 6, 'expected agent .py files');
  const script = 'import sys; [compile(open(f, encoding="utf-8").read(), f, "exec") for f in sys.argv[1:]]';
  const r = spawnSync(py, ['-c', script, ...files], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'compile failed');
});

test('middleware redacts secrets and skips cookies/auth headers', () => {
  if (!py) {
    console.log('  (skipped: no python on PATH)');
    return;
  }
  const middleware = path.join(repoRoot(), 'python-agent', 'django_naut', 'middleware.py');
  const script = String.raw`
import sys, types, importlib.util, json
def stub(name, **attrs):
    m = types.ModuleType(name)
    for k, v in attrs.items(): setattr(m, k, v)
    return m
conf = stub("django.conf", settings=types.SimpleNamespace())
dep = stub("django.utils.deprecation", MiddlewareMixin=type("MiddlewareMixin", (), {}))
utils = stub("django.utils", deprecation=dep)
django = stub("django", conf=conf, utils=utils)
tlm = stub("django_naut.telemetry", get_client=lambda: None)
dnaut = stub("django_naut")
sys.modules.update({"django": django, "django.conf": conf, "django.utils": utils,
                    "django.utils.deprecation": dep, "django_naut": dnaut,
                    "django_naut.telemetry": tlm})
spec = importlib.util.spec_from_file_location("m", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

assert m._redact({"password": "abc", "user": "x", "nested": {"token": "t", "ok": 1}}) == \
       {"password": "***", "user": "x", "nested": {"token": "***", "ok": 1}}, "dict redact"
assert m._redact([{"api_key": "k"}, {"name": "n"}]) == [{"api_key": "***"}, {"name": "n"}], "list redact"
assert m._redact_body('{"password": "hunter2", "name": "bob"}') == '{"password": "***", "name": "bob"}', "json body"
assert m._redact_body('{"api_key": "abc123", "note": "x"}') == '{"api_key": "***", "note": "x"}', "json api key"
assert m._redact_body("password=hunter2&name=bob") == "password=***&name=bob", "form body"
assert m._redact_body("user=bob&csrfmiddlewaretoken=zzz") == "user=bob&csrfmiddlewaretoken=***", "form csrf"
headers = [h[0] for h in m._REQUEST_HEADERS]
assert "HTTP_COOKIE" not in headers and "HTTP_AUTHORIZATION" not in headers, "cookie/auth headers removed"
print("REDACT_OK")
`;
  const r = spawnSync(py, ['-c', script, middleware], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || 'redaction test failed');
  if (!/REDACT_OK/.test(r.stdout)) throw new Error('redaction assertions did not run');
});
