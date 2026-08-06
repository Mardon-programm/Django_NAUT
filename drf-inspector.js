// DjangoNAUT DRF Inspector: introspect Django REST Framework apps — routers
// from the root URLconf, viewsets (model, serializer, permissions, overridden
// actions) and serializers (model, fields, nested). Graceful fallback when
// DRF is not installed.

function scanCode() {
  return `
import importlib, sys, os
from django.conf import settings
from django.apps import apps

def _is_site(_p):
    _p = str(_p).replace('\\\\', '/')
    return '/site-packages/' in _p or '/dist-packages/' in _p

def _mod_file(_obj):
    try:
        return getattr(sys.modules.get(_obj.__module__), '__file__', '') or ''
    except Exception:
        return ''

def _overridden(_cls, _method):
    _fn = getattr(_cls, _method, None)
    if _fn is None:
        return False
    _mod = getattr(_fn, '__module__', '')
    return not (_mod.startswith('rest_framework') or _mod.startswith('django.'))

try:
    from rest_framework.viewsets import ViewSetMixin
    from rest_framework import serializers as _drf_serializers
    from rest_framework import routers as _drf_routers
    _HAS_DRF = True
except ImportError:
    _HAS_DRF = False

_VIEWSETS = []
_SERIALIZERS = []
_ROUTERS = []
_ERRORS = []

if _HAS_DRF:

    def _is_own(_obj, _name):
        _mod = getattr(_obj, '__module__', '')
        _file = _mod_file(_obj)
        return _mod and not (_mod.startswith('rest_framework') or _mod.startswith('django.')) and not _is_site(_file)

    _ACTIONS = ('list', 'create', 'retrieve', 'update', 'partial_update', 'destroy')

    for _cfg in apps.get_app_configs():
        if _is_site(_cfg.path):
            continue
        for _dirpath, _dirnames, _files in os.walk(_cfg.path):
            for _f in _files:
                if not _f.endswith('.py'):
                    continue
                _fp = os.path.join(_dirpath, _f)
                _rel = _fp.replace('\\\\', '/')
                if _is_site(_fp):
                    continue
                _modname = _rel[len(_cfg.path.replace('\\\\', '/')):].lstrip('/').replace('/', '.')[:-3]
                _full = (_cfg.name + '.' + _modname) if _modname else _cfg.name
                try:
                    _mod = importlib.import_module(_full)
                except Exception:
                    continue
                for _nm in dir(_mod):
                    _obj = getattr(_mod, _nm)
                    if not isinstance(_obj, type) or not _is_own(_obj, _nm):
                        continue
                    if getattr(_obj, '__module__', '') != _full:
                        continue
                    if issubclass(_obj, ViewSetMixin):
                        _ser = getattr(_obj, 'serializer_class', None)
                        _perms = [getattr(_p, '__name__', str(_p)) for _p in (getattr(_obj, 'permission_classes', None) or [])]
                        _qs = getattr(_obj, 'queryset', None)
                        _qs_model = None
                        if _qs is not None:
                            _m = getattr(_qs, 'model', None)
                            if _m is not None:
                                try:
                                    _qs_model = _m._meta.label
                                except Exception:
                                    _qs_model = str(_m)
                        _pag = getattr(_obj, 'pagination_class', None)
                        _VIEWSETS.append({
                            'name': _nm, 'module': _full, 'file': _fp,
                            'model': _qs_model,
                            'serializer': _ser.__name__ if _ser else None,
                            'serializerModule': getattr(_ser, '__module__', '') if _ser else None,
                            'permissions': _perms,
                            'pagination': getattr(_pag, '__name__', None) if _pag else None,
                            'actions': [_a for _a in _ACTIONS if _overridden(_obj, _a)],
                        })
                    if issubclass(_obj, _drf_serializers.Serializer):
                        _Meta = getattr(_obj, 'Meta', None)
                        _sm = getattr(_Meta, 'model', None) if _Meta else None
                        _fields = getattr(_Meta, 'fields', None) if _Meta else None
                        _decl = getattr(_obj, '_declared_fields', {}) or {}
                        _ro = sum(1 for _f in _decl.values() if getattr(_f, 'read_only', False))
                        _nested = [getattr(_f, '__class__', None).__name__ for _f in _decl.values() if isinstance(_f, _drf_serializers.Serializer)]
                        _SERIALIZERS.append({
                            'name': _nm, 'module': _full, 'file': _fp,
                            'model': _sm._meta.label if _sm is not None and getattr(_sm, '_meta', None) else None,
                            'fields': _fields,
                            'declared': len(_decl),
                            'readOnly': _ro,
                            'depth': getattr(_Meta, 'depth', None) if _Meta else None,
                            'nested': _nested,
                            'extraKwargs': len(getattr(_Meta, 'extra_kwargs', {}) or {}) if _Meta else 0,
                        })

    try:
        _urlconf = importlib.import_module(settings.ROOT_URLCONF)
        for _nm, _obj in list(vars(_urlconf).items()):
            if isinstance(_obj, _drf_routers.BaseRouter):
                _routes = [{
                    'prefix': _p, 'viewset': _v.__name__, 'basename': _b,
                } for _p, _v, _b in getattr(_obj, 'registry', [])]
                _ROUTERS.append({'var': _nm, 'type': type(_obj).__name__, 'routes': _routes})
    except Exception as _e:
        _ERRORS.append('urlconf: ' + str(_e)[:150])

{
    'hasDrf': bool(_HAS_DRF),
    'viewsets': _VIEWSETS,
    'serializers': _SERIALIZERS,
    'routers': _ROUTERS,
    'viewsetCount': len(_VIEWSETS),
    'serializerCount': len(_SERIALIZERS),
    'routerCount': len(_ROUTERS),
    'routeCount': sum(len(_r['routes']) for _r in _ROUTERS),
    'errors': _ERRORS,
}
`;
}

module.exports = { scanCode };
