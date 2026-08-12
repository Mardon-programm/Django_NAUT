"""DjangoNAUT middleware: Live SQL telemetry + Error Interceptor.

Captures every SQL query executed during a request (with the caller
file:line stack) and any unhandled exception, then pushes both to the
DjangoNAUT IDE over HTTP.

Enabled automatically by `runserver_naut`; can also be added manually to
MIDDLEWARE in settings.py.
"""

import contextvars
import functools
import inspect
import json
import re
import time
import traceback

from django.conf import settings
from django.utils.deprecation import MiddlewareMixin

from django_naut.telemetry import get_client

# Queries run on the thread-local connection of whichever thread executes them
# (Django stores connections in ``threading.local``). Under ASGI a sync view
# runs in a worker thread with its OWN connection, so a plain
# ``connection.execute_wrapper()`` set from the middleware thread never sees
# those queries. Instead we register request-scoped wrappers in a contextvar
# (asgiref's ``sync_to_async`` copies contextvars into worker threads) and
# patch ``CursorWrapper`` once so every query — on any thread/connection —
# consults that contextvar.
_NAUT_WRAPPERS: "contextvars.ContextVar[list]" = contextvars.ContextVar(
    "naut_wrappers", default=[]
)

_CURSOR_PATCHED = False


def _patch_cursor_execution():
    """Install a global CursorWrapper hook that also applies contextvar wrappers."""
    global _CURSOR_PATCHED
    if _CURSOR_PATCHED:
        return
    import django.db.backends.utils as django_utils

    original = django_utils.CursorWrapper._execute_with_wrappers

    def _execute_with_wrappers(self, sql, params, many, executor):
        context = {"connection": self.db, "cursor": self}
        wrappers = list(_NAUT_WRAPPERS.get()) + list(self.db.execute_wrappers)
        for wrapper in reversed(wrappers):
            executor = functools.partial(wrapper, executor)
        return executor(sql, params, many, context)

    django_utils.CursorWrapper._execute_with_wrappers = _execute_with_wrappers
    _CURSOR_PATCHED = True

# Intentionally excluded: cookies and auth headers carry session tokens and
# credentials — they are never captured. Keep the list to non-sensitive meta.
_REQUEST_HEADERS = (
    ("HTTP_HOST", "Host"),
    ("HTTP_USER_AGENT", "User-Agent"),
    ("HTTP_ACCEPT", "Accept"),
    ("HTTP_ACCEPT_LANGUAGE", "Accept-Language"),
    ("HTTP_ACCEPT_ENCODING", "Accept-Encoding"),
    ("HTTP_REFERER", "Referer"),
    ("HTTP_ORIGIN", "Origin"),
    ("CONTENT_TYPE", "Content-Type"),
    ("HTTP_X_REQUESTED_WITH", "X-Requested-With"),
)

_BODY_CAPTURE_LIMIT = 64 * 1024  # bodies up to this size get JSON parsing
_BODY_SEND_LIMIT = 16 * 1024     # only this slice is sent to the IDE

_SENSITIVE_SUBSTRINGS = (
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "authorization",
    "auth",
    "cookie",
    "session",
    "csrf",
    "credit",
    "card",
    "cvv",
    "private_key",
    "access_key",
)

_BODY_JSON_SECRET = re.compile(
    r'(?i)("(?:[^"\\]*(?:password|passwd|token|secret|apikey|api_key|authorization|sessionid|csrf)[^"\\]*)"\s*:\s*)"[^"]*"'
)
_BODY_FORM_SECRET = re.compile(
    r"(?i)((?:^|[;&])(?:[a-z0-9_.-]*(?:password|passwd|token|secret|apikey|api_key|authorization|sessionid|csrf)[a-z0-9_.-]*)=)[^&;\r\n]*"
)


def _looks_sensitive(key):
    k = str(key).lower().replace("-", "").replace("_", "")
    return any(s in k for s in _SENSITIVE_SUBSTRINGS)


def _redact(data):
    if isinstance(data, dict):
        return {
            key: ("***" if _looks_sensitive(key) else _redact(value))
            for key, value in data.items()
        }
    if isinstance(data, list):
        return [_redact(item) for item in data]
    return data


def _redact_body(body):
    """Redact obvious secret fields from raw body text (JSON/form patterns)."""
    if not body:
        return body
    try:
        body = _BODY_JSON_SECRET.sub(r'\1"***"', body)
        body = _BODY_FORM_SECRET.sub(r"\1***", body)
    except Exception:
        pass
    return body


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


_RESPONSE_HEADERS = (
    "Content-Type",
    "Content-Length",
    "Location",
    "Cache-Control",
    "X-Frame-Options",
    "Server",
)

_RESPONSE_BODY_LIMIT = 16 * 1024


def _flat_params(qdict):
    """QueryDict → plain dict, collapsing single-value lists to scalars."""
    out = {}
    try:
        for key, values in qdict.lists():
            out[key] = values[0] if len(values) == 1 else values
    except Exception:
        try:
            out = dict(qdict)
        except Exception:
            pass
    return out


