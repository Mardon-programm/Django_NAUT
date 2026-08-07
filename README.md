# DjangoNAUT

Полноценная среда разработки (IDE) для Django на базе Electron: терминал, AI-ассистент, SQL-телеметрия в реальном времени, деплой и набор инспекторов Django-проекта в одном окне. Плюс **CLI `djangonaut audit`** и **GitHub Action** для аудита Django-проектов в CI.

![DjangoNAUT](logo.png)

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
| **DRF** | Роутеры, viewsets, serializers, permission/pagination |
| **Migration Guard** | Граф миграций, конфликты веток, автопочинка; проверка дрейфа моделей (`makemigrations --check`) |

### Отладка и производительность

| Панель | Что делает |
| --- | --- |
| **Requests** | SQL-телеметрия каждого запроса: время, стек вызова, **детекция N+1** с подсказками `select_related()` / `prefetch_related()` |
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

Те же анализаторы, что в IDE, но из терминала — удобно для локальных проверок и CI.

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

## Тесты

```bash
npm test   # 34/34 PASS: синтаксис, Bug Hunter, CLI, миграции, N+1, python-agent, wiring, electron-smoke
```

## Сборка

- **Linux / macOS** — см. [BUILD.md](BUILD.md)
- **Windows**: `npm run build` (NSIS-инсталлятор + portable)

## Лицензия

MIT
