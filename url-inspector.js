// DjangoNAUT URL Inspector: walk the real ROOT_URLCONF resolver tree through
// the project shell and list every route, name, namespace, view and allowed
// HTTP methods.

function scanCode() {
  return `
import sys
out = []
try:
    from django.urls import get_resolver
    _VIEW_METHODS = ('get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace')

    def _route_of(pat):
        p = getattr(pat, 'pattern', None)
        if p is None:
            return ''
        r = getattr(p, '_route', None)
        if r is not None:
            return r
        rg = getattr(p, 'regex', None)
        if rg is not None:
            try:
                return getattr(rg, 'pattern', '')
            except Exception:
                pass
        return str(p)

    def _walk(resolver, prefix, ns):
        for pat in resolver.url_patterns:
            sub = getattr(pat, 'url_patterns', None)
            if sub is not None:
                leaf_ns = getattr(pat, 'namespace', None) or ns
                _walk(pat, prefix + _route_of(pat), leaf_ns)
                continue
            cb = getattr(pat, 'callback', None)
            methods = []
            view_label = ''
            module = ''
            view_class = None
            if cb is not None:
                view_class = getattr(cb, 'view_class', None) or getattr(cb, 'cls', None)
                if view_class is not None:
                    module = getattr(view_class, '__module__', '')
                    vn = getattr(view_class, '__name__', '')
                    view_label = module + '.' + vn
                    methods = [m.upper() for m in _VIEW_METHODS if getattr(view_class, m, None)]
                else:
                    module = getattr(cb, '__module__', '')
                    view_label = module + '.' + getattr(cb, '__name__', '')
            file = ''
            try:
                if module in sys.modules and getattr(sys.modules[module], '__file__', None):
                    file = sys.modules[module].__file__
            except Exception:
                pass
            out.append({
                'route': prefix + _route_of(pat),
                'name': getattr(pat, 'name', '') or '',
                'namespace': getattr(pat, 'namespace', '') or ns or '',
                'methods': methods,
                'view': view_label,
                'viewName': view_label.rsplit('.', 1)[-1],
                'classBased': bool(view_class),
                'module': module,
                'file': file,
            })

    _walk(get_resolver(), '', '')
except Exception as e:
    import traceback
    out.append({'error': traceback.format_exc(limit=10)})
out
`;
}

module.exports = { scanCode };
