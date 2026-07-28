"""
Views for the web-based code editor.

Provides:
  - Main editor page
  - REST endpoints for file operations (read, write, list, delete, rename)
  - Project directory browsing
"""

import os
import json
import shutil
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
from django.shortcuts import render

from django.conf import settings


# ── Editor page ──────────────────────────────────────────────────────────────


def editor_view(request):
    """Render the main editor page."""
    return render(
        request,
        "editor/index.html",
        {
            "workspace": getattr(
                settings, "TERMINAL_WORKSPACE", os.path.expanduser("~")
            ),
        },
    )


# ── Helpers ──────────────────────────────────────────────────────────────────


def _safe_path(requested_path, workspace=None):
    """
    Resolve and validate a file path to prevent directory traversal attacks.
    Returns (resolved_path, error_response). If error_response is None, the path is safe.
    """
    workspace = workspace or getattr(
        settings, "TERMINAL_WORKSPACE", os.path.expanduser("~")
    )
    try:
        resolved = Path(requested_path).resolve()
        workspace_resolved = Path(workspace).resolve()
        # Allow paths within workspace or in system temp
        if not str(resolved).startswith(str(workspace_resolved)) and not str(
            resolved
        ).startswith(os.path.expanduser("~")):
            return None, JsonResponse(
                {"error": "Access denied: path outside workspace"}, status=403
            )
        return resolved, None
    except Exception as e:
        return None, JsonResponse({"error": f"Invalid path: {e}"}, status=400)


# ── File operations ──────────────────────────────────────────────────────────


