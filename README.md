# DjangoNAUT

Полноценная среда разработки (IDE) для Django на базе Electron: терминал, AI-ассистент, SQL-телеметрия в реальном времени, деплой и набор инспекторов Django-проекта в одном окне.

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
| **BugHunter** | Статический анализ на баги и подозрительные паттерны |
| **Tests** | Запуск тестов и просмотр результатов |
| **Security** | Поиск уязвимостей: hardcoded секреты, SQL-инъекции, XSS, CSRF |
| **Deps** | Устаревшие/уязвимые зависимости (PyPI) |
| **Tasks** | Celery-задачи и их вызовы |
| **Signals** | Приёмники сигналов, модели с побочными эффектами |

### Инструменты разработчика

- **Терминал** — PTY встроенным в IDE
- **AI-ассистент** — генерация кода и решений по проекту
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

Мидуля `django_naut.middleware.DjangoNautMiddleware` собирает каждый SQL-запрос со стеком вызова и отправляет телеметрию в IDE. Можно добавить миддлю вручную в `MIDDLEWARE` и указать `DJANGONAUT_PORT` в `settings.py`.

## Сборка

- **Linux / macOS** — см. [BUILD.md](BUILD.md)
- **Windows**: `npm run build` (NSIS-инсталлятор + portable)

## Лицензия

MIT
