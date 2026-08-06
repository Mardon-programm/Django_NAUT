// DjangoNAUT Middleware Inspector: resolve every entry in settings.MIDDLEWARE,
// introspect the class hooks (process_request/view/response/exception/template_response),
// async support and ordering of the request/response pipeline.

function scanCode() {
  return `
import importlib, inspect
from django.conf import settings

_HOOKS = ('process_request', 'process_view', 'process_response',
          'process_exception', 'process_template_response')

def _is_coro(_fn):
    try:
        return inspect.iscoroutinefunction(_fn)
    except Exception:
        return False

_OUT = []
_ERRORS = []

for _idx, _path in enumerate(getattr(settings, 'MIDDLEWARE', []) or []):
    _entry = {
        'path': _path,
        'index': _idx,
        'module': '',
        'class': '',
        'kind': '',
        'file': '',
        'builtin': _path.startswith('django.'),
        'hooks': [],
        'asyncHooks': [],
        'async': False,
        'note': '',
    }
    try:
        _modpath, _, _clsname = _path.rpartition('.')
        if not _modpath:
            raise ValueError('malformed middleware path')
        _mod = importlib.import_module(_modpath)
        _cls = getattr(_mod, _clsname)
        _entry['module'] = _modpath
        _entry['class'] = _clsname
        _entry['kind'] = 'function' if inspect.isfunction(_cls) else ('class' if inspect.isclass(_cls) else 'other')
        _entry['file'] = getattr(_mod, '__file__', '') or ''
        _entry['async'] = _is_coro(getattr(_cls, '__call__', None))
        for _h in _HOOKS:
            _fn = getattr(_cls, _h, None)
            if _fn is not None:
                _entry['hooks'].append(_h)
                if _is_coro(_fn):
                    _entry['asyncHooks'].append(_h)
        if _path == 'django_naut.middleware.DjangoNautMiddleware':
            _entry['note'] = 'telemetry'
    except Exception as _e:
        _entry['error'] = str(_e)[:150]
        _ERRORS.append({'path': _path, 'index': _idx, 'error': str(_e)[:150]})
    _OUT.append(_entry)

{
    'middleware': _OUT,
    'total': len(_OUT),
    'projectCount': sum(1 for _m in _OUT if not _m['builtin'] and not _m.get('error')),
    'builtinCount': sum(1 for _m in _OUT if _m['builtin'] and not _m.get('error')),
    'asyncCount': sum(1 for _m in _OUT if _m['async']),
    'errors': _ERRORS,
}
`;
}

module.exports = { scanCode };
