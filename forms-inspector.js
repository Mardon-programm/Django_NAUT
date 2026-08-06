// DjangoNAUT Forms Inspector: introspect every Django form / ModelForm
// (fields, widgets, validators, choices, linked models) via the shell.

function scanCode() {
  return `
import sys
import importlib
from pkgutil import iter_modules
from django.apps import apps
from django import forms as djforms

errors = []
form_modules = []

for app_config in apps.get_app_configs():
    base = app_config.name
    try:
        mod = importlib.import_module(base + '.forms')
    except ModuleNotFoundError as e:
        ename = getattr(e, 'name', '') or ''
        if ename == base + '.forms' or ename.startswith(base + '.forms.'):
            continue
        errors.append({'module': base + '.forms', 'error': repr(e)})
        continue
    except Exception as e:
        errors.append({'module': base + '.forms', 'error': repr(e)})
        continue
    form_modules.append(mod)
    if getattr(mod, '__path__', None):
        for info in iter_modules(mod.__path__):
            try:
                sub = importlib.import_module(base + '.forms.' + info.name)
                form_modules.append(sub)
            except Exception as e:
                errors.append({'module': base + '.forms.' + info.name, 'error': repr(e)})

def _is_form_class(cls):
    return (
        isinstance(cls, type)
        and issubclass(cls, djforms.BaseForm)
        and cls not in _BUILTIN_FORMS
    )

_BUILTIN_FORMS = tuple(
    b
    for b in (
        djforms.BaseForm,
        djforms.Form,
        djforms.ModelForm,
        getattr(djforms, "BaseModelForm", None),
    )
    if b is not None
)

def _clean(v):
    if v is None:
        return ''
    if callable(v):
        try:
            return repr(v)[:120]
        except Exception:
            return ''
    try:
        s = str(v)
    except Exception:
        return '<obj>'
    return s[:200]

def _bases(cls):
    out = []
    for b in cls.__bases__:
        if b in _BUILTIN_FORMS or b is object:
            continue
        out.append(b.__name__)
    return out

def _field_info(name, field):
    info = {
        'name': name,
        'type': field.__class__.__name__,
        'widget': field.widget.__class__.__name__,
        'required': bool(field.required),
        'label': _clean(field.label),
        'helpText': _clean(field.help_text),
        'initial': _clean(field.initial),
        'validators': [v.__class__.__name__ for v in (getattr(field, 'validators', None) or [])][:20],
    }
    ml = getattr(field, 'max_length', None)
    if ml is not None:
        info['maxLength'] = ml
    mnl = getattr(field, 'min_length', None)
    if mnl is not None:
        info['minLength'] = mnl
    mv = getattr(field, 'max_value', None)
    if mv is not None:
        info['maxValue'] = _clean(mv)
    mnv = getattr(field, 'min_value', None)
    if mnv is not None:
        info['minValue'] = _clean(mnv)
    try:
        qs = getattr(field, 'queryset', None)
        if qs is not None:
            m = getattr(qs, 'model', None)
            if m is not None:
                info['querysetModel'] = m.__name__
    except Exception:
        pass
    try:
        ch = getattr(field, 'choices', None)
        if ch is not None and not hasattr(field, 'queryset'):
            lst = list(ch)
            if lst:
                info['choices'] = len(lst)
                info['choiceSample'] = [_clean(v) for k, v in lst[:6]]
    except Exception:
        pass
    return info

def _form_info(form_cls):
    info = {
        'name': form_cls.__name__,
        'module': form_cls.__module__,
        'file': '',
        'base': _bases(form_cls),
        'isModelForm': issubclass(form_cls, djforms.ModelForm),
        'model': '',
        'modelFields': None,
        'modelExclude': None,
        'fields': [],
    }
    try:
        info['file'] = sys.modules.get(form_cls.__module__).__file__ or ''
    except Exception:
        pass
    try:
        meta = getattr(form_cls, '_meta', None)
        if meta is not None:
            if getattr(meta, 'model', None) is not None:
                info['model'] = meta.model.__name__
            if getattr(meta, 'fields', None) is not None:
                info['modelFields'] = meta.fields if isinstance(meta.fields, list) else [str(meta.fields)]
            if getattr(meta, 'exclude', None) is not None:
                info['modelExclude'] = list(meta.exclude)
            if getattr(meta, 'widgets', None):
                info['modelWidgets'] = sorted(meta.widgets.keys())
            if getattr(meta, 'labels', None):
                info['modelLabels'] = sorted(meta.labels.keys())
            if getattr(meta, 'help_texts', None):
                info['modelHelp'] = sorted(meta.help_texts.keys())
    except Exception as e:
        info['metaError'] = repr(e)
    try:
        declared = getattr(form_cls, 'declared_fields', None) or {}
    except Exception:
        declared = {}
    for fname, field in form_cls.base_fields.items():
        fi = _field_info(fname, field)
        fi['declared'] = fname in declared
        info['fields'].append(fi)
    return info

results = []
seen = set()
for mod in form_modules:
    for cname in dir(mod):
        try:
            cls = getattr(mod, cname)
        except Exception:
            continue
        if not _is_form_class(cls):
            continue
        if getattr(cls, '__module__', '') != mod.__name__:
            continue
        if id(cls) in seen:
            continue
        seen.add(id(cls))
        try:
            results.append(_form_info(cls))
        except Exception as e:
            errors.append({'module': mod.__name__, 'error': repr(e)})

results.sort(key=lambda f: (f['module'].lower(), f['name'].lower()))
{
    'forms': results,
    'errors': errors,
    'count': len(results),
    'fieldCount': sum(len(f['fields']) for f in results),
}
`;
}

module.exports = { scanCode };
