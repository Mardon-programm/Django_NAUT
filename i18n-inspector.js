// DjangoNAUT i18n / Translations Inspector: discover locale catalogs (.po)
// across installed apps and the project, report translation health per language,
// and find untranslated strings used in templates / Python code.

function scanCode() {
  return `
import os, re, glob
from django.conf import settings
from django.apps import apps

_TTRANS = re.compile(r"{%\\s*trans\\s+([\\\"'])(.*?)\\1", re.S)
_TBLOCK = re.compile(r"{%\\s*blocktrans(?:late)?[^%]*%}(.*?){%\\s*endblocktrans(?:late)?\\s*%}", re.S)
_GETTEXT = re.compile(r"(?:_|gettext|gettext_lazy|ugettext|ugettext_lazy|ngettext|ngettext_lazy|pgettext|pgettext_lazy)\\s*\\(\\s*[uf]?[\\\"'](?P<s>[^\\\"']*)[\\\"']")

_SKIP_DIRS = ('venv', 'node_modules', 'site-packages', 'dist-packages', '.git', '__pycache__', 'static', 'media')

def _is_site(_p):
    _p = _p.replace('\\\\', '/')
    return '/site-packages/' in _p or '/dist-packages/' in _p

def _iter_py(_root):
    for _dirpath, _dirnames, _files in os.walk(_root):
        _dirnames[:] = [d for d in _dirnames if d not in _SKIP_DIRS]
        for _f in _files:
            if _f.endswith('.py') and not _dirpath.replace('\\\\', '/').endswith(('migrations', 'management/commands')):
                yield os.path.join(_dirpath, _f)

def _block_strings(_text):
    _out = []
    for _m in _TBLOCK.finditer(_text):
        for _part in re.split(r"{%\\s*plural\\s*%}", _m.group(1)):
            _s = re.sub(r"{%.*?%}", '', _part)
            _s = re.sub(r'\\s+', ' ', _s).strip()
            if _s:
                _out.append(_s)
    return _out

def _read(_p):
    try:
        with open(_p, encoding='utf-8') as _f:
            return _f.read()
    except Exception:
        return ''

def _msgval(_line):
    _i = _line.find('"')
    if _i == -1:
        return ''
    _rest = _line[_i + 1:]
    if _rest.endswith('"'):
        return _rest[:-1]
    return _rest

def _parse_po(_path):
    _cat = {'translated': 0, 'untranslated': 0, 'fuzzy': 0, 'obsolete': 0, 'msgids': set()}
    _cur = None
    _fuzzy = False
    _obsolete = False
    try:
        with open(_path, encoding='utf-8') as _f:
            for _line in _f:
                _line = _line.strip()
                if not _line:
                    continue
                if _line.startswith('#~'):
                    if _cur is not None and _cur.get('id') is not None:
                        _finalize(_cur, _cat, _fuzzy, True)
                        _cur = None
                    continue
                if _line.startswith('#'):
                    if _line.startswith('#,'):
                        _fuzzy = 'fuzzy' in _line
                    continue
                if _line.startswith('msgid_plural'):
                    if _cur is not None:
                        _cur['plural'] = True
                    continue
                if _line.startswith('msgid') and not _line.startswith('msgid_'):
                    if _cur is not None and _cur.get('id') is not None:
                        _finalize(_cur, _cat, _fuzzy, _obsolete)
                    _cur = {'id': _msgval(_line), 'values': [], 'plural': False, 'section': 'id'}
                    _fuzzy = False
                    _obsolete = False
                elif _line.startswith('msgstr'):
                    if _cur is not None:
                        _cur['values'].append(_msgval(_line))
                        _cur['section'] = len(_cur['values']) - 1
                elif _line.startswith('"') and _cur is not None:
                    _extra = _msgval(_line)
                    if _cur['section'] == 'id':
                        _cur['id'] += _extra
                    elif _cur['values']:
                        _cur['values'][-1] += _extra
            if _cur is not None and _cur.get('id') is not None:
                _finalize(_cur, _cat, _fuzzy, _obsolete)
    except Exception:
        pass
    return _cat

def _finalize(_cur, _cat, _fuzzy, _obsolete):
    if _obsolete:
        _cat['obsolete'] += 1
        return
    _cat['msgids'].add(_cur.get('id', ''))
    if any(_v for _v in _cur.get('values', [])):
        _cat['translated'] += 1
    else:
        _cat['untranslated'] += 1
    if _fuzzy:
        _cat['fuzzy'] += 1

_OUT = {'poFiles': [], 'usage': {'templates': [], 'python': []}, 'missing': [], 'localeDirs': [], 'errors': []}

_BASE = os.path.abspath(os.getcwd())
_ROOTS = [_BASE]
for _cfg in apps.get_app_configs():
    try:
        if _cfg.name != 'django_naut' and not _is_site(_cfg.path):
            _ROOTS.append(os.path.abspath(_cfg.path))
    except Exception:
        pass

_LOCALES = set()
for _r in _ROOTS:
    for _p in glob.glob(os.path.join(_r, 'locale', '*', 'LC_MESSAGES', '*.po')):
        _LOCALES.add(_p)

_ALL_MSGIDS = set()
for _p in sorted(_LOCALES):
    try:
        _lang = _p.replace('\\\\', '/').split('/locale/')[-1].split('/')[0]
    except Exception:
        _lang = '?'
    _cat = _parse_po(_p)
    _ALL_MSGIDS |= _cat['msgids']
    _total = _cat['translated'] + _cat['untranslated']
    _OUT['poFiles'].append({
        'path': _p, 'lang': _lang,
        'file': os.path.relpath(_p, _BASE).replace('\\\\', '/'),
        'translated': _cat['translated'], 'untranslated': _cat['untranslated'],
        'fuzzy': _cat['fuzzy'], 'obsolete': _cat['obsolete'], 'total': _total,
        'percent': int(round(100.0 * _cat['translated'] / _total)) if _total else 0,
    })

_TEMPLATE_DIRS = []
try:
    _TEMPLATE_DIRS = [os.path.abspath(_d) for _d in settings.TEMPLATES[0].get('DIRS', []) if os.path.isdir(_d) and not _is_site(_d)]
except Exception:
    pass
for _cfg in apps.get_app_configs():
    _t = os.path.join(_cfg.path, 'templates')
    if os.path.isdir(_t) and not _is_site(_t):
        _TEMPLATE_DIRS.append(_t)

for _d in _TEMPLATE_DIRS:
    for _dirpath, _dirnames, _files in os.walk(_d):
        for _f in _files:
            if not _f.endswith(('.html', '.txt')):
                continue
            _fp = os.path.join(_dirpath, _f)
            _src = _read(_fp)
            _strings = [m.group(2) for m in _TTRANS.finditer(_src)]
            _strings += _block_strings(_src)
            _strings = [_s for _s in _strings if _s]
            if _strings:
                _OUT['usage']['templates'].append({'file': os.path.relpath(_fp, _BASE).replace('\\\\', '/'), 'strings': _strings[:20], 'count': len(_strings)})

for _cfg in apps.get_app_configs():
    if _is_site(_cfg.path):
        continue
    for _fp in _iter_py(_cfg.path):
        _src = _read(_fp)
        _strings = [m.group('s') for m in _GETTEXT.finditer(_src)]
        _strings = [_s for _s in _strings if _s]
        if _strings:
            _OUT['usage']['python'].append({'file': os.path.relpath(_fp, _BASE).replace('\\\\', '/'), 'strings': _strings[:20], 'count': len(_strings)})

if not _ALL_MSGIDS:
    _OUT['missing'] = []
else:
    _SEEN = set()
    for _u in list(_OUT['usage']['templates']) + list(_OUT['usage']['python']):
        for _s in _u['strings']:
            if _s not in _ALL_MSGIDS and _s not in _SEEN:
                _SEEN.add(_s)
                _OUT['missing'].append(_s)
    _OUT['missing'] = _OUT['missing'][:80]

_OUT['totalPofiles'] = len(_OUT['poFiles'])
_OUT['totalTranslated'] = sum(_c['translated'] for _c in _OUT['poFiles'])
_OUT['totalUntranslated'] = sum(_c['untranslated'] for _c in _OUT['poFiles'])
_OUT['missingCount'] = len(_OUT['missing'])

_OUT
`;
}

module.exports = { scanCode };
