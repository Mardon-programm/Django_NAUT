// DjangoNAUT ORM Inspector: introspect every Django model (fields, relations,
// table, row counts) through the project shell.

function scanCode() {
  return `
import sys
from django.apps import apps
out = []
try:
    def _on_delete(f):
        try:
            rd = getattr(f, 'remote_field', None)
            if rd is not None and getattr(rd, 'on_delete', None) is not None:
                return rd.on_delete.__name__
        except Exception:
            pass
        return None

    for model in sorted(apps.get_models(), key=lambda m: (m._meta.app_label, m.__name__)):
        meta = model._meta
        fields = []
        for f in meta.local_fields:
            default = None
            try:
                if f.has_default():
                    d = f.default
                    default = d() if callable(d) else d
            except Exception:
                default = None
            rel = None
            try:
                if getattr(f, 'remote_field', None) is not None and getattr(f.remote_field, 'model', None) is not None:
                    rel = f.remote_field.model.__name__
            except Exception:
                pass
            fields.append({
                'name': f.name,
                'type': f.__class__.__name__,
                'null': bool(f.null),
                'blank': bool(f.blank),
                'default': default,
                'pk': bool(f.primary_key),
                'unique': bool(f.unique),
                'indexed': bool(f.db_index),
                'related': rel,
                'onDelete': _on_delete(f),
            })
        m2m = []
        for f in meta.local_many_to_many:
            m2m.append({'name': f.name, 'to': getattr(f.remote_field.model, '__name__', '')})
        rev = []
        for r in meta.related_objects:
            rev.append({'name': r.name, 'from': getattr(r.related_model, '__name__', '')})
        count = None
        try:
            count = model.objects.count()
        except Exception:
            pass
        try:
            file = sys.modules.get(model.__module__).__file__
        except Exception:
            file = ''
        out.append({
            'app': meta.app_label,
            'name': model.__name__,
            'verbose': meta.verbose_name,
            'abstract': bool(meta.abstract),
            'proxy': bool(meta.proxy),
            'table': meta.db_table,
            'file': file,
            'fields': fields,
            'm2m': m2m,
            'reverse': rev[:30],
            'count': count,
        })
except Exception as e:
    import traceback
    out.append({'error': traceback.format_exc(limit=10)})
out
`;
}

module.exports = { scanCode };
