"""Tiny HTTP client that pushes telemetry to the DjangoNAUT IDE.

The IDE runs a local HTTP listener (see telemetry-server.js). The agent
posts JSON events there: SQL reports, error reports, shell output.
"""

import json
import os
import threading
import urllib.request

_DEFAULT_HOST = os.environ.get("DJANGONAUT_HOST", "127.0.0.1")
_DEFAULT_PORT = int(os.environ.get("DJANGONAUT_PORT", "0"))


def _project_root():
    try:
        return os.getcwd()
    except Exception:
        return ""


class TelemetryClient:
    def __init__(self, host=None, port=None):
        self.host = host or _DEFAULT_HOST
        self.port = port if port is not None else _DEFAULT_PORT
        self._lock = threading.Lock()

    def is_enabled(self):
        return bool(self.port)

    def send(self, kind, payload):
        if not self.is_enabled():
            return
        data = {
            "kind": kind,
            "project": payload.pop("project", None) or _project_root(),
            **payload,
        }
        body = json.dumps(data, default=str).encode("utf-8")
        try:
            req = urllib.request.Request(
                "http://%s:%d/report" % (self.host, self.port),
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self._lock:
                urllib.request.urlopen(req, timeout=1.5)
        except Exception:
            pass


_client = TelemetryClient()


def get_client():
    return _client


def set_port(port):
    _client.port = int(port or 0)
