// Regression tests for the Bug Hunter analyzer: it must be honest — no
// dangerous false positives, no dead checks, no false-auto-fixes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, ok } = require('./lib');
const { scanProject, findDjangoRoot } = require('../django-scanner.js');
const { runBugHunter, applyFix } = require('../bughunter.js');

function makeProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'naut-test-'));
  fs.mkdirSync(path.join(tmp, 'myproj'));
  fs.mkdirSync(path.join(tmp, 'blog', 'models'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'blog', 'views'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'manage.py'), '#!/usr/bin/env python\n');
  fs.writeFileSync(path.join(tmp, 'myproj', 'settings.py'), [
    'import os',
    'DEBUG = True',
    "SECRET_KEY = os.environ.get('SECRET_KEY', 'dummy')",
    "ALLOWED_HOSTS = ['example.com']",
    "INSTALLED_APPS = ['blog']",
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(tmp, 'blog', '__init__.py'), '');
  fs.writeFileSync(path.join(tmp, 'blog', 'models', '__init__.py'), 'from .post import Post, Comment\n');
  fs.writeFileSync(path.join(tmp, 'blog', 'models', 'post.py'), [
    'from django.db import models',
    '',
    'class Author(models.Model):',
    '    name = models.CharField(max_length=100)',
    '',
    'class Post(models.Model):',
    '    title = models.CharField(max_length=200)',
    '    author = models.ForeignKey(Author)',
    '',
    'class Comment(models.Model):',
    '    post = models.ForeignKey(Post, on_delete=models.CASCADE)',
    '    text = models.TextField()',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(tmp, 'blog', 'views', '__init__.py'), '');
  const viewsPath = path.join(tmp, 'blog', 'views', 'post_views.py');
  fs.writeFileSync(viewsPath, [
    'import numpy as np',
    'import json',
    'from myapp.models import Post',
    '',
    'def post_list(request):',
    '    posts = Post.objects.all()',
    '    result = []',
    '    for p in posts:',
    '        author_name = p.author.name',
    '        result.append(author_name)',
    '',
    '    data = np.array([1, 2])',
    '    return result, data',
    '',
  ].join('\n'));
  const scan = scanProject(tmp);
  return { tmp, scan, viewsPath, modelsPath: path.join(tmp, 'blog', 'models', 'post.py') };
}

test('models/ and views/ packages are detected', () => {
  const { tmp, scan } = makeProject();
  try {
    ok(!!findDjangoRoot(tmp), 'root not found');
    const names = scan.models.map((m) => m.name).join(',');
    ok(names.includes('Post') && names.includes('Comment'), 'models from models/ package not found: ' + names);
    ok(scan.views.some((v) => v.name === 'post_list'), 'views from views/ package not found');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('settings parsed from config package, not project root', () => {
  const { tmp, scan } = makeProject();
  try {
    ok(scan.settings && scan.settings.settingsFile.endsWith('myproj' + path.sep + 'settings.py'), 'settingsFile wrong');
    ok(scan.settings.debug === true, 'DEBUG not parsed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('no false positives: env SECRET_KEY, used imports, FK index spam', () => {
  const { tmp, scan } = makeProject();
  try {
    const issues = runBugHunter(scan);
    const titles = issues.map((i) => i.title);
    ok(!titles.includes('SECRET_KEY not found'), 'env-based SECRET_KEY flagged as missing');
    ok(!titles.includes('SECRET_KEY hardcoded in settings.py'), 'env-based SECRET_KEY flagged hardcoded');
    ok(!titles.includes('DEBUG = True in production'), 'old DEBUG error title still present');
    ok(!titles.includes('Unused import: "myapp"') && !titles.includes('Unused import: "numpy"') && !titles.includes('Unused import: "np"'), 'used imports flagged');
    ok(!titles.includes('Unused import: "Post"') && !titles.includes('Unused import: "Comment"'), '__init__ re-exports flagged');
    ok(!issues.some((i) => i.category === 'Missing Index'), 'FK index check still running');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('true positives: DEBUG warning, unused import, N+1, on_delete', () => {
  const { tmp, scan } = makeProject();
  try {
    const issues = runBugHunter(scan);
    const t = (title) => issues.find((i) => i.title === title);
    const debug = t('DEBUG = True');
    ok(debug && debug.severity === 'warning', 'DEBUG not a warning');
    const unused = t('Unused import: "json"');
    ok(unused && unused.fixable, 'truly unused json not flagged/fixable');
    const n1 = t('Potential N+1 on "author" access');
    ok(n1 && n1.line === 9, 'N+1 not detected at correct line');
    ok(t('Missing on_delete for "author"'), 'missing on_delete not flagged');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('auto-fix is safe: removes only the unused line, keeps used imports', () => {
  const { tmp, scan, viewsPath, modelsPath } = makeProject();
  try {
    const issues = runBugHunter(scan);
    const r1 = applyFix(issues.find((i) => i.title === 'Unused import: "json"'));
    const vw = fs.readFileSync(viewsPath, 'utf8');
    ok(r1.applied, 'unused import fix not applied');
    ok(!vw.includes('import json'), 'unused import not removed');
    ok(vw.includes('from myapp.models import Post'), 'used import removed');
    ok(vw.includes('import numpy as np'), 'used as-import removed');

    const r2 = applyFix(issues.find((i) => i.title === 'Missing on_delete for "author"'));
    const models = fs.readFileSync(modelsPath, 'utf8');
    ok(r2.applied, 'on_delete fix not applied');
    ok(models.includes('author = models.ForeignKey(Author, on_delete=models.CASCADE)'), 'on_delete not injected');
    ok(models.includes('post = models.ForeignKey(Post, on_delete=models.CASCADE)'), 'existing on_delete touched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
