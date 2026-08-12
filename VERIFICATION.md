# DjangoNAUT 1.0.5 — Отчёт о проверке готовности к запуску

Дата: 2026-08-07. Ветка `master`, коммит `d28bab6`. Релиз **v1.0.5** опубликован на GitHub (9 артефактов, все 3 платформы).

---

## 1. Вывод

Проект **готов к запуску**. Все критические «дыры» закрыты, весь проверяемый функционал работает: 25/25 юнит-тестов, 30/30 динамических сканеров, офлайн-редактор проверен в dev и в собранном пакете.

---

## 2. Что исправлено в этой сессии

| Проблема | Статус |
| --- | --- |
| Левая колонка (35+ иконок) не скроллилась — нижние панели недоступны | ✅ `styles.css`: `.activity-bar-top` теперь scrollable |
| Редактор Monaco грузился с CDN — без интернета деградировал до textarea | ✅ Monaco vendored локально (`monaco-editor@0.52.2` в asar), CSP очищен от CDN, `allowFileAccessFromFileUrls` |
| Телеметрия захватывала `Cookie`/`Authorization` и тела POST (пароли) | ✅ Заголовки исключены полностью; поля `password/token/secret/…` редэктятся (`***`) в JSON, form и raw-body |

---

## 3. Методика и результаты проверки

### 3.1 Юнит-тесты — 25/25 PASS

| Группа | Что проверяет |
| --- | --- |
| N+1-анализатор (10) | Детекция N+1, порог срабатывания, нормализация SQL, хинты `select_related/prefetch_related`, пустые запросы |
| Migration drift (5) | Парсинг `makemigrations --check`: отсутствие дрейфа, дрейф, мульти-app, CRLF/`stderr`-вывод, неизвестные коды |
| Синтаксис | Все корневые JS-файлы проходят `node --check` |
| Python-агент (2) | Компиляция всех `.py`; редэкт секретов + исключение Cookie/Auth заголовков |
| Упаковка (4) | Все `build.files` существуют, `extraResources` и `asarUnpack` корректны, версия согласована |
| Проводка UI↔IPC (3) | Каждая панель в `index.html` имеет иконку и обработчик в renderer; каждый IPC-канал preload имеет `ipcMain.handle/on` в `main.js`; нет дублей каналов |

### 3.2 Динамическая проверка сканеров — 30/30 OK

Бутнуто реальное приложение (Electron) и вызваны все IPC-каналы сканирования против реального Django-проекта (`web_editor/`). **Каждый** вернул корректные данные без ошибок:

`django.scan`, `bughunt`, `urls`, `orm`, `cfg`, `tpl`, `forms`, `static`, `asgi`, `commands`, `middleware`, `i18n`, `admin`, `drf`, `migration.scan/graph/drift`, `signals`, `celery`, `deps`, `security`, `cache.inspect`, `db.databases`, `tests.scan`, `agent.check`, `mail.list`, `git.status`, `deploy.check`, `fs.readdir`, `shell.ping`.

### 3.3 Офлайн-редактор — PASS

Проверено в двух режимах:
- **Dev**: Monaco грузится с `file://`, редактор создаётся, воркеры стартуют, ошибок 0.
- **Packaged** (из `app.asar` в `win-unpacked`): `monaco:true`, редактор создан, воркеры чисто.

### 3.4 Smoke-тест — PASS

`npm run test:smoke`: приложение живо 20 секунд без фатальных ошибок, PTY-терминал стартует.

### 3.5 Windows-сборка — PASS

`npm run build` → `DjangoNAUT.Setup.1.0.5.exe` (NSIS) и `DjangoNAUT.1.0.5.exe` (portable), ~113 MB, Monaco внутри asar.

### 3.6 CI + релиз — PASS

- Ран #10 (`c3f6ee3`): success — все 3 платформы.
- Ран #11 (тег `v1.0.5`): success — release-джоба.
- GitHub Release `v1.0.5` создан, **9 артефактов**:
  - Windows: `DjangoNAUT.1.0.5.exe`, `DjangoNAUT.Setup.1.0.5.exe`
  - macOS: `.dmg` + `.zip` (x64 и arm64)
  - Linux: `.AppImage`, `.deb`, `.rpm`

---

## 4. Известные ограничения (не блокируют запуск)

1. **AI-функции требуют Groq API-ключ и интернет** — единственная сетевая зависимость оставлена осознанно (LLM).
2. **`node-pty` — нативные пребилды** — при апгрейде Electron/Node может потребоваться пересборка; в CI уже не падает.
3. **Порт агента по умолчанию 9999** — если занят, `runserver_naut` упадёт со штатной ошибкой Django (можно указать `--naut-port`).
4. **Python-агент ставится вручную** (`pip install -e ./python-agent`) — автоматическая установка из IDE в планах.
5. **Захват тела запросов остаётся включённым** (с редэктом секретов) — полностью отключается настройкой middleware при желании.