def _capture_request(request):
    """Snapshot request headers / params / body without breaking the view.

    Non-multipart bodies are read once (Django caches them, so the view still
    sees the full body). Multipart uploads are skipped — reading them would
    consume the file stream — and only their content type/size is noted.
    """
    info = {}
    method = (getattr(request, "method", "") or "").upper()
    ctype = request.META.get("CONTENT_TYPE", "") or ""

    headers = {}
    for meta_key, name in _REQUEST_HEADERS:
        value = request.META.get(meta_key)
        if value:
            headers[name] = value
    if headers:
        info["headers"] = headers

    if method in ("GET", "HEAD"):
        params = _flat_params(getattr(request, "GET", None))
        if params:
            info["params"] = _redact(params)
        return info

    if method in ("POST", "PUT", "PATCH", "DELETE"):
        if ctype:
            info["contentType"] = ctype
        if "multipart/" in ctype:
            info["multipart"] = True
            try:
                info["bodySize"] = int(request.META.get("CONTENT_LENGTH") or 0)
            except (TypeError, ValueError):
                pass
            return info
        try:
            body = request.body
        except Exception:
            return info
        size = len(body)
        info["bodySize"] = size
        if not size:
            return info
        if size > _BODY_SEND_LIMIT:
            info["truncated"] = True
        info["body"] = _redact_body(body[:_BODY_SEND_LIMIT].decode("utf-8", "replace"))
        if "application/json" in ctype and size <= _BODY_CAPTURE_LIMIT:
            try:
                info["json"] = _redact(json.loads(body.decode("utf-8", "replace")))
            except Exception:
                pass
        if "application/x-www-form-urlencoded" in ctype or not ctype:
            params = _flat_params(getattr(request, "POST", None))
            if params:
                info["params"] = _redact(params)
        return info

    return info


def _capture_response(response):
    """Snapshot a small subset of response headers + body for the inspector.

    Only fully-buffered responses are read (streaming / file responses are
    skipped so we never consume their stream). Bodies are sliced at
    ``_RESPONSE_BODY_LIMIT``.
    """
    info = {}
    if response is None:
        return info
    headers = getattr(response, "headers", None)
    if headers is None:
        return info
    for name in _RESPONSE_HEADERS:
        try:
            value = headers.get(name)
        except Exception:
            value = None
        if value:
            info[name] = value
    if getattr(response, "is_redirect", False):
        info["isRedirect"] = True
    try:
        from django.http.response import StreamingHttpResponse

        if isinstance(response, StreamingHttpResponse):
            return info
    except Exception:
        return info
    try:
        content = getattr(response, "content", None)
        if content is not None:
            size = len(content)
            info["bodySize"] = size
            if size > _RESPONSE_BODY_LIMIT:
                info["truncated"] = True
            if size:
                info["body"] = content[:_RESPONSE_BODY_LIMIT].decode("utf-8", "replace")
    except Exception:
        pass
    return info


def _make_query_wrapper(queries):
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

    return wrapper


class DjangoNautMiddleware(MiddlewareMixin):
    def __init__(self, get_response):
        super().__init__(get_response)
        get_client().port = _get_port()

    def __call__(self, request):
        # MiddlewareMixin switches to async mode when the handler is a
        # coroutine function (ASGI/daphne projects, which Django 5 runserver
        # auto-detects): in that mode we must return a coroutine the framework
        # awaits, not treat it as the response.
        if self.async_mode:
            return self._async_run(request)
        return self._sync_run(request)

    def _sync_run(self, request):
        _patch_cursor_execution()

        queries = []
        client = get_client()
        project = _get_project()
        request_start = time.perf_counter()
        try:
            request_info = _capture_request(request)
        except Exception:
            request_info = None
        response_info = {}
        response = None
        status = None
        token = _NAUT_WRAPPERS.set([_make_query_wrapper(queries)])
        try:
            response = self.get_response(request)
            status = getattr(response, "status_code", 200)
            response_info = _capture_response(response)
        except Exception as exc:
            status = 500
            self._report_error(request, exc)
            raise
        finally:
            _NAUT_WRAPPERS.reset(token)
            self._report_sql(
                request,
                client,
                project,
                queries,
                request_start,
                request_info,
                response_info,
                status,
            )
        return response

    async def _async_run(self, request):
        _patch_cursor_execution()

        queries = []
        client = get_client()
        project = _get_project()
        request_start = time.perf_counter()
        try:
            request_info = _capture_request(request)
        except Exception:
            request_info = None
        response_info = {}
        response = None
        status = None
        token = _NAUT_WRAPPERS.set([_make_query_wrapper(queries)])
        try:
            response = await self.get_response(request)
            status = getattr(response, "status_code", 200)
            response_info = _capture_response(response)
        except Exception as exc:
            status = 500
            self._report_error(request, exc)
            raise
        finally:
            _NAUT_WRAPPERS.reset(token)
            self._report_sql(
                request,
                client,
                project,
                queries,
                request_start,
                request_info,
                response_info,
                status,
            )
        return response

    def _report_sql(
        self,
        request,
        client,
        project,
        queries,
        request_start,
        request_info,
        response_info,
        status,
    ):
        request_time = round((time.perf_counter() - request_start) * 1000, 2)
        path = getattr(request, "path", "")
        method = getattr(request, "method", "")
        view = None
        try:
            view = getattr(request, "resolver_match", None)
            if view:
                view = getattr(view, "func", None)
                view = getattr(view, "__name__", None) or getattr(
                    view, "view_class", None
                ).__name__
        except Exception:
            pass
        user = "anon"
        try:
            req_user = getattr(request, "user", None)
            if req_user is not None and getattr(req_user, "is_authenticated", False):
                user = (
                    req_user.get_username()
                    if hasattr(req_user, "get_username")
                    else str(req_user)
                )
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
                "requestInfo": request_info,
                "responseInfo": response_info,
            },
        )

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
        try:
            request_info = _capture_request(request)
        except Exception:
            request_info = None
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
                "requestInfo": request_info,
            },
        )
