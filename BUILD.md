# Сборка под Linux и macOS

## 1. Клонировать и установить

```bash
git clone https://github.com/Mardon-programm/Django_NAUT.git
cd Django_NAUT
npm install
```

## 2. Собрать

### Linux (AppImage + deb)
```bash
npm run build:linux
```
Готовые файлы в `dist/`:
- `DjangoNAUT-1.0.5.AppImage` — портативная (скачал и запустил)
- `DjangoNAUT-1.0.5.deb` — для Ubuntu/Debian

### macOS (DMG)
```bash
npm run build:mac
```
Готовые файлы в `dist/`:
- `DjangoNAUT-1.0.5.dmg` — установщик для macOS
- `DjangoNAUT-1.0.5-mac.zip` — портативная версия