@csrf_exempt
@require_http_methods(["POST"])
def api_read_file(request):
    """
    Read a file's contents.
    POST body: {"path": "/absolute/path/to/file.py"}
    Returns: {"path": "...", "content": "...", "size": N}
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    file_path = data.get("path", "")
    if not file_path:
        return JsonResponse({"error": "No path provided"}, status=400)

    resolved, err = _safe_path(file_path)
    if err:
        return err

    if not resolved.exists():
        return JsonResponse({"error": f"File not found: {resolved}"}, status=404)
    if resolved.is_dir():
        return JsonResponse({"error": "Path is a directory, not a file"}, status=400)

    try:
        content = resolved.read_text(encoding="utf-8", errors="replace")
        return JsonResponse(
            {
                "path": str(resolved),
                "content": content,
                "size": resolved.stat().st_size,
            }
        )
    except Exception as e:
        return JsonResponse({"error": f"Read error: {e}"}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def api_write_file(request):
    """
    Write content to a file (creates parent directories if needed).
    POST body: {"path": "/absolute/path/to/file.py", "content": "..."}
    Returns: {"success": true, "path": "...", "size": N}
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    file_path = data.get("path", "")
    content = data.get("content", "")

    if not file_path:
        return JsonResponse({"error": "No path provided"}, status=400)

    resolved, err = _safe_path(file_path)
    if err:
        return err

    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content, encoding="utf-8")
        return JsonResponse(
            {
                "success": True,
                "path": str(resolved),
                "size": resolved.stat().st_size,
            }
        )
    except Exception as e:
        return JsonResponse({"error": f"Write error: {e}"}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def api_list_dir(request):
    """
    List contents of a directory.
    POST body: {"path": "/absolute/path/to/dir"}
    Returns: {"path": "...", "items": [{"name": "...", "isDir": bool, "size": N}]}
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    dir_path = data.get("path", os.path.expanduser("~"))

    resolved, err = _safe_path(dir_path)
    if err:
        return err

    if not resolved.exists():
        return JsonResponse({"error": f"Directory not found: {resolved}"}, status=404)
    if not resolved.is_dir():
        return JsonResponse({"error": "Path is not a directory"}, status=400)

    IGNORE = {
        ".git",
        "node_modules",
        "__pycache__",
        ".venv",
        "venv",
        ".idea",
        ".vscode",
    }

    items = []
    try:
        for entry in sorted(
            resolved.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())
        ):
            if entry.name in IGNORE or entry.name.startswith("."):
                continue
            try:
                stat = entry.stat()
                items.append(
                    {
                        "name": entry.name,
                        "path": str(entry),
                        "isDir": entry.is_dir(),
                        "size": stat.st_size if entry.is_file() else 0,
                    }
                )
            except (PermissionError, OSError):
                continue
    except PermissionError:
        return JsonResponse({"error": "Permission denied"}, status=403)

    return JsonResponse({"path": str(resolved), "items": items})


@csrf_exempt
@require_http_methods(["POST"])
def api_delete(request):
    """
    Delete a file or directory.
    POST body: {"path": "/absolute/path"}
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    target = data.get("path", "")
    if not target:
        return JsonResponse({"error": "No path provided"}, status=400)

    resolved, err = _safe_path(target)
    if err:
        return err

    if not resolved.exists():
        return JsonResponse({"error": "Path not found"}, status=404)

    try:
        if resolved.is_dir():
            shutil.rmtree(resolved)
        else:
            resolved.unlink()
        return JsonResponse({"success": True, "path": str(resolved)})
    except Exception as e:
        return JsonResponse({"error": f"Delete error: {e}"}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def api_rename(request):
    """
    Rename/move a file or directory.
    POST body: {"oldPath": "...", "newPath": "..."}
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    old_path = data.get("oldPath", "")
    new_path = data.get("newPath", "")

    if not old_path or not new_path:
        return JsonResponse({"error": "Both oldPath and newPath required"}, status=400)

    resolved_old, err = _safe_path(old_path)
    if err:
        return err
    resolved_new, err = _safe_path(new_path)
    if err:
        return err

    try:
        resolved_old.rename(resolved_new)
        return JsonResponse({"success": True, "path": str(resolved_new)})
    except Exception as e:
        return JsonResponse({"error": f"Rename error: {e}"}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def api_create_file(request):
    """Create an empty file. POST body: {"path": "..."}"""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    file_path = data.get("path", "")
    resolved, err = _safe_path(file_path)
    if err:
        return err

    try:
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.touch()
        return JsonResponse({"success": True, "path": str(resolved)})
    except Exception as e:
        return JsonResponse({"error": f"Create error: {e}"}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def api_create_dir(request):
    """Create a directory. POST body: {"path": "..."}"""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    dir_path = data.get("path", "")
    resolved, err = _safe_path(dir_path)
    if err:
        return err

    try:
        resolved.mkdir(parents=True, exist_ok=True)
        return JsonResponse({"success": True, "path": str(resolved)})
    except Exception as e:
        return JsonResponse({"error": f"Create dir error: {e}"}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def api_search(request):
    """
    Search for text in project files.
    POST body: {"path": "/root", "query": "text", "matchCase": false, "isRegex": false}
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    root_path = data.get("path", os.path.expanduser("~"))
    query = data.get("query", "")
    match_case = data.get("matchCase", False)
    is_regex = data.get("isRegex", False)

    if not query:
        return JsonResponse({"error": "No query provided"}, status=400)

    resolved, err = _safe_path(root_path)
    if err:
        return err

    IGNORE = {
        "node_modules",
        ".git",
        "__pycache__",
        ".venv",
        "venv",
        "env",
        ".idea",
        "dist",
        "build",
    }
    TEXT_EXTS = {
        "py",
        "html",
        "htm",
        "css",
        "js",
        "json",
        "md",
        "txt",
        "xml",
        "yml",
        "yaml",
        "toml",
        "cfg",
        "ini",
        "sh",
    }
    MAX_RESULTS = 200

    try:
        if is_regex:
            import re

            regex = re.compile(query, 0 if match_case else re.IGNORECASE)
        else:
            import re

            pattern = re.escape(query)
            regex = re.compile(pattern, 0 if match_case else re.IGNORECASE)
    except re.error:
        return JsonResponse({"error": "Invalid regex pattern"}, status=400)

    results = []

    def walk(dir_path, depth):
        if depth > 10 or len(results) >= MAX_RESULTS:
            return
        try:
            for entry in dir_path.iterdir():
                if len(results) >= MAX_RESULTS:
                    return
                if entry.name in IGNORE or entry.name.startswith("."):
                    continue
                if entry.is_dir():
                    walk(entry, depth + 1)
                elif entry.suffix.lstrip(".").lower() in TEXT_EXTS:
                    try:
                        content = entry.read_text(encoding="utf-8", errors="replace")
                        lines = content.split("\n")
                        file_matches = []
                        for i, line in enumerate(lines):
                            if regex.search(line):
                                file_matches.append(
                                    {"line": i + 1, "text": line.strip()[:200]}
                                )
                                if len(file_matches) >= 10:
                                    break
                        if file_matches:
                            results.append(
                                {"file": str(entry), "matches": file_matches}
                            )
                    except (PermissionError, OSError):
                        continue
        except (PermissionError, OSError):
            return

    walk(resolved, 0)
    return JsonResponse({"results": results, "total": len(results)})


# ── AI Test Generator ───────────────────────────────────────────────────────


def _scan_django_project(root_path):
    """Scan a Django project to extract models, views, urls, serializers."""
    project_data = {
        "models": [],
        "views": [],
        "urls": [],
        "serializers": [],
        "forms": [],
        "files": {},
    }

    IGNORE = {
        "node_modules",
        ".git",
        "__pycache__",
        ".venv",
        "venv",
        "env",
        ".idea",
        ".vscode",
        "dist",
        "build",
        "migrations",
    }

    KEY_FILES = {
        "models.py",
        "views.py",
        "urls.py",
        "serializers.py",
        "forms.py",
        "admin.py",
    }

    def walk(dir_path, depth):
        if depth > 8:
            return
        try:
            for entry in dir_path.iterdir():
                if entry.name in IGNORE or entry.name.startswith("."):
                    continue
                if entry.is_dir():
                    walk(entry, depth + 1)
                elif entry.suffix == ".py" and entry.name in KEY_FILES:
                    try:
                        content = entry.read_text(encoding="utf-8", errors="replace")
                        rel = str(entry.relative_to(root_path))
                        project_data["files"][rel] = content
                        if entry.name == "models.py":
                            project_data["models"].append(rel)
                        elif entry.name == "views.py":
                            project_data["views"].append(rel)
                        elif entry.name == "urls.py":
                            project_data["urls"].append(rel)
                        elif entry.name == "serializers.py":
                            project_data["serializers"].append(rel)
                        elif entry.name == "forms.py":
                            project_data["forms"].append(rel)
                    except (PermissionError, OSError):
                        continue
        except (PermissionError, OSError):
            return

    walk(Path(root_path), 0)
    return project_data


def _build_test_prompt(project_data):
    """Build a GROQ prompt for generating Django tests."""
    sections = []

    for filepath, content in project_data["files"].items():
        truncated = content[:3000]
        sections.append(f"### {filepath}\n```python\n{truncated}\n```")

    file_list = "\n".join(sections)

    prompt = f"""You are an expert Django developer. Generate comprehensive pytest unit tests for this Django project.

Here is the project structure and source code:

{file_list}

Generate tests that cover:
1. Model tests (field defaults, constraints, __str__, methods, relationships)
2. View tests (HTTP methods, status codes, authentication, permissions)
3. URL tests (reverse resolution, URL matching)
4. Serializer tests (validation, field coverage) if DRF is used
5. Form tests (validation, clean methods) if forms exist

Rules:
- Use pytest and pytest-django
- Use Django's TestCase or pytest fixtures
- Use reverse() for URL resolution
- Test both success and error cases
- Include at least one test per model, view, and URL pattern
- Use factories or setUp() for test data
- Output ONLY Python code, no explanations
- Group tests by app/module
- Include proper imports

Output format:
```python
# tests/test_<module>.py
import pytest
from django.test import TestCase, Client
from django.urls import reverse
# ... imports based on what's needed

# ... test classes and functions
```"""

    return prompt


@csrf_exempt
@require_http_methods(["POST"])
def api_ai_generate_tests(request):
    """
    Generate Django tests using GROQ AI.
    POST body: {"path": "/project/root"}
    Returns: {"tests": "...", "files_scanned": [...]}
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    project_path = data.get("path", "")
    if not project_path:
        return JsonResponse({"error": "No path provided"}, status=400)

    resolved, err = _safe_path(project_path)
    if err:
        return err

    if not resolved.exists():
        return JsonResponse({"error": "Path not found"}, status=404)

    # Scan project
    project_data = _scan_django_project(resolved)
    if not project_data["files"]:
        return JsonResponse({"error": "No Django files found in project"}, status=400)

    # Get GROQ API key
    api_key = getattr(settings, "GROQ_API_KEY", "")
    if not api_key:
        return JsonResponse(
            {
                "error": "GROQ API key not configured. Set GROQ_API_KEY environment variable."
            },
            status=500,
        )

    api_url = getattr(
        settings, "GROQ_API_URL", "https://api.groq.com/openai/v1/chat/completions"
    )
    model = getattr(settings, "GROQ_MODEL", "llama-3.3-70b-versatile")

    prompt = _build_test_prompt(project_data)

    # Call GROQ API
    payload = json.dumps(
        {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are an expert Django developer generating pytest tests. Output only Python code.",
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 8000,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        api_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            tests = result["choices"][0]["message"]["content"]
            return JsonResponse(
                {
                    "tests": tests,
                    "files_scanned": list(project_data["files"].keys()),
                    "model": model,
                }
            )
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return JsonResponse({"error": f"GROQ API error ({e.code}): {body}"}, status=502)
    except urllib.error.URLError as e:
        return JsonResponse({"error": f"Network error: {e.reason}"}, status=502)
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        return JsonResponse({"error": f"Invalid GROQ response: {e}"}, status=502)
    except Exception as e:
        return JsonResponse({"error": f"Unexpected error: {e}"}, status=500)


# ── Docker endpoints ─────────────────────────────────────────────────────────


@csrf_exempt
@require_http_methods(["POST"])
def api_docker_logs(request):
    """Get Docker container logs."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    container_id = data.get("container_id", "")
    tail = data.get("tail", 100)

    if not container_id:
        return JsonResponse({"error": "No container_id provided"}, status=400)

    # Sanitize container_id to prevent injection
    if not all(c.isalnum() or c in "-_." for c in container_id):
        return JsonResponse({"error": "Invalid container ID"}, status=400)

    try:
        result = subprocess.run(
            ["docker", "logs", "--tail", str(tail), container_id],
            capture_output=True,
            text=True,
            timeout=10,
        )
        logs = result.stdout or result.stderr or ""
        return JsonResponse({"logs": logs, "error": None})
    except FileNotFoundError:
        return JsonResponse({"error": "Docker not found in PATH"}, status=500)
    except subprocess.TimeoutExpired:
        return JsonResponse({"error": "Docker command timed out"}, status=500)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def api_docker_status(request):
    """Get Docker container status."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    container_id = data.get("container_id", "")
    if not container_id:
        return JsonResponse({"error": "No container_id provided"}, status=400)

    if not all(c.isalnum() or c in "-_." for c in container_id):
        return JsonResponse({"error": "Invalid container ID"}, status=400)

    try:
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Status}}", container_id],
            capture_output=True,
            text=True,
            timeout=5,
        )
        status = result.stdout.strip() if result.returncode == 0 else "unknown"
        return JsonResponse({"status": status, "error": None})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# ── HTTP Client proxy ────────────────────────────────────────────────────────


@csrf_exempt
@require_http_methods(["POST"])
def api_http_proxy(request):
    """
    Proxy HTTP requests to avoid CORS issues.
    POST body: {"method": "GET", "url": "...", "headers": {...}, "body": "..."}
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    method = data.get("method", "GET").upper()
    url = data.get("url", "")
    headers = data.get("headers", {})
    body = data.get("body", None)

    if not url:
        return JsonResponse({"error": "No URL provided"}, status=400)

    try:
        req_body = (
            json.dumps(body).encode("utf-8")
            if body and method in ("POST", "PUT", "PATCH")
            else None
        )

        req = urllib.request.Request(
            url,
            data=req_body,
            headers=headers,
            method=method,
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_body = resp.read().decode("utf-8", errors="replace")
            resp_headers = dict(resp.headers)
            return JsonResponse(
                {
                    "status": resp.status,
                    "headers": resp_headers,
                    "body": resp_body,
                }
            )
    except urllib.error.HTTPError as e:
        resp_body = e.read().decode("utf-8", errors="replace")
        return JsonResponse(
            {
                "status": e.code,
                "headers": dict(e.headers),
                "body": resp_body,
                "error": f"HTTP {e.code}",
            }
        )
    except urllib.error.URLError as e:
        return JsonResponse({"error": f"Network error: {e.reason}"}, status=502)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
