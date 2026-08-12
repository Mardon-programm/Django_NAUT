# Regression tests for the django_naut middleware:
#   - sync (WSGI-style test Client) and async (AsyncClient / ASGI) SQL capture
#   - telemetry events reach the IDE receiver over HTTP
# Run from repo root:  python python-agent/tests/test_middleware_capture.py
import asyncio
import json
import os
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
WEB_EDITOR = ROOT / "web_editor"

if WEB_EDITOR.exists():
    sys.path.insert(0, str(WEB_EDITOR))
else:
    raise SystemExit("web_editor demo project not found; cannot run middleware E2E tests")

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.conf import settings  # noqa: E402

EVENTS = []
_LOCK = threading.Lock()


def _start_receiver():
    """Start a local HTTP receiver mimicking the IDE telemetry server."""
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(n)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            try:
                with _LOCK:
                    EVENTS.append(json.loads(body))
            except Exception:
                pass

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def _install_middleware():
    from django_naut.middleware import DjangoNautMiddleware  # noqa: F401

    marker = "django_naut.middleware.DjangoNautMiddleware"
    if marker not in settings.MIDDLEWARE:
        settings.MIDDLEWARE = [marker] + list(settings.MIDDLEWARE)


def _setup(port):
    settings.DJANGONAUT_PORT = port
    settings.DJANGONAUT_HOST = "127.0.0.1"
    settings.DJANGONAUT_PROJECT = str(WEB_EDITOR)


def _last_sql_event():
    with _LOCK:
        return [e for e in EVENTS if e["kind"] == "sql"]


def _url():
    return "/admin/login/"


def _test_sync_capture():
    srv = _start_receiver()
    _setup(srv.server_address[1])
    _install_middleware()

    from django.test import Client

    client = Client()
    resp = client.get(_url())
    assert resp.status_code in (200, 301, 302), "sync GET status %s" % resp.status_code
    resp = client.post(_url(), {"username": "nobody", "password": "x"})
    assert resp.status_code == 200, "sync POST status %s" % resp.status_code

    import time

    time.sleep(0.5)
    events = _last_sql_event()
    assert events, "sync mode: no sql event received"
    srv.shutdown()
    print("SYNC CAPTURE OK: %d events" % len(events))


async def _test_async_capture():
    srv = _start_receiver()
    _setup(srv.server_address[1])
    _install_middleware()

    from django.test import AsyncClient

    client = AsyncClient()
    resp = await client.post(
        "/admin/login/",
        data={"username": "nobody", "password": "x"},
        content_type="application/x-www-form-urlencoded",
    )
    assert resp.status_code == 200, "async POST status %s" % resp.status_code

    await asyncio.sleep(0.5)
    events = _last_sql_event()
    assert events, "async mode: no sql event received"
    srv.shutdown()
    print("ASYNC CAPTURE OK: %d events" % len(events))


def _test_runserver_naut_args():
    """Addrport positional must reach runserver (was silently dropped before)."""
    import django_naut.management.commands.runserver_naut as m

    captured = {}

    def fake_start(port, host, args):
        captured["args"] = list(args)
        captured["port"] = port

    original = m._start
    m._start = fake_start
    try:
        from django.core.management import call_command

        call_command(
            "runserver_naut", "127.0.0.1:8766", "--naut-port", "9999", verbosity=0
        )
    finally:
        m._start = original
    assert captured.get("args") == ["127.0.0.1:8766"], "addrport lost: %r" % captured
    assert captured.get("port") == 9999, "naut port lost: %r" % captured
    print("RUNSERVER_NAUT ARGPASS OK:", captured["args"], "port", captured["port"])


if __name__ == "__main__":
    _test_runserver_naut_args()
    _test_sync_capture()
    asyncio.run(_test_async_capture())
    print("ALL MIDDLEWARE E2E TESTS PASSED")
