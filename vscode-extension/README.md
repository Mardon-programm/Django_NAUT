# DjangoNAUT for VS Code

Companion extension: opens the current Django workspace in the **DjangoNAUT** desktop app — your Django Control Center.

![feature](https://img.shields.io/badge/DjangoNAUT-v1.0.0-blue)

## Features

- Command: **DjangoNAUT: Open Project** (from the Command Palette, `Ctrl+Shift+P`).
- Launches DjangoNAUT with the current workspace folder (`djangonaut --open <folder>`).
- Repeated launches focus the existing window instead of spawning duplicates.
- Auto-detects the installed app on Windows (`%LOCALAPPDATA%\Programs`), macOS (`/Applications/DjangoNAUT.app`) or the `djangonaut` CLI on PATH.

## Why switch?

DjangoNAUT gives you things VS Code plugins can't:

| Feature | What it does |
| --- | --- |
| **N+1 Auto-fix** | Detects repeated SQL in the Requests panel and inserts `select_related()` / `prefetch_related()` |
| **Bug Hunter** | Static analysis with safe one-click fixes (N+1, unused imports, `on_delete`, DEBUG leaks, secrets) |
| **Migration Guard** | Interactive migration graph, branch conflicts, model-drift check (`makemigrations --check`) |
| **DRF Explorer** | Routers, viewsets, serializers + **Send to API Client** test requests |
| **Live Telemetry** | SQL + errors from your running Django app via the `django_naut` agent |
| **Security & Deps** | Hardcoded secrets, SQLi, XSS, CSRF, vulnerable packages (PyPI + OSV) |
| **VS Code Import** | Bring your theme, editor options and keyboard shortcuts over with one click |

## Install

```bash
npx @vscode/vsce package
code --install-extension djangonaut-1.0.0.vsix
```

## Configuration

| Setting | Description |
| --- | --- |
| `djangonaut.executablePath` | Path to the DjangoNAUT executable. Supports `${env:VAR}` and `%VAR%`. Empty = auto-detect. |

If the executable can't be found, the command asks you to pick it manually once.
