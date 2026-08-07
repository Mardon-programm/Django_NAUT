const fs = require('node:fs');
const path = require('node:path');

const IGNORE = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env',
  '.idea', '.vscode', 'dist', 'build', '.tox', '.mypy_cache',
  'migrations',
]);


function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function walkDir(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.name.endsWith('.py')) {
      results.push(full);
    }
  }
  return results;
}


function findDjangoRoot(folder) {
  if (!fs.existsSync(folder)) return null;
  if (fs.existsSync(path.join(folder, 'manage.py'))) return folder;

  const walk = (dir, depth) => {
    if (depth > 3) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORE.has(entry.name)) continue;
      const sub = path.join(dir, entry.name);
      if (fs.existsSync(path.join(sub, 'manage.py'))) return sub;
      const deeper = walk(sub, depth + 1);
      if (deeper) return deeper;
    }
    return null;
  };
  const manageRoot = walk(folder, 1);
  if (manageRoot) return manageRoot;

  const walkSettings = (dir, depth) => {
    if (depth > 2) return null;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORE.has(entry.name)) continue;
      const sub = path.join(dir, entry.name);
      const settingsPath = path.join(sub, 'settings.py');
      if (fs.existsSync(settingsPath)) {
        const content = readFileSafe(settingsPath) || '';
        if (/django|BASE_DIR|INSTALLED_APPS|SECRET_KEY/.test(content)) return sub;
      }
      const deeper = walkSettings(sub, depth + 1);
      if (deeper) return deeper;
    }
    return null;
  };
  return walkSettings(folder, 1);
}

function parseSettings(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return null;

  const lines = content.split('\n');
  const settings = {
    debug: null,
    secretKey: null,
    installedApps: [],
    databaseEngine: null,
    allowedHosts: null,
    staticFiles: null,
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#')) continue;

    if (/^DEBUG\s*=/.test(line)) {
      settings.debug = /True|true|1/.test(line.split('=')[1]);
    }
    if (/^SECRET_KEY\s*=/.test(line)) {
      const match = line.match(/SECRET_KEY\s*=\s*['"](.+?)['"]/);
      if (match) settings.secretKey = match[1];
    }
    if (/^INSTALLED_APPS\s*=/.test(line)) {
      let block = line;
      for (let j = i + 1; j < lines.length && !block.includes(']'); j++) {
        block += lines[j];
      }
      const apps = block.match(/['"]([a-zA-Z0-9_.]+)['"]/g);
      if (apps) settings.installedApps = apps.map(a => a.replace(/['"]/g, ''));
    }
    if (/^DATABASES/.test(line)) {
      let block = '';
      let depth = 0;
      for (let j = i; j < lines.length; j++) {
        block += lines[j];
        depth += (lines[j].match(/{/g) || []).length;
        depth -= (lines[j].match(/}/g) || []).length;
        if (depth <= 0) break;
      }
      const engineMatch = block.match(/'ENGINE'\s*:\s*['"](.+?)['"]/);
      if (engineMatch) settings.databaseEngine = engineMatch[1];
    }
  }

  return settings;
}


function parseModels(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return [];

  const models = [];
  const lines = content.split('\n');
  const modelRegex = /^class\s+(\w+)\s*\(\s*(?:models\.Model|AbstractUser|AbstractBaseUser)/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(modelRegex);
    if (match) {
      const name = match[1];
      const fields = [];

      for (let j = i + 1; j < lines.length; j++) {
        const fLine = lines[j].trim();
        if (fLine.startsWith('class ') || (fLine === '' && j > i + 2 && lines[j + 1]?.trim().startsWith('class '))) break;

        const fieldMatch = fLine.match(/^(\w+)\s*=\s*models\.(\w+)\(/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          const fieldType = fieldMatch[2];
          const isForeignKey = fieldType === 'ForeignKey' || fieldType === 'OneToOneField';
          const relatedModel = isForeignKey ? (fLine.match(/to\s*=?\s*['"]?(\w+)['"]?/) || [])[1] : null;
          fields.push({ name: fieldName, type: fieldType, relatedModel });
        }
      }

      models.push({ name, filePath, fields, line: i + 1 });
    }
  }

  return models;
}


function parseViews(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return [];

  const views = [];
  const lines = content.split('\n');
  const viewRegex = /^class\s+(\w+)\s*\(\s*(?:View|APIView|ViewSet|ModelViewSet|GenericAPIView|CreateAPIView|ListAPIView|RetrieveAPIView|UpdateAPIView|DestroyAPIView|ListCreateAPIView|RetrieveUpdateAPIView|RetrieveDestroyAPIView|RetrieveUpdateDestroyAPIView)/;
  const funcRegex = /^(?:async\s+)?def\s+(\w+)\s*\(\s*request/;

  for (let i = 0; i < lines.length; i++) {
    const classMatch = lines[i].match(viewRegex);
    if (classMatch) {
      views.push({ name: classMatch[1], type: 'class', filePath, line: i + 1 });
      continue;
    }

    const funcMatch = lines[i].match(funcRegex);
    if (funcMatch) {
      views.push({ name: funcMatch[1], type: 'function', filePath, line: i + 1 });
    }
  }

  return views;
}


function parseSerializers(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return [];

  const serializers = [];
  const lines = content.split('\n');
  const regex = /^class\s+(\w+)\s*\(\s*(?:serializers\.\w+Serializer|ModelSerializer|HyperlinkedModelSerializer|Serializer)/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(regex);
    if (match) {
      serializers.push({ name: match[1], filePath, line: i + 1 });
    }
  }

  return serializers;
}


function parseUrls(filePath) {
  const content = readFileSafe(filePath);
  if (!content) return [];

  const urls = [];
  const lines = content.split('\n');
  const pathRegex = /(?:path|re_path)\s*\(\s*['"](.+?)['"]/g;

  for (let i = 0; i < lines.length; i++) {
    let match;
    while ((match = pathRegex.exec(lines[i])) !== null) {
      urls.push({ pattern: match[1], filePath, line: i + 1 });
    }
  }

  return urls;
}


function scanProject(folder) {
  const djangoRoot = findDjangoRoot(folder);
  if (!djangoRoot) return { error: 'No Django project found (missing manage.py)' };

  const pyFiles = walkDir(djangoRoot);
  const result = {
    root: djangoRoot,
    settings: null,
    apps: [],
    models: [],
    views: [],
    serializers: [],
    urls: [],
    files: pyFiles,
  };

  for (const file of pyFiles) {
    const basename = path.basename(file);

    if (basename === 'settings.py') {
      result.settings = parseSettings(file);
    }
    if (basename === 'models.py') {
      result.models.push(...parseModels(file));
    }
    if (basename === 'views.py' || basename === 'viewsets.py') {
      result.views.push(...parseViews(file));
    }
    if (basename === 'serializers.py') {
      result.serializers.push(...parseSerializers(file));
    }
    if (basename === 'urls.py') {
      result.urls.push(...parseUrls(file));
    }
  }

  if (result.settings?.installedApps) {
    for (const app of result.settings.installedApps) {
      if (app.startsWith('django.') || app.startsWith('rest_framework')) continue;
      const appDir = path.join(djangoRoot, app.replace(/\./g, '/'));
      if (fs.existsSync(appDir)) {
        result.apps.push({ name: app, path: appDir });
      } else {
        result.apps.push({ name: app, path: null });
      }
    }
  }

  return result;
}

module.exports = { scanProject, findDjangoRoot, walkDir, readFileSafe };
