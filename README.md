# DjangoNAUT

> **Django Control Center** — дополнение к вашему редактору, а не замена привычкам. Открыли — увидели карту моделей, эндпоинтов, live SQL-запросы, поймали N+1 и исправили его одной кнопкой.

Полноценная среда разработки для Django на базе Electron: SQL-телеметрия в реальном времени с детекцией N+1 и **автофиксом**, 35+ инспекторов проекта, AI-ассистент, Enterprise-аудит со стоимостью техдолга. Плюс **CLI `djangonaut audit`** и **GitHub Action** — статический аудит в CI.

![DjangoNAUT](logo.png)

## Quick Start (30 секунд)

```bash
# 1. Статический аудит — без GUI и без серверов, просто сканер
npx djangonaut audit . --json          # или npm install -g djangonaut

# 2. SQL-телеметрия в реальном времени (опционально, в свой Django-проект)
pip install django-naut-agent
#   добавить "django_naut" в INSTALLED_APPS и запустить: python manage.py runserver_naut

# 3. Открыть десктопный Command Center
npm install && npm start               # или готовый установщик
```

За 5 секунд вы видите: карту моделей и эндпоинтов, живой терминал, каждый SQL-запрос со стеком вызова и N+1-детектор с кнопкой **Auto-fix**, которая сама впишет `select_related()` в нужный `views.py`.

## Security & Privacy

- **Всё локально.** И анализ, и телеметрия происходят на вашем компьютере. Никакие данные проекта не отправляются на серверы DjangoNAUT.
- **Локальные серверы — только loopback.** Встроенные `terminal-server`, `log-server` и `telemetry-server` слушают исключительно `127.0.0.1` (смотрите исходники: `terminal-server.js:99`, `log-server.js:173`, `telemetry-server.js:28`). Снаружи они недоступны.
- **CLI — вообще без серверов.** `djangonaut audit` — чистый статический сканер (Node), который ничего не слушает и ничего не отправляет. Можно запускать в CI.
- **Проверка зависимостей уходит в PyPI/OSV** — это единственные внешние запросы, и только когда вы сами запустили аудит (отключается флагом `--no-deps`).
- **AI-ассистент** отправляет запросы к провайдеру (GROQ/OpenAI) **только** если вы указали собственный API-ключ. Без ключа — ничего не уходит.
- **Код открыт (MIT).** Любой может проверить, что делает приложение.

## Возможности

### Инспекторы Django-проекта

| Панель | Что делает |
| --- | --- |
| **Django** | Сводка по проекту: приложения, версия, настройки |
| **URLs** | Таблица маршрутов с view-функциями и переходами по клику |
| **ORM Models** | Модели, поля, связки, методы; просмотр данных |
| **DB Explorer** | Подключения и таблицы выбранной БД |
| **Templates** | Дерево шаблонов, наследование, block/extends |
| **Forms** | Формы, поля, виджеты, валидаторы |
| **Static** | Статические файлы по приложениям |
| **ASGI** | ASGI-приложение, роутинг, middleware-цепочка |
| **Settings & Env** | Настройки и `.env`; корректно различает `DEBUG = True` и env-переменные |
| **Commands** | Management-команды с help, флагами `requires_system_checks`, `requires_migrations_checks` |
| **Middleware** | Pipeline request→response, хуки, async-детекция |
| **i18n** | Здоровье `.po`-каталогов, untranslated/fuzzy/obsolete, usage в шаблонах и коде, missing-строки |
| **Admin** | Зарегистрированные ModelAdmin, опции, inlines, незарегистрированные админки |
| **DRF** | Роутеры, viewsets, serializers, permission/pagination; **Send to API Client** — тестовые CRUD-эндпоинты под каждый роутер без Postman |
| **Migration Guard** | Граф миграций, конфликты веток, автопочинка; проверка дрейфа моделей (`makemigrations --check`) |

### Отладка и производительность

| Панель | Что делает |
| --- | --- |
| **Requests** | SQL-телеметрия каждого запроса: время, стек вызова, **детекция N+1** с кнопкой **Auto-fix** — вставляет `select_related()` / `prefetch_related()` в queryset |
| **Profiler** | Медленные запросы, сводки по времени |
| **Logs** | Лог-сервер приложения |
| **Cache** | Состояние кэша |
| **Mail** | Перехват исходящих писем |
| **Bug Hunter** | Статический анализ на баги с безопасными автофиксами: N+1, неиспользуемые импорты, `on_delete`, секреты, DEBUG |
| **Tests** | Запуск тестов и просмотр результатов |
| **Security** | Поиск уязвимостей: hardcoded секреты, SQL-инъекции, XSS, CSRF |
| **Deps** | Устаревшие/уязвимые зависимости (PyPI + OSV) |
| **Tasks** | Celery-задачи и их вызовы |
| **Signals** | Приёмники сигналов, модели с побочными эффектами |

