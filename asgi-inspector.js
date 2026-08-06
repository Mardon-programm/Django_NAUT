// DjangoNAUT ASGI/Routing Inspector: introspect asgi.py, the ASGI application
// object, protocol types and channels/websocket route & consumer structure.

function scanCode() {
  return `
import os
import sys
import importlib
import inspect
from django.conf import settings

_WS_BASES = []
try:
    from channels.generic.websocket import AsyncWebsocketConsumer, WebsocketConsumer
    _WS_BASES = [AsyncWebsocketConsumer, WebsocketConsumer]
except Exception:
    pass

def _is_ws_target(target):
    if not isinstance(target, type):
        return False
    if _WS_BASES:
        for b in _WS_BASES:
            if issubclass(target, b):
                return True
    return 'consumer' in type(target).__name__.lower()

def _target_name(target):
    if target is None:
        return ''
    if isinstance(target, type):
        return target.__name__
    if callable(target):
        try:
            return target.__name__ or type(target).__name__
        except Exception:
            return type(target).__name__
    return str(target)

def _consumer_methods(consumer):
    try:
        out = []
        for m, v in inspect.getmembers(consumer):
            if not m.startswith('_') and callable(v) and not isinstance(v, (classmethod, staticmethod)):
                if inspect.iscoroutinefunction(v) or inspect.isasyncgenfunction(v) or inspect.isfunction(v):
                    if getattr(v, '__module__', '') == consumer.__module__:
                        out.append(m)
        return sorted(out)
    except Exception:
        return []

def _run():
    info = {
        'asgiPath': '',
        'exists': False,
        'appType': '',
        'protocols': [],
        'httpRoutes': [],
        'wsRoutes': [],
        'consumers': [],
        'errors': [],
    }

    settings_pkg = sys.modules.get(settings.SETTINGS_MODULE)
    base = ''
    if settings_pkg is not None:
        base = os.path.dirname(os.path.abspath(settings_pkg.__file__ or ''))
    asgi_path = os.path.join(base, 'asgi.py') if base else ''
    info['asgiPath'] = asgi_path
    if not asgi_path or not os.path.exists(asgi_path):
        return info
    info['exists'] = True

    try:
        asgi_mod = importlib.import_module(settings.SETTINGS_MODULE.rsplit('.', 1)[0] + '.asgi')
    except Exception:
        import traceback
        info['errors'].append(traceback.format_exc(limit=6))
        return info

    app = getattr(asgi_mod, 'application', None)
    if app is None:
        info['errors'].append("no 'application' object in asgi.py")
        return info
    info['appType'] = type(app).__name__

    def _walk(obj, depth=0):
        if depth > 6:
            return
        mapping = getattr(obj, 'application_mapping', None)
        if isinstance(mapping, dict):
            for proto, sub in mapping.items():
                if proto not in info['protocols']:
                    info['protocols'].append(proto)
                _walk(sub, depth + 1)
            return
        routes = getattr(obj, 'routes', None)
        if isinstance(routes, list):
            for route in routes:
                pat_obj = getattr(route, 'route', None) or getattr(route, 'pattern', None)
                try:
                    pattern = str(getattr(pat_obj, 'pattern', pat_obj))
                except Exception:
                    pattern = ''
                raw_target = getattr(route, 'consumer', None) or getattr(route, 'callback', None) or getattr(route, 'application', None)
                consumer_cls = raw_target if isinstance(raw_target, type) else getattr(raw_target, 'consumer_class', None)
                rname = getattr(route, 'name', '') or ''
                rtype = type(route).__name__
                entry = {'pattern': pattern, 'target': _target_name(consumer_cls if isinstance(consumer_cls, type) else raw_target), 'type': rtype, 'name': rname}
                if isinstance(consumer_cls, type):
                    entry['methods'] = _consumer_methods(consumer_cls)
                    try:
                        entry['file'] = sys.modules.get(consumer_cls.__module__).__file__ or ''
                    except Exception:
                        entry['file'] = ''
                    if not any(c['name'] == consumer_cls.__name__ and c['module'] == consumer_cls.__module__ for c in info['consumers']):
                        info['consumers'].append({
                            'name': consumer_cls.__name__,
                            'module': consumer_cls.__module__,
                            'file': entry['file'],
                            'methods': entry['methods'],
                            'groups': list(getattr(consumer_cls, 'groups', []) or []),
                        })
                if _is_ws_target(consumer_cls):
                    info['wsRoutes'].append(entry)
                else:
                    info['httpRoutes'].append(entry)
            return
        inner = getattr(obj, 'inner', None)
        if inner is not None:
            _walk(inner, depth + 1)
            return

    _walk(app)

    if not info['protocols'] and info['appType'] == 'ASGIHandler':
        info['protocols'] = ['http']

    info['consumerCount'] = len(info['consumers'])
    return info

_run()
`;
}

module.exports = { scanCode };
