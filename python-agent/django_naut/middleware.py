"""DjangoNAUT middleware: Live SQL telemetry + Error Interceptor.

Captures every SQL query executed during a request (with the caller
file:line stack) and any unhandled exception, then pushes both to the
DjangoNAUT IDE over HTTP.

Enabled automatically by `runserver_naut`; can also be added manually to
MIDDLEWARE in settings.py.
"""

import inspect
import time
import traceback

from django.conf import settings
from django.utils.deprecation import MiddlewareMixin

from django_naut.telemetry import get_client


def _get_port():
    return getattr(settings, "DJANGONAUT_PORT", 0) or 0


def _get_project():
    return getattr(settings, "DJANGONAUT_PROJECT", None)


def _capture_stack():
    """Return the first project frame (file:line) outside Django internals."""
    try:
        for fr in inspect.stack()[4:]:
            fname = fr.filename
            if (
                fname.endswith("middleware.py")
                or "/django/db/" in fname
                or "django/db/backends" in fname
                or "django/core" in fname
                or "site-packages" in fname
                or "dist-packages" in fname
            ):
                continue
            return {"file": fname, "line": fr.lineno, "func": fr.function}
    except Exception:
        pass
    return None


class DjangoNautMiddleware(MiddlewareMixin):
    def __init__(self, get_response):
        super().__init__(get_response)
        get_client().port = _get_port()

    def __call__(self, request):
        from django.db import connection

        queries = []
        client = get_client()
        project = _get_project()

        def wrapper(execute, sql, params, many, context):
            start = time.perf_counter()
            try:
                return execute(sql, params, many, context)
            finally:
                elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
                queries.append(
                    {
                        "sql": (sql or "")[:4000],
                        "time": elapsed_ms,
                        "stack": _capture_stack(),
                    }
                )

        try:
            with connection.execute_wrapper(wrapper):
                response = self.get_response(request)
        except Exception as exc:
            self._report_error(request, exc)
            raise

        if queries:
            path = getattr(request, "path", "")
            method = getattr(request, "method", "")
            view = None
            try:
                view = getattr(request, "resolver_match", None)
                if view:
                    view = getattr(view, "func", None)
                    view = getattr(view, "__name__", None) or getattr(view, "view_class", None).__name__
            except Exception:
                pass
            client.send(
                "sql",
                {
                    "project": project,
                    "path": path,
                    "method": method,
                    "view": view,
                    "queries": queries,
                    "totalQueries": len(queries),
                    "totalTime": round(sum(q["time"] for q in queries), 2),
                },
            )
        return response

    def _report_error(self, request, exc):
        tb = traceback.format_exc()
        frame = None
        for line in reversed(traceback.extract_tb(exc.__traceback__) or []):
            if "/django/" not in line.filename and "site-packages" not in line.filename:
                frame = {"file": line.filename, "line": line.lineno, "func": line.name}
                break
        get_client().send(
            "error",
            {
                "project": _get_project(),
                "path": getattr(request, "path", ""),
                "method": getattr(request, "method", ""),
                "exception": type(exc).__name__,
                "message": str(exc)[:2000],
                "traceback": tb[-20000:],
                "frame": frame,
            },
        )
