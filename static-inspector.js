// DjangoNAUT Static Files Inspector: list static dirs & files, flag shadowed
// names, and find broken {% static %} references inside templates.

function scanCode() {
  return `
import os
import re
from collections import defaultdict
from django.conf import settings

errors = []

def _app_dirs(sub):
    out = []
    for app in getattr(settings, 'INSTALLED_APPS', []):
        try:
            mod = __import__(app, fromlist=['__name__'])
            base = os.path.dirname(os.path.abspath(mod.__file__))
            d = os.path.join(base, sub)
            if os.path.isdir(d):
                out.append(d)
        except Exception:
            pass
    return out

dirs = []
for d in (getattr(settings, 'STATICFILES_DIRS', None) or []):
    if isinstance(d, (tuple, list)):
        d = d[-1]
    d = str(d)
    if os.path.isdir(d) and d not in dirs:
        dirs.append(d)
for d in _app_dirs('static'):
    if d not in dirs:
        dirs.append(d)
root = getattr(settings, 'STATIC_ROOT', None)
root = str(root) if root else ''
if root and os.path.isdir(root) and root not in dirs:
    dirs.append(root)

files = []
for d in dirs:
    for r, _, names in os.walk(d):
        for fn in sorted(names):
            full = os.path.join(r, fn)
            try:
                size = os.path.getsize(full)
            except Exception:
                size = -1
            rel = os.path.relpath(full, d).replace(os.sep, '/')
            files.append({'dir': d, 'rel': rel, 'path': full, 'size': size})

by_ext = defaultdict(int)
for f in files:
    ext = os.path.splitext(f['rel'])[1].lower() or '(none)'
    by_ext[ext] += 1

loc = defaultdict(list)
for f in files:
    if root and f['dir'] == root:
        continue
    loc[f['rel']].append(f['dir'])
shadowed = [{'rel': k, 'dirs': v} for k, v in loc.items() if len(v) > 1]
shadowed.sort(key=lambda s: s['rel'].lower())

# broken {% static '...' %} refs inside templates
def _collect_tpl_dirs():
    out = []
    for tpl_cfg in getattr(settings, 'TEMPLATES', []):
        for d in tpl_cfg.get('DIRS', []):
            d = str(d)
            if os.path.isdir(d) and d not in out:
                out.append(d)
        if tpl_cfg.get('APP_DIRS'):
            for d in _app_dirs('templates'):
                if d not in out:
                    out.append(d)
    return out

_TPLEXTS = ('.html', '.htm', '.txt', '.xml', '.csv', '.md', '.json')
_STATIC_RE = re.compile(r"{%\\s*static\\s+['\\\"]([^'\\\"]+)['\\\"]")

def _exists(ref):
    if not ref:
        return False
    norm = ref.lstrip('/').replace('/', os.sep)
    for d in dirs:
        if os.path.exists(os.path.join(d, norm)):
            return True
    return False

broken_refs = []
total_broken = 0
for td in _collect_tpl_dirs():
    for r, _, names in os.walk(td):
        for fn in names:
            if not fn.lower().endswith(_TPLEXTS):
                continue
            full = os.path.join(r, fn)
            try:
                text = open(full, 'r', encoding='utf-8', errors='replace').read()
            except Exception:
                continue
            refs = [x for x in _STATIC_RE.findall(text) if not _exists(x)]
            if refs:
                broken_refs.append({
                    'template': os.path.relpath(full, td).replace(os.sep, '/'),
                    'path': full,
                    'refs': refs[:20],
                })
                total_broken += len(refs)

total_bytes = sum(f['size'] for f in files if f['size'] > 0)
{
    'dirs': dirs,
    'root': root,
    'count': len(files),
    'bytes': total_bytes,
    'byExt': {k: v for k, v in sorted(by_ext.items(), key=lambda kv: -kv[1])},
    'shadowed': shadowed,
    'brokenRefs': broken_refs,
    'brokenCount': total_broken,
    'errors': errors,
    'files': files,
}
`;
}

module.exports = { scanCode };
