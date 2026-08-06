// DjangoNAUT Template Inspector: scan all template directories, map
// extends/include references, flag broken refs and shadowed names.

function scanCode() {
  return `
import os
import re
import sys
import django
from django.conf import settings

_EXTENSIONS = ('.html', '.htm', '.txt', '.xml', '.csv', '.md', '.json')
_EXTENDS_RE = re.compile(r"{%\\s*extends\\s+['\\\"]([^'\\\"]+)['\\\"]")
_INCLUDE_RE = re.compile(r"{%\\s*include\\s+['\\\"]([^'\\\"]+)['\\\"]")

dirs = []
for tpl_cfg in getattr(settings, 'TEMPLATES', []):
    for d in tpl_cfg.get('DIRS', []):
        d = str(d)
        if d not in dirs:
            dirs.append(d)
    if tpl_cfg.get('APP_DIRS'):
        for app in getattr(settings, 'INSTALLED_APPS', []):
            try:
                mod = __import__(app, fromlist=['__name__'])
                base = os.path.dirname(os.path.abspath(mod.__file__))
                d = os.path.join(base, 'templates')
                if os.path.isdir(d) and d not in dirs:
                    dirs.append(d)
            except Exception:
                pass

files = []  # (path, name)
for d in dirs:
    for root, _, names in os.walk(d):
        for fn in sorted(names):
            if not fn.lower().endswith(_EXTENSIONS):
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, d).replace(os.sep, '/')
            files.append((full, rel))

# dedupe by realpath
seen = set()
templates = []
for full, name in files:
    rp = os.path.realpath(full)
    if rp in seen:
        continue
    seen.add(rp)
    try:
        text = open(full, 'r', encoding='utf-8', errors='replace').read()
    except Exception:
        text = ''
    extends = _EXTENDS_RE.findall(text)
    includes = _INCLUDE_RE.findall(text)
    templates.append({
        'name': name,
        'path': rp,
        'extends': extends,
        'includes': includes,
    })

known = set(t['name'] for t in templates)
for t in templates:
    t['brokenExtends'] = [n for n in t['extends'] if n not in known]
    t['brokenIncludes'] = [n for n in t['includes'] if n not in known]
    t['extendFiles'] = []
    for n in t['extends']:
        t['extendFiles'].append([x['path'] for x in templates if x['name'] == n][:1] or [])

name_map = {}
for t in templates:
    name_map.setdefault(t['name'], []).append(t['path'])
shadowed = [{'name': n, 'paths': p} for n, p in name_map.items() if len(p) > 1]

templates.sort(key=lambda t: (t['name'].lower(), t['path']))
{
    'dirs': dirs,
    'count': len(templates),
    'brokenCount': sum(len(t['brokenExtends']) + len(t['brokenIncludes']) for t in templates),
    'shadowed': shadowed,
    'templates': templates,
}
`;
}

module.exports = { scanCode };
