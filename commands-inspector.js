// DjangoNAUT Management Commands Inspector: list every `manage.py` command
// registered in the project, grouped by origin (project-defined vs Django core),
// with help text, requirements and file locations.

function scanCode() {
  return `
import inspect, importlib
from django.core.management import get_commands, load_command_class

_COMMANDS = get_commands()
_OUT = []
_ERRORS = []

for _name, _app in sorted(_COMMANDS.items()):
    try:
        _cls = load_command_class(_app, _name)
        _module = getattr(_cls, '__module__', '') or ''
        _file = ''
        if _module:
            try:
                _mod = importlib.import_module(_module)
                _file = getattr(_mod, '__file__', '') or ''
            except Exception:
                _file = ''
        _builtin = _module.startswith('django.')
        _help = getattr(_cls, 'help', '') or ''
        if not _help:
            try:
                _doc = inspect.getdoc(_cls) or ''
                _help = _doc.split('\\n')[0] if _doc else ''
            except Exception:
                pass
        _requires = []
        _checks = getattr(_cls, 'requires_system_checks', True)
        if _checks is False:
            _requires.append('skips checks')
        elif isinstance(_checks, (list, tuple)) and _checks:
            _requires.append('checks: ' + ','.join(str(_x) for _x in _checks))
        if getattr(_cls, 'requires_migrations_checks', False):
            _requires.append('migrations')
        _OUT.append({
            'name': _name,
            'app': _app or '',
            'module': _module,
            'file': _file,
            'builtin': bool(_builtin),
            'help': (_help or '')[:200],
            'requires': _requires,
            'hidden': bool(getattr(_cls, 'hidden', False)),
        })
    except Exception as _e:
        _ERRORS.append({'name': _name, 'app': _app or '', 'error': str(_e)[:150]})

{
    'commands': _OUT,
    'errors': _ERRORS,
    'total': len(_OUT),
    'projectCount': sum(1 for _c in _OUT if not _c['builtin']),
    'builtinCount': sum(1 for _c in _OUT if _c['builtin']),
}
`;
}

module.exports = { scanCode };
