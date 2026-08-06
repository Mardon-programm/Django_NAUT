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
        request_start = time.perf_counter()

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
            status = getattr(response, "status_code", 200)
        except Exception as exc:
            status = 500
            self._report_error(request, exc)
            raise
        finally:
            request_time = round((time.perf_counter() - request_start) * 1000, 2)
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
            user = "anon"
            try:
                req_user = getattr(request, "user", None)
                if req_user is not None and getattr(req_user, "is_authenticated", False):
                    user = req_user.get_username() if hasattr(req_user, "get_username") else str(req_user)
            except Exception:
                pass
            client.send(
                "sql",
                {
                    "project": project,
                    "path": path,
                    "method": method,
                    "view": view,
                    "status": status,
                    "user": user,
                    "queries": queries,
                    "totalQueries": len(queries),
                    "requestTime": request_time,
                    "totalTime": round(sum(q["time"] for q in queries), 2),
                },
            )
        return response

    def process_exception(self, request, exception):
        """Report unhandled exceptions.

        Modern Django wraps each middleware in `convert_exception_to_response`,
        so exceptions never propagate through our ``__call__``; they are turned
        into 500 responses by the handler. `process_exception` is invoked while
        the exception is still live, so we can report it here instead.
        """
        self._report_error(request, exception)
        return None

    def _report_error(self, request, exc):
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
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
