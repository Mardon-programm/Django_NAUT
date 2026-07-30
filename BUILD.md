# Сборка под Linux и macOS

Требования: Node.js 18+, npm.

## 1. Клонировать и установить

```bash
git clone https://github.com/Mardon-programm/Django_NAUT.git
cd Django_NAUT
npm install
```

На WSL (например, Kali Linux) не используйте Windows-версию Node.js из `/mnt/c/`. Установите nvm внутри WSL:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm install-latest-npm
cd ~/Django_NAUT   # предварительно склонируйте в домашнюю папку WSL
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