### Аудит проекта

| Панель | Что делает |
| --- | --- |
| **Enterprise / Audit Report** | Health score, стоимость апгрейда (часы/дни), риск зависимостей; экспорт отчёта в markdown/HTML/PDF |

### Инструменты разработчика

- **Терминал** — PTY встроенным в IDE
- **AI-ассистент** — анализ проекта, архитектор, память, баг-хант, генерация тестов и мок-данных
- **API Client** — отправка HTTP-запросов
- **Docker** — управление контейнерами
- **Deploy** — публикация проекта
- **Search** — поиск по коду и проекту

## Установка и запуск

Требования: Node.js 18+, Python 3.9+.

```bash
git clone https://github.com/Mardon-programm/Django_NAUT.git
cd Django_NAUT
npm install
npm start
```

### Python-агент

Для SQL-телеметрии, перехвата ошибок и shell-режима установите агент в свой Django-проект:

```bash
pip install -e ./python-agent   # из корня этого репозитория
```

Затем добавьте `"django_naut"` в `INSTALLED_APPS` и запускайте dev-сервер через:

```bash
python manage.py runserver_naut --naut-port 9999
```

Миддлварь `django_naut.middleware.DjangoNautMiddleware` собирает каждый SQL-запрос со стеком вызова и отправляет телеметрию в IDE. Можно добавить миддлю вручную в `MIDDLEWARE` и указать `DJANGONAUT_PORT` в `settings.py`.

## CLI: `djangonaut audit`

Те же анализаторы, что в IDE, но из терминала — без GUI и без локальных серверов. Удобно для локальных проверок и CI.

```bash
npm install -g djangonaut
djangonaut audit [folder] [options]
```

| Флаг | Описание |
| --- | --- |
| `--json` | Вывести полный отчёт в JSON (`summary`, `issues`, `security`, `deps`, `report`) |
| `--fail-on=<level>` | Порог падения: `critical`, `error` (по умолчанию), `warning`, `performance`, `info`, `none` (никогда не падать) |
| `--min-severity=<level>` | Показывать только находки уровня не ниже указанного (человекочитаемый вывод) |
| `--no-deps` | Не проверять зависимости (не требует сети) |
| `--output=<path>` | Сохранить JSON-отчёт в файл |
| `--markdown=<path>` | Сохранить markdown-отчёт в файл |
| `--help`, `--version` | Справка и версия |

Exit-коды: `0` — замечаний выше порога нет, `1` — есть, `2` — фатальная ошибка (не Django-проект или битые аргументы).

## GitHub Action

Готовый reusable workflow для проверки Django-проекта на каждый push. Подключите в своём репозитории:

```yaml
name: DjangoNAUT Audit
on: push
jobs:
  audit:
    uses: Mardon-programm/Django_NAUT/.github/workflows/djangonaut-audit.yml@main
    with:
      project-path: .
      fail-on: error
```

Параметры: `project-path`, `fail-on`, `min-severity`, `no-deps`, `node-version`, `json-report`, `markdown-report`, `cli-source`. Билд падает, если найдены проблемы выше порога; JSON и markdown-отчёты выкладываются артефактом.

## Переход из VS Code

DjangoNAUT снижает стоимость перехода в четыре шага:

1. **Импорт настроек** — Settings → «Import from VS Code…»: тянет тему (Dark+/Monokai/Dracula/…), шрифт, tab size, word wrap, minimap и горячие клавиши (`keybindings.json`) из пользовательских настроек и `.vscode/` проекта. Ничего не меняется без подтверждения.
2. **First-run onboarding** — при первом запуске: welcome-экран с фичами, а после открытия проекта — автоматический прогон Bug Hunter с тостом «Found N issues».
3. **Companion-расширение** (`vscode-extension/`) — команда «DjangoNAUT: Open Project» запускает приложение с текущей папкой (`--open <folder>`); повторный запуск фокусирует существующее окно. Сборка: `npx @vscode/vsce package`.
4. **Editor-паритет** — Ctrl+D (add selection to next match), мультикурсор, Ctrl+/, Alt+↑/↓ работают как в VS Code; **Emmet-lite** (Ctrl+E: `div#app>span*3` → разметка), **Format on Save** (black → autopep8 → yapf) и **Format Document** (Shift+Alt+F).

## Тесты

```bash
npm test   # 65/65 PASS: синтаксис, Bug Hunter, CLI, миграции, N+1 (в т.ч. автофикс), python-agent, wiring, VS Code import, Emmet, formatting
```

## Сборка

- **Linux / macOS** — см. [BUILD.md](BUILD.md)
- **Windows**: `npm run build` (NSIS-инсталлятор + portable)

## Лицензия

MIT
