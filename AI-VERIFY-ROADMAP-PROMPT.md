# Промпт для ИИ: роадмап проверки работоспособности DjangoNAUT

Скопируйте текст ниже целиком в любую LLM. Это самодостаточный промпт: он содержит полный инвентарь
проекта и задаёт формат результата — пошаговый роадмап проверки, что весь функционал работает.

---

## Роль

Ты — senior QA-архитектор и тимлид. Составь детальный, выполнимый роадмап проверки работоспособности
проекта **DjangoNAUT (Django Control Center)** — Electron-IDE для Django. Цель: гарантированно убедиться,
что ВЕСЬ функционал работает, а найденные баги зафиксированы, локализованы и приоритизированы для фикса.

## Контекст проекта

- **Стек**: Electron + vanilla JS (renderer.js, preload.js, main.js), Monaco Editor (vendored, без CDN),
  xterm.js терминал, Node 18+, Python 3.9+ (python-agent), WebSocket-серверы (telemetry/log/terminal),
  локально только на `127.0.0.1`.
- **Структура**: `main.js` (electron-main, 89 IPC-хендлеров), `preload.js` (contextBridge API),
  `renderer.js` (~7900 строк, вся UI-логика в одном IIFE), `django-scanner.js` + `*-inspector.js`
  (Python-сканеры через отдельные процессы), `bughunter.js` (статический анализ + автофиксы),
  `security-scanner.js`, `deps-updater.js` (PyPI+OSV), `migration-guard.js`, `migration-graph.js`,
  `report-generator.js`, `vscode-import.js`, `emmet-lite.js`, `python-format.js`, `cli.js`,
  `python-agent/` (Django middleware + runserver_naut), `web_editor/` (демо Django-проект для проверки).
- **CLI**: `djangonaut audit [folder] [--json] [--fail-on=<level>] [--min-severity] [--no-deps]
  [--output=<path>] [--markdown=<path>]`; exit-коды 0/1/2.
- **GitHub Action**: reusable workflow `.github/workflows/djangonaut-audit.yml@main`.
- **Сборка**: Windows NSIS-инсталлятор + portable (`npm run build`); Linux/macOS — см. BUILD.md.

## Текущее состояние (baseline)

- `npm test` — 65/65 PASS. Покрыто: N+1-детектор и автофикс (в т.ч. list comprehension), Bug Hunter
  (unused imports, on_delete, secrets, DEBUG, N+1), CLI-флаги и exit-коды, парсер дрейфа миграций,
  python-agent (middleware-редирект секретов), wiring (каждый IPC-канал из preload есть в main),
  package files, VS Code import, Emmet-lite, python-format, DRF endpoint derivation, manifest расширения.
- `npm run test:smoke` — app живёт 20с без фатальных ошибок (запускает electron, terminal/log WS).
- Приложение запускается: `npm start`.

НЕ покрыто автотестами (проверять вручную/полуавтоматически): вся UI-логика панелей, эндпоинты,
интеграция с реальным Django-проектом, python-agent E2E (runserver_naut + телеметрия SQL),
Docker-управление, HTTP/API Client, Deploy, PDF-отчёты, маил-инспектор, Celery/Signals/Тесты на живом
проекте, DB/Cache-инспекторы, git-интеграция, AI-функции (нужен GROQ-ключ), VS Code расширение на живом VS Code.

## Полный инвентарь функционала для проверки

### 34 панели IDE
Explorer (дерево файлов, watcher, git-статус), Quick Actions, Search (по коду), Deploy,
Django (сводка/скан), ORM Models, URL Inspector, Templates, Forms, Static Files, ASGI/Routing,
Settings & Env, i18n, Admin Site, DRF Explorer (рётеры/viewsets/serializers + Send to API Client),
Manage Commands, Middleware, Requests (SQL-телеметрия + N+1 + автофикс), Mail Inspector,
Bug Hunter (анализ + автофиксы), Security Scanner, Test Runner, Profiler, Dependencies,
Migrations (Migration Guard: граф/конфликты/дрейф/автопочинка), Celery Tasks, Signals Tracer,
Cache Inspector, Database Inspector, Audit Report (health score/стоимость/экспорт MD/HTML/PDF),
Live Logs, Docker, API Client, Test Generator (AI), Copilot (AI, Ctrl+Shift+A).

