// Cache Inspector: introspect Django cache backends through the project shell
// (JSON-RPC via shell-rpc -> `python -m django_naut`).

function inspectCode() {
  return `
from django.core.cache import caches
from django.conf import settings
import time
import datetime
try:
    import pickle
except Exception:
    pickle = None

def __nc_vrepr(v):
    try:
        r = repr(v)
    except Exception:
        return '<unprintable>'
    return r[:200]

def __nc_unpickle(v):
    if pickle is None:
        return v
    try:
        return pickle.loads(v)
    except Exception:
        return v

def __nc_display(raw, prefix, version):
    s = raw
    if prefix and s.startswith(prefix + ':'):
        s = s[len(prefix) + 1:]
    vp = str(version) + ':'
    if s.startswith(':' + vp):
        s = s[len(vp) + 1:]
    elif s.startswith(vp):
        s = s[len(vp):]
    return s

def __nc_locmem(cache, out):
    entries = getattr(cache, '_cache', None)
    exp = getattr(cache, '_expire_info', None) or {}
    out['type'] = 'locmem'
    out['location'] = getattr(cache, 'location', '')
    prefix = getattr(cache, 'key_prefix', '') or ''
    version = getattr(cache, 'version', 1)
    keys = []
    now = time.time()
    if isinstance(entries, dict):
        for i, (k, v) in enumerate(entries.items()):
            if i >= 50:
                break
            e = exp.get(k)
            ttl = None
            if e is not None:
                ttl = max(0, int(e - now))
            keys.append({'key': __nc_display(k, prefix, version), 'value': __nc_vrepr(__nc_unpickle(v)), 'ttl': ttl})
        out['entryCount'] = len(entries)
    out['keys'] = keys

def __nc_redis(cache, out):
    client = getattr(cache, '_cache', None)
    out['type'] = 'redis'
    if client is None:
        out['error'] = 'no redis client'
        out['keys'] = []
        return
    try:
        info = client.info('stats') or {}
        out['hits'] = info.get('keyspace_hits')
        out['misses'] = info.get('keyspace_misses')
        out['dbsize'] = client.dbsize()
    except Exception as e:
        out['infoError'] = str(e)
    prefix = getattr(cache, 'key_prefix', '') or ''
    version = getattr(cache, 'version', 1)
    keys = []
    try:
        raw_keys = []
        for raw in client.scan_iter(count=100):
            raw_keys.append(raw)
            if len(raw_keys) >= 50:
                break
        for raw in raw_keys:
            display = raw
            if isinstance(raw, bytes):
                display = raw.decode('utf-8', 'replace')
            try:
                val = client.get(raw)
                ttl = client.ttl(raw)
            except Exception:
                val = None
                ttl = None
            if ttl is not None and ttl < 0:
                ttl = None
            keys.append({'key': __nc_display(display, prefix, version), 'value': __nc_vrepr(__nc_unpickle(val)), 'ttl': ttl})
    except Exception as e:
        out['keysError'] = str(e)
    out['keys'] = keys

def __nc_db(cache, out):
    out['type'] = 'database'
    table = getattr(cache, '_table', None)
    keys = []
    out['entryCount'] = None
    if table:
        try:
            from django.db import connection
            with connection.cursor() as cur:
                cur.execute('SELECT cache_key, expires FROM ' + connection.ops.quote_name(table))
                rows = cur.fetchall()
            out['entryCount'] = len(rows)
            prefix = getattr(cache, 'key_prefix', '') or ''
            version = getattr(cache, 'version', 1)
            now = datetime.datetime.now(datetime.timezone.utc)
            for i, (k, e) in enumerate(rows):
                if i >= 50:
                    break
                ttl = None
                if e is not None:
                    try:
                        if isinstance(e, str):
                            e2 = datetime.datetime.fromisoformat(e)
                            if e2.tzinfo is None:
                                e2 = e2.replace(tzinfo=datetime.timezone.utc)
                        else:
                            e2 = e
                            if getattr(e2, 'tzinfo', None) is None:
                                e2 = e2.replace(tzinfo=datetime.timezone.utc)
                        ttl = max(0, int((e2 - now).total_seconds()))
                    except Exception:
                        ttl = None
                keys.append({'key': __nc_display(k, prefix, version), 'ttl': ttl})
        except Exception as ex:
            out['keysError'] = str(ex)
    out['keys'] = keys

def __nc_memcached(cache, out):
    out['type'] = 'memcached'
    client = getattr(cache, '_cache', None)
    try:
        stats = client.get_stats()
        out['servers'] = [{'server': s, **{k: v for k, v in list(st.items())[:14]}} for s, st in stats]
    except Exception as e:
        out['statsError'] = str(e)
    out['keys'] = []

def __nc_file(cache, out):
    out['type'] = 'filesystem'
    out['location'] = getattr(cache, '_dir', '')
    try:
        out['entryCount'] = sum(len(files) for _, _, files in __import__('os').walk(getattr(cache, '_dir', '')))
    except Exception:
        out['entryCount'] = None
    out['keys'] = []

def __nc_dummy(cache, out):
    out['type'] = 'dummy'
    out['keys'] = []

def __nc_snapshot(cache):
    out = {'backend': cache.__class__.__name__, 'hits': None, 'misses': None}
    for attr in ('_cache_hits', '_hits'):
        try:
            out['hits'] = getattr(cache, attr)
            break
        except Exception:
            continue
    for attr in ('_cache_misses', '_misses'):
        try:
            out['misses'] = getattr(cache, attr)
            break
        except Exception:
            continue
    name = out['backend'].lower()
    try:
        if 'locmem' in name:
            __nc_locmem(cache, out)
        elif 'redis' in name:
            __nc_redis(cache, out)
        elif 'database' in name:
            __nc_db(cache, out)
        elif 'memcached' in name:
            __nc_memcached(cache, out)
        elif 'file' in name:
            __nc_file(cache, out)
        elif 'dummy' in name:
            __nc_dummy(cache, out)
        else:
            out['type'] = 'generic'
            out['note'] = 'Key enumeration is not supported for this backend.'
            out['keys'] = []
    except Exception as e:
        out['error'] = str(e)
        out.setdefault('keys', [])
    hit = out.get('hits')
    miss = out.get('misses')
    if isinstance(hit, int) and isinstance(miss, int) and (hit + miss) > 0:
        out['hitRate'] = round(100.0 * hit / (hit + miss), 1)
    return out

aliases = list(settings.CACHES) if hasattr(settings, 'CACHES') else ['default']
{alias: __nc_snapshot(caches[alias]) for alias in aliases}
`;
}

function deleteCode(alias, key) {
  const a = JSON.stringify(alias);
  const k = JSON.stringify(key);
  return `
from django.core.cache import caches
c = caches[${a}]
k = ${k}
prefix = getattr(c, 'key_prefix', '') or ''
version = str(getattr(c, 'version', 1))
try:
    if c.__class__.__name__.lower().find('redis') >= 0:
        raw = (prefix + ':' if prefix else '') + version + ':' + k
        c._cache.delete(raw)
    else:
        c.delete(k)
except Exception:
    c.delete(k)
True
`;
}

function clearCode(alias) {
  const a = JSON.stringify(alias);
  return `
from django.core.cache import caches
caches[${a}].clear()
True
`;
}

module.exports = { inspectCode, deleteCode, clearCode };
