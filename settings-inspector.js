// DjangoNAUT Settings Inspector: dump key Django settings (secrets masked),
// versions, paths and environment variables through the project shell.

function settingsCode() {
  return `
import os
import platform
import django
from django.conf import settings

def _mask(v):
    s = str(v)
    if not s:
        return ''
    if len(s) <= 8:
        return '***'
    return s[:4] + '...' + s[-4:]

_SECRET_HINTS = ('KEY', 'SECRET', 'PASSWORD', 'TOKEN', 'CREDENTIAL', 'AUTH_HASH')

def _scrub(v):
    if isinstance(v, dict):
        out = {}
        for k, val in v.items():
            if any(h in k.upper() for h in _SECRET_HINTS):
                out[k] = _mask(val)
            else:
                out[k] = _scrub(val)
        return out
    if isinstance(v, (list, tuple)):
        return [_scrub(x) for x in v[:100]]
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    try:
        return repr(v)[:200]
    except Exception:
        return '<unprintable>'

sections = {}
sections['versions'] = {
    'python': platform.python_version(),
    'django': django.get_version(),
}
sections['core'] = {
    'DEBUG': settings.DEBUG,
    'SECRET_KEY': _mask(getattr(settings, 'SECRET_KEY', '')),
    'ALLOWED_HOSTS': list(getattr(settings, 'ALLOWED_HOSTS', [])),
    'ROOT_URLCONF': getattr(settings, 'ROOT_URLCONF', ''),
    'WSGI_APPLICATION': getattr(settings, 'WSGI_APPLICATION', ''),
    'ASGI_APPLICATION': getattr(settings, 'ASGI_APPLICATION', ''),
    'LANGUAGE_CODE': getattr(settings, 'LANGUAGE_CODE', ''),
    'TIME_ZONE': getattr(settings, 'TIME_ZONE', ''),
    'USE_TZ': getattr(settings, 'USE_TZ', None),
    'SITE_ID': getattr(settings, 'SITE_ID', None),
    'AUTH_USER_MODEL': getattr(settings, 'AUTH_USER_MODEL', ''),
}
sections['paths'] = {
    'BASE_DIR': str(getattr(settings, 'BASE_DIR', '')),
    'STATIC_URL': getattr(settings, 'STATIC_URL', ''),
    'STATIC_ROOT': str(getattr(settings, 'STATIC_ROOT', '') or ''),
    'MEDIA_URL': getattr(settings, 'MEDIA_URL', ''),
    'MEDIA_ROOT': str(getattr(settings, 'MEDIA_ROOT', '') or ''),
    'DEFAULT_AUTO_FIELD': getattr(settings, 'DEFAULT_AUTO_FIELD', ''),
}
_templates = getattr(settings, 'TEMPLATES', [])
if _templates:
    sections['paths']['TEMPLATE_DIRS'] = list(_templates[0].get('DIRS', []))
sections['apps'] = list(getattr(settings, 'INSTALLED_APPS', []))
sections['middleware'] = list(getattr(settings, 'MIDDLEWARE', []))
sections['databases'] = _scrub(getattr(settings, 'DATABASES', {}))
sections['caches'] = _scrub(getattr(settings, 'CACHES', {}))
_email = {k: getattr(settings, k, '') for k in ('EMAIL_BACKEND', 'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_HOST_USER', 'EMAIL_HOST_PASSWORD', 'EMAIL_USE_TLS', 'EMAIL_USE_SSL', 'DEFAULT_FROM_EMAIL')}
sections['email'] = _scrub(_email)
env = {}
for k in sorted(os.environ):
    v = os.environ[k]
    if any(h in k.upper() for h in _SECRET_HINTS):
        env[k] = _mask(v)
    else:
        env[k] = v
    if len(env) >= 150:
        break
sections['env'] = env
sections
`;
}

module.exports = { settingsCode };