### 89 IPC-каналов (группы)
dialog (openFolder/saveFile), fs (readdir/readfile/binary/write/rename/delete/mkdir/mkfile/search),
vscode (collect/build — импорт из VS Code), app (onOpenFolder, single-instance, `--open <folder>`),
process/terminal (spawn, PTY), logs, mail, system, git, watcher, django (scan/bughunt/cmd),
bug:applyFix, ai (analyze/architect/memory/bughunt/gentests/mockdata), docker (7),
http:request, deploy:check, telemetry:getState, agent (path/check), migration (scan/graph/drift/fix),
signals, celery (scan/run), shell (exec/ping/close), deps, security, emmet:expand, editor:format,
report (generate/save/pdf), cache (inspect/delete/clear), db (databases/tables/describe/preview/query),
urls, orm, cfg, tpl, forms, static, asgi, commands, middleware, i18n, admin, drf, test (scan/run).

### Прочие функции
- **First-run onboarding**: welcome-экран, автозапуск Bug Hunter после первого открытия проекта.
- **VS Code import**: Settings → Import from VS Code (тема/шрифт/hotkeys из settings.json+keybindings.json).
- **Editor**: Monaco, темы (7), CodeLens (SQL/signals), Django-автокомплит (~40 сниппетов),
  Emmet-lite (Ctrl+E), Format on Save + Format Document (Shift+Alt+F, black→autopep8→yapf),
  хоткеи с кастомизацией, autosave, мультикурсор (нативно), quick open (Ctrl+P), command palette.
- **python-agent**: middleware DjangoNautMiddleware (SQL+ошибки), `runserver_naut --naut-port`,
  shell-режим, redact секретов.
- **VS Code companion-расширение** `vscode-extension/`: команда «Open Project in DjangoNAUT».
- **Onboarding/привлечение**: welcome-экран, README Quick Start, CLI-аудит, GitHub Action.

## Что ты должен сделать

1. Составь пошаговый роадмап проверки, разбитый на фазы с приоритетами (P0 = критично для релиза,
   P1 = важно, P2 = желательно). Порядок: сначала — быстрые автоматические проверки и smoke,
   затем — функциональные области по группам, затем — интеграционные/E2E, затем — нагрузка/границы.
2. Для КАЖДОЙ функциональной области укажи: (а) шаги проверки (максимально конкретно, с командами,
   действиями в UI, ожидаемыми результатами), (б) признак «работает» (acceptance criteria),
   (в) что именно проверить на тестовом Django-проекте `web_editor/`, (г) как локализовать баг
   (файл:строка, IPC-канал, лог).
3. Составь чек-лист для ручной E2E-проверки на живом Django-проекте: установка агента,
   `runserver_naut`, Requests/N+1-фикс, DRF Send, миграции/дрейф, Bug Hunter автофиксы, отчёты.
4. Укажи, как автоматизировать каждую ручную проверку (что добавить в `tests/`, какие модульные тесты).
5. Оцени трудозатраты (часы) на каждую фазу и суммарно.

## Формат результата

Markdown, на русском. Секции:
- **Сводка** (1 абзац + таблица фаз).
- **Фазы** (каждая: цель, шаги, acceptance criteria, баг-репорт шаблон, часы).
- **Чек-лист ручной E2E** (таблица: действие → ожидаемый результат).
- **Карта автоматизации** (таблица: что автоматизировать, в какой тест-файл).
- **Риски и известные слабые места** (что чаще всего ломается и почему).

Не выдумывай команды и пути, которых нет в проекте. Если не хватает информации — укажи в «Открытых вопросах».
