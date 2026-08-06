// DjangoNAUT Admin Inspector: enumerate admin.site registrations after
// autodiscover, introspect ModelAdmin options (list_display, list_filter,
// search_fields, inlines, prepopulated_fields) and flag defined-but-unregistered
// ModelAdmin subclasses.

function scanCode() {
  return `
import sys, importlib
from django.apps import apps
from django.contrib import admin

def _is_site(_p):
    _p = str(_p).replace('\\\\', '/')
    return '/site-packages/' in _p or '/dist-packages/' in _p

def _mod_file(_obj):
    try:
        return getattr(sys.modules.get(_obj.__module__), '__file__', '') or ''
    except Exception:
        return ''

def _opt(_admin, _name):
    try:
        _v = getattr(_admin, _name, None)
        if _v is None:
            return []
        if isinstance(_v, (list, tuple)):
            return [str(_x) for _x in _v][:30]
        if isinstance(_v, dict):
            return [str(_k) for _k in list(_v.keys())[:30]]
        return _v
    except Exception:
        return []

try:
    admin.autodiscover()
except Exception:
    pass

_REG = []
for _model, _instance in list(admin.site._registry.items()):
    _admin = type(_instance)
    _m_label = getattr(_model._meta, 'label', '')
    _builtin = _is_site(_mod_file(_model)) or _is_site(_mod_file(_admin)) or _admin.__module__.startswith('django.')
    _inlines = []
    try:
        for _il in getattr(_admin, 'inlines', []) or []:
            _il_model = getattr(getattr(_il, 'model', None), '_meta', None)
            _inlines.append({
                'name': _il.__name__,
                'model': _il_model.label if _il_model is not None else None,
            })
    except Exception:
        pass
    _REG.append({
        'model': _m_label,
        'app': getattr(_model._meta, 'app_label', ''),
        'admin': _admin.__name__,
        'adminModule': _admin.__module__,
        'adminFile': _mod_file(_admin),
        'modelFile': _mod_file(_model),
        'builtin': bool(_builtin),
        'listDisplay': _opt(_admin, 'list_display'),
        'listFilter': _opt(_admin, 'list_filter'),
        'searchFields': _opt(_admin, 'search_fields'),
        'readonlyFields': _opt(_admin, 'readonly_fields'),
        'listEditable': _opt(_admin, 'list_editable'),
        'prepopulated': _opt(_admin, 'prepopulated_fields'),
        'inlines': _inlines,
    })

_UNREG = []
for _cfg in apps.get_app_configs():
    if _is_site(_cfg.path):
        continue
    try:
        _mod = importlib.import_module(_cfg.name + '.admin')
    except ImportError:
        continue
    except Exception:
        continue
    if not _mod.__file__:
        continue
    for _nm in dir(_mod):
        _obj = getattr(_mod, _nm)
        if (isinstance(_obj, type) and issubclass(_obj, admin.ModelAdmin)
                and getattr(_obj, '__module__', '') == _mod.__name__
                and not any(_r['adminModule'] == _mod.__name__ and _r['admin'] == _nm for _r in _REG)):
            _UNREG.append({
                'name': _nm,
                'app': _cfg.name,
                'file': _mod.__file__,
                'model': getattr(getattr(_obj, 'model', None), '_meta', None).label if getattr(getattr(_obj, 'model', None), '_meta', None) else None,
            })

{
    'registrations': _REG,
    'unregistered': _UNREG,
    'total': len(_REG),
    'projectCount': sum(1 for _r in _REG if not _r['builtin']),
    'builtinCount': sum(1 for _r in _REG if _r['builtin']),
    'unregisteredCount': len(_UNREG),
}
`;
}

module.exports = { scanCode };
